'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { idDeRequisicaoValido, violouUnico } from '@/lib/idempotencia'

export interface ActionResult {
  success: boolean
  error?: string
}

/**
 * Quem pode conferir e quem pode ajustar.
 *
 * Contar é operação de chão de loja: qualquer usuária ativa faz. Aplicar os
 * ajustes também — é ela que está com a gaveta na mão, e exigir um admin
 * presente transformaria a conferência em algo que só acontece quando a dona
 * está na loja, ou seja, quase nunca.
 *
 * O controle não é a permissão, é o rastro: cada ajuste grava em
 * `fv.stock_movements` o de-quanto-pra-quanto, o motivo, quem e qual sessão.
 * Se isso um dia não bastar, o lugar de apertar é aqui.
 */
async function usuarioAtual(): Promise<{ id: string; isAdmin: boolean; loja: string | null }> {
  const p = await requireProfile()
  return { id: p.id, isAdmin: p.role === 'admin', loja: lojaDoEscopo(p) }
}

interface SessaoCarregada {
  id: string
  status: string
  store_id: string
}

/**
 * Carrega a sessão E confere que ela é da loja de quem chama.
 *
 * Todas as ações daqui recebem só o `sessionId` do navegador e rodam com
 * service_role (ignora RLS). Sem esta checagem, a operadora de Brasília com o
 * id de uma sessão de Campinas bipava, desfazia, cancelava e FECHAVA a
 * conferência da outra loja — aplicando ajuste de saldo lá. O corte que a
 * página faz na lista seria enfeite.
 *
 * Mesma regra do resto do sistema (`lojaDoEscopo`): quem tem loja está preso a
 * ela, admin de loja inclusive; o admin global vale para a loja que escolheu
 * ao entrar. `null` (admin global sem escolha) é o "vê todas" de sempre.
 */
async function sessaoDaMinhaLoja(
  sessionId: string,
  loja: string | null,
): Promise<{ sessao: SessaoCarregada } | { error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('inventory_sessions')
    .select('id, status, store_id')
    .eq('id', sessionId)
    .maybeSingle()

  // Falha de leitura não é "não encontrada": a mensagem errada manda procurar
  // uma sessão que existe.
  if (error) return { error: `Não foi possível carregar a conferência: ${error.message}` }
  if (!data) return { error: 'Conferência não encontrada.' }
  if (loja && data.store_id !== loja) return { error: 'Esta conferência é de outra loja.' }
  return { sessao: data as SessaoCarregada }
}

