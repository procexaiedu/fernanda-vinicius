'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'

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
async function usuarioAtual(): Promise<{ id: string; storeId: string | null; isAdmin: boolean }> {
  const p = await requireProfile()
  return { id: p.id, storeId: p.store_id, isAdmin: p.role === 'admin' }
}

/** Abre a conferência congelando o escopo. Recusa se já houver uma aberta na loja. */
export async function abrirConferencia(dados: {
  store_id?: string
  scope_type: 'categoria' | 'loja'
  scope_value?: string | null
}): Promise<ActionResult & { session_id?: string; em_escopo?: number }> {
  const { id, storeId } = await usuarioAtual()

  // Operadora confere a própria loja. Admin não tem store_id, então escolhe.
  const loja = storeId ?? dados.store_id
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
 */
export async function registrarBipe(sessionId: string, barcode: string): Promise<ActionResult & {
  produto?: {
    id: string; name: string; code: string; category: string; photo_url: string | null
    /** Preço efetivo — o MESMO que foi impresso na etiqueta. Ver abaixo. */
    preco: number
    promo: boolean
  } | null
  repetido?: boolean
}> {
  await usuarioAtual()
  const admin = createAdminClient()

  const { data: sessao } = await admin
    .from('inventory_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .maybeSingle()

  if (!sessao) return { success: false, error: 'Conferência não encontrada.' }
  if (sessao.status !== 'contando') return { success: false, error: 'Esta conferência já foi fechada.' }

  const { data: produto } = await admin
    .from('products')
    .select('id, name, code, category, photo_url, sale_price, promotional_price, promotional_active')
    .eq('barcode_number', barcode)
    .maybeSingle()

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

  const { count } = await admin
    .from('inventory_scans')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('barcode_number', barcode)

  const { error } = await admin.from('inventory_scans').insert({
    session_id:     sessionId,
    barcode_number: barcode,
    product_id:     produto?.id ?? null,
  })
  if (error) return { success: false, error: error.message }

  return {
    success: true,
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

/** Desfaz o último bipe da sessão — leitura dupla acontece, e sem isto vira sobra falsa. */
export async function desfazerUltimoBipe(sessionId: string): Promise<ActionResult> {
  await usuarioAtual()
  const admin = createAdminClient()

  const { data: ultimo } = await admin
    .from('inventory_scans')
    .select('id')
    .eq('session_id', sessionId)
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ultimo) return { success: false, error: 'Nada para desfazer.' }

  const { error } = await admin.from('inventory_scans').delete().eq('id', ultimo.id)
  if (error) return { success: false, error: error.message }
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
  await usuarioAtual()
  const admin = createAdminClient()

  const { data: sessao } = await admin
    .from('inventory_sessions')
    .select('id, scope_product_ids')
    .eq('id', sessionId)
    .maybeSingle()

  if (!sessao) return { success: false, error: 'Conferência não encontrada.' }
  const emEscopo = (sessao.scope_product_ids ?? []) as string[]

  const [scansRes, produtosRes] = await Promise.all([
    admin.from('inventory_scans')
      .select('barcode_number, product_id')
      .eq('session_id', sessionId)
      .limit(20000),
    emEscopo.length
      ? admin.from('products')
          .select('id, code, name, category, photo_url, quantity_in_stock')
          .in('id', emEscopo)
      : Promise.resolve({ data: [] }),
  ])

  const scans = (scansRes.data ?? []) as { barcode_number: string; product_id: string | null }[]

  const contagem = new Map<string, number>()
  const desconhecidos = new Map<string, number>()
  for (const s of scans) {
    if (s.product_id) contagem.set(s.product_id, (contagem.get(s.product_id) ?? 0) + 1)
    else desconhecidos.set(s.barcode_number, (desconhecidos.get(s.barcode_number) ?? 0) + 1)
  }

  const produtos = (produtosRes.data ?? []) as {
    id: string; code: string; name: string; category: string
    photo_url: string | null; quantity_in_stock: number
  }[]

  const dados: Reconciliacao = { bate: [], falta: [], sobra: [], naoCadastrado: [] }
  const vistos = new Set<string>()

  for (const p of produtos) {
    vistos.add(p.id)
    const linha: LinhaReconciliacao = {
      product_id: p.id, code: p.code, name: p.name, category: p.category,
      photo_url: p.photo_url,
      esperado: p.quantity_in_stock,
      contado: contagem.get(p.id) ?? 0,
    }
    if (linha.contado === linha.esperado) dados.bate.push(linha)
    else if (linha.contado < linha.esperado) dados.falta.push(linha)
    else dados.sobra.push(linha)
  }

  // Peça bipada que existe no cadastro mas estava FORA do escopo declarado.
  // É sobra também — só que de outra gaveta, e por isso vale aparecer.
  const foraDoEscopo = [...contagem.keys()].filter(id => !vistos.has(id))
  if (foraDoEscopo.length) {
    const { data } = await admin
      .from('products')
      .select('id, code, name, category, photo_url, quantity_in_stock')
      .in('id', foraDoEscopo)
    for (const p of (data ?? []) as typeof produtos) {
      dados.sobra.push({
        product_id: p.id, code: p.code, name: p.name, category: p.category,
        photo_url: p.photo_url,
        esperado: p.quantity_in_stock,
        contado: contagem.get(p.id) ?? 0,
      })
    }
  }

  dados.naoCadastrado = [...desconhecidos.entries()]
    .map(([barcode_number, vezes]) => ({ barcode_number, vezes }))
    .sort((a, b) => b.vezes - a.vezes)

  const ordenar = (a: LinhaReconciliacao, b: LinhaReconciliacao) => a.name.localeCompare(b.name, 'pt-BR')
  dados.falta.sort(ordenar); dados.sobra.sort(ordenar); dados.bate.sort(ordenar)

  return { success: true, dados }
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
): Promise<ActionResult & { ajustes_aplicados?: number }> {
  const { id } = await usuarioAtual()
  const admin = createAdminClient()

  const semMotivo = ajustes.find(a => !a.reason?.trim())
  if (semMotivo) return { success: false, error: 'Todo ajuste precisa de um motivo.' }

  const { data, error } = await admin.rpc('close_inventory_session', {
    p_session_id:  sessionId,
    p_adjustments: ajustes,
    p_totals:      totais,
    p_user_id:     id,
  })
  if (error) return { success: false, error: error.message }

  const json = data as { success: boolean; error?: string; ajustes_aplicados?: number }
  if (!json.success) return { success: false, error: json.error ?? 'Erro ao fechar a conferência.' }

  revalidatePath('/estoque/conferencia')
  revalidatePath('/estoque')
  revalidatePath('/produtos')
  return { success: true, ajustes_aplicados: json.ajustes_aplicados }
}

/** Cancela sem aplicar nada. Os bipes ficam registrados — a sessão vira histórico. */
export async function cancelarConferencia(sessionId: string): Promise<ActionResult> {
  await usuarioAtual()
  const admin = createAdminClient()

  const { error } = await admin
    .from('inventory_sessions')
    .update({ status: 'cancelada', closed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'contando')

  if (error) return { success: false, error: error.message }
  revalidatePath('/estoque/conferencia')
  return { success: true }
}