/** Abre a conferência congelando o escopo. Recusa se já houver uma aberta na loja. */
export async function abrirConferencia(dados: {
  store_id?: string
  scope_type: 'categoria' | 'loja'
  scope_value?: string | null
}): Promise<ActionResult & { session_id?: string; em_escopo?: number }> {
  const { id, loja: lojaDoPerfil } = await usuarioAtual()

  // Quem tem loja (ou o admin global que escolheu uma ao entrar) confere a
  // dela; o que vem da tela só vale para quem ainda não está em loja nenhuma.
  const loja = lojaDoPerfil ?? dados.store_id
  if (!loja) return { success: false, error: 'Escolha a loja da conferência.' }
  if (dados.scope_type === 'categoria' && !dados.scope_value) {
    return { success: false, error: 'Escolha a categoria a conferir.' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('open_inventory_session', {
    p_store_id:    loja,
    p_scope_type:  dados.scope_type,
    p_scope_value: dados.scope_type === 'loja' ? null : dados.scope_value,
    p_user_id:     id,
  })
  if (error) return { success: false, error: error.message }

  const json = data as { success: boolean; error?: string; session_id?: string; em_escopo?: number }
  if (!json.success) return { success: false, error: json.error ?? 'Erro ao abrir a conferência.' }

  revalidatePath('/estoque/conferencia')
  return { success: true, session_id: json.session_id, em_escopo: json.em_escopo }
}

/**
 * Registra um bipe.
 *
 * Devolve o produto para a tela mostrar o que foi contado — mas NUNCA a
 * quantidade esperada. Se a tela contasse quanto era pra ter, a operadora
 * pararia no número certo e a divergência que a conferência existe para achar
 * desapareceria.
 *
 * `product_id` nulo é situação normal, não erro: etiqueta lida que não
 * corresponde a produto nenhum. Resolve na reconciliação, não na contagem —
 * parar a fila para cadastrar peça é o que faz a conferência ser abandonada no
 * meio.
 *
 * `bipeId` é gerado pela TELA, um por bipe, e vira o `id` da linha. É o que
 * torna o reenvio seguro: se a resposta se perde (rede, timeout), a tela manda
 * de novo com o MESMO id e, se o primeiro já tinha entrado, a PK recusa o
 * segundo (23505) — o bipe conta uma vez só. Sem ele (tela antiga, aberta
 * antes do deploy) o banco gera o id, como antes.
 */
export async function registrarBipe(sessionId: string, barcode: string, bipeId?: string | null): Promise<ActionResult & {
  produto?: {
    id: string; name: string; code: string; category: string; photo_url: string | null
    /** Preço efetivo — o MESMO que foi impresso na etiqueta. Ver abaixo. */
    preco: number
    promo: boolean
  } | null
  repetido?: boolean
  /** Id do bipe gravado — é o que o "desfazer" apaga, e só ele. */
  bipe_id?: string
}> {
  const { loja } = await usuarioAtual()
  const admin = createAdminClient()

  const carregada = await sessaoDaMinhaLoja(sessionId, loja)
  if ('error' in carregada) return { success: false, error: carregada.error }
  const { sessao } = carregada
  if (sessao.status !== 'contando') return { success: false, error: 'Esta conferência já foi fechada.' }

  /*
   * Procura a peça NA LOJA DA CONFERÊNCIA. Desde 16/09 a etiqueta é única por
   * loja: a peça transferida tem a mesma etiqueta em Campinas e em Brasília, e
   * buscar só pela etiqueta traria as duas linhas — `.maybeSingle()` falharia e
   * o bipe viraria "peça sem cadastro", sujando a contagem.
   */
  const colunas = 'id, name, code, category, photo_url, sale_price, promotional_price, promotional_active'

  const { data: daLoja, error: erroDaLoja } = await admin
    .from('products')
    .select(colunas)
    .eq('store_id', sessao.store_id)
    .eq('barcode_number', barcode)
    .maybeSingle()

  /*
   * Falha na busca NÃO é "não é desta loja". Antes o erro era ignorado e o
   * bipe caía no fallback de outra loja: uma oscilação de rede gravava a peça
   * de Campinas com o product_id de Brasília, e ela virava falta aqui e sobra
   * lá. Melhor recusar o bipe — a tela manda bipar de novo.
   */
  if (erroDaLoja) return { success: false, error: `Não deu para identificar a peça: ${erroDaLoja.message}` }

  // Não é desta loja: identifica mesmo assim, como antes de 16/09. Peça de
  // outra loja bipada aqui continua aparecendo com nome, em vez de "sem
  // cadastro" — é o que avisa que ela está no lugar errado.
  let produto = daLoja
  if (!produto) {
    const { data: deOutra, error: erroOutra } = await admin
      .from('products')
      .select(colunas)
      .eq('barcode_number', barcode)
      .limit(1)
      .maybeSingle()
    // Mesmo motivo: erro aqui gravaria a peça como "sem cadastro".
    if (erroOutra) return { success: false, error: `Não deu para identificar a peça: ${erroOutra.message}` }
    produto = deOutra
  }

  /*
   * Preço efetivo — a mesma regra do PDV e da impressão de etiqueta: a promoção
   * só vale se estiver ATIVA e maior que zero.
   *
   * Está aqui para a operadora comparar com o preço impresso no papel enquanto
   * bipa. Etiqueta impressa antes de uma mudança de preço mostra valor velho, e
   * é o papel que a cliente lê no balcão. A contagem é o único momento em que
   * alguém pega peça por peça na mão — é onde essa divergência aparece de graça.
   */
  const emPromo = !!produto?.promotional_active
    && produto?.promotional_price !== null
    && Number(produto?.promotional_price) > 0
  const preco = Number(emPromo ? produto?.promotional_price : produto?.sale_price) || 0

  const idDoBipe = idDeRequisicaoValido(bipeId)

  /* "Repetido" conta os OUTROS bipes desta etiqueta. No reenvio, o próprio
   * bipe já pode estar gravado — contá-lo faria a peça parecer repetida. */
  let contagem = admin
    .from('inventory_scans')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('barcode_number', barcode)
  if (idDoBipe) contagem = contagem.neq('id', idDoBipe)
  const { count } = await contagem

  const { data: gravado, error } = await admin.from('inventory_scans').insert({
    ...(idDoBipe ? { id: idDoBipe } : {}),
    session_id:     sessionId,
    barcode_number: barcode,
    product_id:     produto?.id ?? null,
  }).select('id').single()

  let idGravado = gravado?.id as string | undefined
  if (error) {
    /*
     * 23505 com o id que a tela mandou = este bipe JÁ ENTROU (a resposta do
     * primeiro envio se perdeu). É sucesso, não erro — mas só se o bipe
     * existente for desta sessão e desta etiqueta; senão é outra coisa e
     * o erro original vale.
     */
    if (!idDoBipe || !violouUnico(error)) return { success: false, error: error.message }
    const { data: existente, error: lerErr } = await admin
      .from('inventory_scans').select('id, session_id, barcode_number').eq('id', idDoBipe).maybeSingle()
    if (lerErr || !existente || existente.session_id !== sessionId || existente.barcode_number !== barcode) {
      console.error('[conferencia] bipe com id repetido que não é deste reenvio', { idDoBipe, sessionId, barcode, lerErr })
      return { success: false, error: error.message }
    }
    idGravado = existente.id as string
  }
  if (!idGravado) return { success: false, error: 'O bipe não voltou do banco — confira na lista.' }

  return {
    success: true,
    bipe_id: idGravado,
    produto: produto
      ? {
          id: produto.id, name: produto.name, code: produto.code,
          category: produto.category, photo_url: produto.photo_url,
          preco, promo: emPromo,
        }
      : null,
    repetido: (count ?? 0) > 0,
  }
}

/**
 * Desfaz UM bipe, pelo id que `registrarBipe` devolveu.
 *
 * Antes apagava "o último bipe da sessão" — de quem quer que fosse. Com duas
 * pessoas contando a mesma loja, o desfazer de uma apagava a peça que a outra
 * acabou de contar: falta falsa, sem rastro. Agora a tela só pode desfazer os
 * bipes que ELA gravou (é ela que guarda os ids), e o servidor confere que o
 * bipe é desta sessão, da loja de quem pede, com a contagem ainda aberta.
 *
 * O banco não guarda quem bipou (`inventory_scans` não tem coluna de usuário);
 * até ganhar uma, a garantia de "só o meu" é o id que só a tela de quem bipou
 * conhece.
 */
export async function desfazerBipe(sessionId: string, bipeId: string): Promise<ActionResult> {
  const { loja } = await usuarioAtual()
  const carregada = await sessaoDaMinhaLoja(sessionId, loja)
  if ('error' in carregada) return { success: false, error: carregada.error }
  if (carregada.sessao.status !== 'contando') {
    return { success: false, error: 'Esta conferência já foi fechada.' }
  }

  const admin = createAdminClient()
  const { data: apagados, error } = await admin
    .from('inventory_scans')
    .delete()
    .eq('id', bipeId)
    .eq('session_id', sessionId)
    .select('id')
  if (error) return { success: false, error: error.message }
  if (!apagados?.length) return { success: false, error: 'Este bipe não existe mais — confira a lista.' }
  return { success: true }
}

export interface LinhaReconciliacao {
  product_id: string
  code: string
  name: string
  category: string
  photo_url: string | null
  esperado: number
  contado: number
}

export interface Reconciliacao {
  bate: LinhaReconciliacao[]
  falta: LinhaReconciliacao[]
  sobra: LinhaReconciliacao[]
  naoCadastrado: { barcode_number: string; vezes: number }[]
}

/**
 * Carrega a reconciliação — e é de propósito que isto seja uma ação separada,
 * chamada só quando a contagem termina.
 *
 * A quantidade esperada NÃO pode chegar ao navegador durante a contagem. Se ela
 * estivesse no estado do componente desde o início, bastaria abrir o devtools —
 * ou um `console.log` esquecido — para a operadora saber onde parar. E se ela
 * sabe onde parar, ela para: a divergência que a conferência existe para achar
 * desaparece antes de ser medida.
 *
 * Por isso a página da sessão manda só os bipes. O esperado nasce aqui.
 */
export async function carregarReconciliacao(sessionId: string): Promise<
  ActionResult & { dados?: Reconciliacao }
> {
  // A reconciliação traz o ESPERADO — o número mais sensível da conferência.
  // De outra loja, nem pensar.
  const { loja } = await usuarioAtual()
  const carregada = await sessaoDaMinhaLoja(sessionId, loja)
  if ('error' in carregada) return { success: false, error: carregada.error }
  const admin = createAdminClient()

  /*
   * A conta é feita no banco (fv.reconciliar_conferencia).
   *
   * A versão anterior buscava os produtos do escopo com `.in('id', [...])`,
   * mandando os 1.185 UUIDs na query string: 44 KB de URL, que o gateway recusa
   * com 414. Pior: o código tratava a falha como "nenhum produto encontrado" e
   * montava uma reconciliação toda zerada — que parecia legítima e podia ser
   * fechada. Uma conferência real de 615 bipes foi encerrada aplicando zero
   * ajustes, sem nenhum erro na tela.
   *
   * O escopo já está na linha da sessão. Fazendo o join lá dentro, nada
   * atravessa a rede e não existe limite de tamanho.
   */
  const { data, error } = await admin.rpc('reconciliar_conferencia', { p_session_id: sessionId })

  // Falha é falha: nunca mais devolver lista vazia como se fosse resultado.
  if (error) return { success: false, error: error.message }

  const json = data as {
    success: boolean
    error?: string
    bate: LinhaReconciliacao[]
    falta: LinhaReconciliacao[]
    sobra: LinhaReconciliacao[]
    nao_cadastrado: { barcode_number: string; vezes: number }[]
  } | null

  if (!json) return { success: false, error: 'A reconciliação não retornou dados.' }
  if (!json.success) return { success: false, error: json.error ?? 'Erro ao montar a reconciliação.' }

  return {
    success: true,
    dados: {
      bate: json.bate ?? [],
      falta: json.falta ?? [],
      sobra: json.sobra ?? [],
      naoCadastrado: json.nao_cadastrado ?? [],
    },
  }
}

/**
 * Reabre uma conferência que fechou sem aplicar nada.
 *
 * Existe por causa do bug do `.in()`: uma sessão real, com 615 bipes, foi
 * encerrada com zero ajustes porque a reconciliação vinha vazia. Os bipes
 * continuam gravados, então a contagem não precisa ser refeita — basta reabrir
 * e reconciliar de novo, agora com a conta certa.
 *
 * Só reabre se NADA foi aplicado. Se já houver linha no ledger apontando para a
 * sessão, reabrir criaria uma segunda rodada de ajustes sobre saldos que já
 * mudaram — e aí o histórico deixaria de descrever o que aconteceu.
 */
export async function reabrirConferencia(sessionId: string): Promise<ActionResult> {
  const { isAdmin, loja } = await usuarioAtual()
  if (!isAdmin) return { success: false, error: 'Apenas administradores podem reabrir uma conferência.' }

  const carregada = await sessaoDaMinhaLoja(sessionId, loja)
  if ('error' in carregada) return { success: false, error: carregada.error }

  const admin = createAdminClient()

  const { count, error: erroContagem } = await admin
    .from('stock_movements')
    .select('id', { count: 'exact', head: true })
    .eq('ref_type', 'inventory_session')
    .eq('ref_id', sessionId)

  /* Sem esta checagem, falha de leitura virava `count` nulo = "nenhum ajuste"
     e liberava reabrir uma sessão que JÁ aplicou — a segunda rodada que o
     comentário acima proíbe. */
  if (erroContagem) return { success: false, error: `Não foi possível conferir os ajustes: ${erroContagem.message}` }

  if ((count ?? 0) > 0) {
    return { success: false, error: `Esta conferência já aplicou ${count} ajuste(s) — reabrir criaria uma segunda rodada sobre saldos já alterados.` }
  }

  const { error } = await admin
    .from('inventory_sessions')
    .update({ status: 'contando', closed_at: null })
    .eq('id', sessionId)
    .neq('status', 'contando')

  if (error) return { success: false, error: error.message }

  revalidatePath('/estoque/conferencia')
  return { success: true }
}

export interface AjusteConferencia {
  product_id: string
  new_quantity: number
  reason: string
  notes?: string | null
}

/**
 * Fecha a sessão aplicando os ajustes.
 *
 * Produto ausente da lista fica como está — é o "deixar como está" da tela, e não
 * é omissão: a peça pode estar na mão de uma cliente provando, e ajustar sozinho
 * criaria falta falsa hoje e sobra falsa amanhã.
 *
 * O UPDATE do saldo e o INSERT no ledger vão na mesma transação do RPC. Se só o
 * saldo fosse, perderíamos o porquê — que é a única razão do ledger existir.
 */
export async function fecharConferencia(
  sessionId: string,
  ajustes: AjusteConferencia[],
  totais: Record<string, number>,
): Promise<ActionResult & { ajustes_aplicados?: number; ajustes_ignorados?: number }> {
  const { id, loja } = await usuarioAtual()
  const admin = createAdminClient()

  const carregada = await sessaoDaMinhaLoja(sessionId, loja)
  if ('error' in carregada) return { success: false, error: carregada.error }
  const { sessao } = carregada
  if (sessao.status !== 'contando') return { success: false, error: 'Esta conferência já foi fechada.' }

  const semMotivo = ajustes.find(a => !a.reason?.trim())
  if (semMotivo) return { success: false, error: 'Todo ajuste precisa de um motivo.' }

  /*
   * Só ajusta peça DESTA loja.
   *
   * A lista vem do navegador, e a RPC grava o saldo em qualquer product_id que
   * receber. Dois jeitos de isso cair na outra loja: alguém montando a lista na
   * mão, e — sem má-fé nenhuma — a peça de Brasília bipada em Campinas, que o
   * `registrarBipe` identifica pelo cadastro de lá (para avisar que está no
   * lugar errado) e que a reconciliação pode devolver como "sobra". Fechar a
   * conferência de Campinas mexeria no saldo de Brasília.
   *
   * Filtra em vez de recusar: essa sobra de outra loja é legítima na contagem,
   * só não cabe a esta conferência ajustar. Travar o fechamento por ela
   * obrigaria a recontar. Em blocos de 200 porque `.in()` grande estoura a URL.
   */
  const ids = [...new Set(ajustes.map(a => a.product_id))]
  const daLoja = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: lote, error: erroLote } = await admin
      .from('products')
      .select('id')
      .eq('store_id', sessao.store_id)
      .in('id', ids.slice(i, i + 200))
    // Falha de leitura NÃO pode virar "nenhuma peça é da loja" — fecharia a
    // conferência com zero ajustes, o bug dos 615 bipes de novo.
    if (erroLote) return { success: false, error: `Não foi possível conferir as peças: ${erroLote.message}` }
    for (const p of lote ?? []) daLoja.add(p.id as string)
  }
  const validos = ajustes.filter(a => daLoja.has(a.product_id))
  const ignorados = ajustes.length - validos.length

  const { data, error } = await admin.rpc('close_inventory_session', {
    p_session_id:  sessionId,
    p_adjustments: validos,
    p_totals:      totais,
    p_user_id:     id,
  })
  if (error) return { success: false, error: error.message }

  const json = data as { success: boolean; error?: string; ajustes_aplicados?: number }
  if (!json.success) return { success: false, error: json.error ?? 'Erro ao fechar a conferência.' }

  revalidatePath('/estoque/conferencia')
  revalidatePath('/estoque')
  revalidatePath('/produtos')
  return { success: true, ajustes_aplicados: json.ajustes_aplicados, ajustes_ignorados: ignorados }
}

/** Cancela sem aplicar nada. Os bipes ficam registrados — a sessão vira histórico. */
export async function cancelarConferencia(sessionId: string): Promise<ActionResult> {
  const { loja } = await usuarioAtual()
  const carregada = await sessaoDaMinhaLoja(sessionId, loja)
  if ('error' in carregada) return { success: false, error: carregada.error }

  const admin = createAdminClient()

  const { data: canceladas, error } = await admin
    .from('inventory_sessions')
    .update({ status: 'cancelada', closed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'contando')
    .select('id')

  if (error) return { success: false, error: error.message }
  // Nenhuma linha = já tinha sido fechada/cancelada (outra aba, outra pessoa).
  // Dizer "cancelada" aqui esconderia que a sessão foi FECHADA com ajustes.
  if (!canceladas?.length) return { success: false, error: 'Esta conferência já não estava aberta — recarregue a página.' }
  revalidatePath('/estoque/conferencia')
  return { success: true }
}
