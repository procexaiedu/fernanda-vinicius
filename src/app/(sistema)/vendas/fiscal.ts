'use server'

import { revalidatePath } from 'next/cache'
import { getProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { emitirNfce, consultarNfce, cancelarNfce, type AmbienteFiscal } from '@/lib/fiscal/focus'
import { EMISSAO_NOTA_ATIVA, MSG_EMISSAO_EM_BREVE } from '@/lib/fiscal/emissaoAtiva'
import {
  montarNfce, validarVenda, ratearDesconto, refDaVenda, prepararParaNota,
  type ItemVenda, type MetodoPagamento, type VendaParaNota,
} from '@/lib/fiscal/montarNfce'

/**
 * Emissão de NFC-e a partir de uma venda.
 *
 * A REGRA QUE MANDA AQUI: **a nota nunca derruba a venda.**
 *
 * A venda já está gravada quando isto roda. Se a emissão falhar — SEFAZ fora,
 * rede caindo, campo recusado —, a venda continua exatamente como está e o
 * motivo fica registrado em `nfce_motivo_rejeicao` para alguém reprocessar. O
 * contrário seria inaceitável: perder o registro de uma venda real porque a
 * Receita estava indisponível.
 *
 * É por isso que isto é uma ação SEPARADA de `createSale`, e não um passo
 * dentro dela.
 */

export interface ResultadoFiscal {
  /** Para montar o link do WhatsApp na hora, sem uma segunda ida ao servidor. */
  cliente?: string | null
  telefone?: string | null
  loja?: string | null
  success: boolean
  status?: string
  chave?: string
  danfeUrl?: string
  /** Mensagem pronta para a tela — já explica o que fazer, quando dá. */
  error?: string
  /** Recusas da nossa validação, antes de falar com a Focus. */
  recusas?: { campo: string; motivo: string }[]
  /** O que ficou fora da nota sem impedir a emissão (o conserto). */
  avisos?: string[]
}

/**
 * Quem pode EMITIR: qualquer pessoa autenticada que registra venda.
 *
 * Eu tinha travado isto em admin, e estava errado. A nota tem **5 minutos** de
 * janela e quem está no balcão com a cliente é a operadora — exigir admin
 * significaria, na prática, que nota nenhuma sai na hora. Emitir o documento
 * da venda que ela acabou de fazer é parte do trabalho dela, não um ato
 * administrativo privilegiado.
 */
async function verificarUsuario(): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, error: 'Não autenticado.' }
  return { userId: user.id, error: null }
}

/**
 * Quem pode CANCELAR: só admin.
 *
 * Aqui a trava fica. Cancelar é desfazer um documento fiscal já autorizado,
 * com justificativa que o contador vai ler — é correção, não operação.
 */
async function verificarAdmin(): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()

  if (profile?.role !== 'admin') return { userId: user.id, error: 'Só administrador cancela nota.' }
  return { userId: user.id, error: null }
}

/**
 * A venda é da loja de quem pediu?
 *
 * As três ações fiscais recebem um `saleId` do navegador e leem com
 * `createAdminClient()` (service_role, ignora RLS). Sem esta conferência, quem
 * é de Campinas emitia, sincronizava ou CANCELAVA a nota de uma venda de
 * Brasília só trocando o id — e nota fiscal cancelada não volta.
 *
 * Admin global (`lojaDoEscopo` devolve null) passa por todas, como em todo o
 * resto do sistema.
 */
async function daMinhaLoja(storeIdDaVenda: string | null): Promise<boolean> {
  const perfil = await getProfile()
  if (!perfil) return false
  const escopo = lojaDoEscopo(perfil)
  return !escopo || escopo === storeIdDaVenda
}

export interface NotaDaVenda {
  /** Mostrar o botão "Emitir nota fiscal". */
  emite: boolean
  /** Por que não há botão — a tela diz, em vez de sumir com o assunto. */
  motivo?: string
  /** A conferência falhou (rede): não é "não emite", é "não sei agora". */
  falhou?: boolean
}

const MSG_NAO_CONFERI =
  'Não consegui conferir a nota agora. A venda está gravada; dá para emitir depois em Vendas, no detalhe da venda.'

/**
 * Esta venda pode ganhar nota? É o que decide o botão no fim da venda.
 *
 * Vem por venda, e não por loja fixa, porque a admin global pode estar
 * operando qualquer uma das duas.
 *
 * Era `Promise<boolean>` com `data?.store_id ?? null`: uma falha de leitura
 * virava "não emite" e o botão sumia calado, com a cliente no balcão e a
 * janela de 5 minutos correndo. Agora falha é `falhou`, e a tela diz onde
 * emitir depois.
 *
 * Venda SÓ de conserto não ganha botão: o conserto fica fora da NFC-e
 * (`prepararParaNota`), então clicar só renderia "não há o que emitir".
 */
export async function vendaEmiteNota(saleId: string): Promise<NotaDaVenda> {
  const { error } = await verificarUsuario()
  if (error) return { emite: false, falhou: true, motivo: MSG_NAO_CONFERI }

  const admin = createAdminClient()
  const [vendaRes, itensRes] = await Promise.all([
    admin.from('sales').select('store_id').eq('id', saleId).maybeSingle(),
    admin.from('sale_items').select('products(is_service)').eq('sale_id', saleId),
  ])
  if (vendaRes.error || itensRes.error || !itensRes.data) {
    console.error('[fiscal] falha ao conferir se a venda emite nota', vendaRes.error ?? itensRes.error)
    return { emite: false, falhou: true, motivo: MSG_NAO_CONFERI }
  }
  if (!vendaRes.data) return { emite: false, motivo: 'Venda não encontrada.' }
  if (!(await daMinhaLoja(vendaRes.data.store_id))) return { emite: false, motivo: 'Esta venda é de outra loja.' }

  const { data: emitente, error: erroEmitente } = await admin
    .from('fiscal_emitentes').select('habilitado').eq('store_id', vendaRes.data.store_id).maybeSingle()
  if (erroEmitente) {
    console.error('[fiscal] falha ao ler o emitente da loja', erroEmitente)
    return { emite: false, falhou: true, motivo: MSG_NAO_CONFERI }
  }
  if (!emitente?.habilitado) return { emite: false, motivo: 'Esta loja ainda não emite nota fiscal.' }

  const soConserto = itensRes.data.length > 0 && itensRes.data.every(i => {
    const p = (Array.isArray(i.products) ? i.products[0] : i.products) as { is_service: boolean } | null
    return !!p?.is_service
  })
  if (soConserto) return { emite: false, motivo: 'Venda só de conserto: conserto não entra na nota fiscal.' }

  return { emite: true }
}

// ─── Emitir ───────────────────────────────────────────────────────────────────

export async function emitirNotaDaVenda(saleId: string): Promise<ResultadoFiscal> {
  /* Chave geral desligada: recusa antes de tocar em banco ou provedor. A tela
   * já mostra "Em breve"; isto barra quem chamar a action direto. */
  if (!EMISSAO_NOTA_ATIVA) return { success: false, error: MSG_EMISSAO_EM_BREVE }

  const { error: authErr } = await verificarUsuario()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  // ── A venda ──
  const { data: venda, error: erroVenda } = await admin
    .from('sales')
    // `customers(name, phone)` é só para o botão de mandar a nota no WhatsApp
    // logo depois de emitir — o PDV não tem a cliente em mãos, só o id da venda.
    .select('id, sale_date, created_at, store_id, total, discount_amount, destinatario_cpf, notes, nfce_status, nfce_chave, customers(name, phone), stores(name)')
    .eq('id', saleId)
    .single()

  if (erroVenda || !venda) return { success: false, error: 'Venda não encontrada.' }
  if (!(await daMinhaLoja(venda.store_id))) return { success: false, error: 'Esta venda é de outra loja.' }

  /*
   * Já tem nota autorizada: para aqui.
   *
   * A `ref` idempotente da Focus já protege contra nota dupla, mas parar antes
   * evita a viagem e, mais importante, evita a tela dizer "emitido!" de novo
   * como se algo tivesse acontecido.
   */
  if (venda.nfce_status === 'autorizada' && venda.nfce_chave) {
    return {
      success: true, status: 'autorizada', chave: venda.nfce_chave,
      error: 'Esta venda já tem nota autorizada.',
      cliente:  (venda as any).customers?.name  ?? null,
      telefone: (venda as any).customers?.phone ?? null,
      loja:     (venda as any).stores?.name     ?? null,
    }
  }

  // ── O emitente da loja ──
  const { data: emitente } = await admin
    .from('fiscal_emitentes')
    .select('*, stores(cnpj)')
    .eq('store_id', venda.store_id)
    .single()

  if (!emitente) {
    return { success: false, error: 'Esta loja não tem emitente fiscal configurado.' }
  }

  /*
   * `habilitado` é a trava de segurança da migration, e existe para este
   * momento: tudo configurado, certificado no lugar, e ainda assim ninguém
   * emite até alguém virar a chave de propósito.
   */
  if (!emitente.habilitado) {
    return { success: false, error: 'Emissão desligada para esta loja. Ligue `habilitado` em fiscal_emitentes quando estiver pronto.' }
  }

  const cnpjLoja = (emitente.stores as { cnpj: string | null } | null)?.cnpj
  if (!cnpjLoja) return { success: false, error: 'Loja sem CNPJ cadastrado.' }

  // ── Itens, com a classificação fiscal já resolvida pela view ──
  /*
   * Falha de leitura PARA aqui, com a mensagem de rede. Era `(x ?? [])`: a
   * consulta de pagamentos falhava (coluna `method`, que não existe — o nome é
   * `payment_method`) e a nota era recusada como "venda sem forma de
   * pagamento", escondendo o erro de verdade.
   */
  const { data: itens, error: erroItens } = await admin
    .from('sale_items')
    .select('product_id, quantity, unit_price, products(code, name, is_service)')
    .eq('sale_id', saleId)

  if (erroItens) return { success: false, error: 'Não consegui ler os itens da venda. Tente de novo em instantes.' }
  if (!itens?.length) return { success: false, error: 'Venda sem itens.' }

  const { data: fiscais, error: erroFiscal } = await admin
    .from('fiscal_do_produto')
    .select('product_id, codigo_ncm, cfop, unidade, icms_origem, csosn')
    .in('product_id', itens.map(i => i.product_id))

  if (erroFiscal || !fiscais) return { success: false, error: 'Não consegui ler a classificação fiscal das peças. Tente de novo em instantes.' }
  const fiscalPorProduto = new Map(fiscais.map(f => [f.product_id, f]))

  // ── Pagamentos: sale_payments + peça devolvida na troca + o que ficou fiado ──
  const [pagRes, trocaRes] = await Promise.all([
    admin.from('sale_payments').select('payment_method, amount, card_brand').eq('sale_id', saleId),
    admin.from('exchanges').select('id').eq('sale_id', saleId),
  ])
  if (pagRes.error || !pagRes.data || trocaRes.error || !trocaRes.data) {
    return { success: false, error: 'Não consegui ler os pagamentos da venda. Tente de novo em instantes.' }
  }

  /* A troca é gravada com `sale_id` = a venda nova (ver src/lib/vendas/lista.ts):
   * a peça devolvida PAGA parte desta venda. */
  let creditoTroca = 0
  if (trocaRes.data.length) {
    const { data: devolvidos, error: erroDev } = await admin
      .from('exchange_items').select('quantity, unit_price')
      .in('exchange_id', trocaRes.data.map(t => t.id)).eq('direction', 'returned')
    if (erroDev || !devolvidos) return { success: false, error: 'Não consegui ler a troca da venda. Tente de novo em instantes.' }
    creditoTroca = devolvidos.reduce((s, d) => s + Number(d.unit_price) * Number(d.quantity), 0)
  }

  /*
   * O desconto é UM valor na venda e a NFC-e quer linha a linha, fechando no
   * centavo. `ratearDesconto` resolve isso — ver o comentário lá, que explica
   * por que o último item absorve o resto.
   */
  const base = itens.map(i => ({ quantidade: i.quantity, valor_unitario: Number(i.unit_price) }))
  const descontos = ratearDesconto(base, Number(venda.discount_amount) || 0)

  const itensNota: ItemVenda[] = itens.map((i, idx) => {
    const f = fiscalPorProduto.get(i.product_id)
    const prod = (Array.isArray(i.products) ? i.products[0] : i.products) as { code: string; name: string; is_service: boolean } | null
    return {
      product_id:     i.product_id,
      codigo:         prod?.code ?? i.product_id.slice(0, 8),
      descricao:      prod?.name ?? 'Peça',
      quantidade:     i.quantity,
      valor_unitario: Number(i.unit_price),
      desconto:       descontos[idx],
      codigo_ncm:     f?.codigo_ncm ?? null,
      cfop:           f?.cfop ?? null,
      unidade:        f?.unidade ?? null,
      icms_origem:    f?.icms_origem ?? null,
      csosn:          f?.csosn ?? null,
      servico:        !!prod?.is_service,
    }
  })

  const pagos = pagRes.data.map(p => ({
    metodo:   p.payment_method as MetodoPagamento,
    valor:    Number(p.amount),
    bandeira: p.card_brand ?? null,
  }))
  if (creditoTroca > 0) pagos.push({ metodo: 'troca', valor: parseFloat(creditoTroca.toFixed(2)), bandeira: null })
  /* Fiado: o saldo não é gravado em lugar nenhum — sai da conta, como na
   * lista de vendas (`faltaPagar`). Sobra de até 1 centavo não é fiado. */
  const fiado = parseFloat((Number(venda.total) - pagos.reduce((s, p) => s + p.valor, 0)).toFixed(2))
  if (fiado > 0.009) pagos.push({ metodo: 'fiado', valor: fiado, bandeira: null })

  const vendaCompleta: VendaParaNota = {
    id: venda.id,
    /*
     * `created_at`, não `sale_date`.
     *
     * `sale_date` é a data comercial e pode ser retroativa (a dona lança boleta
     * do dia anterior). A NFC-e quer o INSTANTE da emissão, com 5 minutos de
     * tolerância. Usar `sale_date` recusaria toda venda lançada depois.
     */
    data: venda.created_at,
    itens: itensNota,
    pagamentos: pagos,
    cpf_destinatario: venda.destinatario_cpf,
    observacao: venda.notes,
  }

  /* Conserto sai da nota (ver SERVICO_NA_NFCE). Só conserto: não há nota, e
   * não é erro — nada é gravado na venda. */
  const preparo = prepararParaNota(vendaCompleta)
  if (preparo.semNota) return { success: false, error: preparo.semNota }
  const vendaParaNota = preparo.venda
  const avisos = preparo.avisos

  const emitenteFiscal = {
    cnpj: cnpjLoja,
    serie_nfce: emitente.serie_nfce as number,
    ambiente: emitente.ambiente as AmbienteFiscal,
  }

  // ── Valida antes de gastar viagem ──
  const recusas = validarVenda(vendaParaNota, emitenteFiscal)
  if (recusas.length) {
    await admin.from('sales').update({
      nfce_status: 'erro',
      nfce_motivo_rejeicao: recusas.map(r => `${r.campo}: ${r.motivo}`).join(' · '),
    }).eq('id', saleId)
    return { success: false, error: 'A venda não está pronta para emitir.', recusas, avisos }
  }

  // ── Emite ──
  const ref = refDaVenda(saleId)
  await admin.from('sales').update({ nfce_status: 'pendente', nfce_ref: ref }).eq('id', saleId)

  const resp = await emitirNfce(emitenteFiscal.ambiente, ref, montarNfce(vendaParaNota, emitenteFiscal))

  /*
   * Timeout ou rede: a nota PODE ter saído. Fica `pendente` de propósito, com o
   * motivo escrito — quem resolve é `sincronizarNota`, consultando pela ref.
   * Marcar como erro aqui levaria alguém a reemitir e duplicar.
   */
  if (resp.status === 'processando_autorizacao') {
    await admin.from('sales').update({ nfce_motivo_rejeicao: resp.mensagem ?? null }).eq('id', saleId)
    return { success: false, status: 'pendente', error: resp.mensagem }
  }

  await gravarResultado(saleId, resp, emitenteFiscal.ambiente, ref)
  revalidatePath('/vendas')

  const daCliente = {
    cliente:  (venda as any).customers?.name  ?? null,
    telefone: (venda as any).customers?.phone ?? null,
    loja:     (venda as any).stores?.name     ?? null,
  }

  return resp.ok
    ? { success: true, status: 'autorizada', chave: resp.chave, danfeUrl: resp.danfeUrl, avisos, ...daCliente }
    : { success: false, status: resp.status, error: resp.mensagem ?? 'A nota não foi autorizada.', avisos }
}

// ─── Gravação do resultado ────────────────────────────────────────────────────

/**
 * Grava o que voltou, incluindo o XML.
 *
 * O XML é baixado e guardado no NOSSO banco, não só referenciado por link. São
 * duas razões, e estão na migration: a lei exige guarda de 5 anos mais o ano
 * corrente, e é o que permite trocar de provedor sem migração — sem isso o
 * histórico fiscal fica preso a quem contratamos.
 *
 * Se o download do XML falhar, a nota **continua autorizada**. Só o arquivo
 * fica para depois; nunca o contrário.
 */
async function gravarResultado(
  saleId: string,
  resp: Awaited<ReturnType<typeof emitirNfce>>,
  ambiente: AmbienteFiscal,
  ref: string,
) {
  const admin = createAdminClient()

  const statusBanco =
    resp.status === 'autorizado' ? 'autorizada'
    : resp.status === 'cancelado' ? 'cancelada'
    : resp.status === 'denegado' ? 'rejeitada'
    : resp.status === 'erro_autorizacao' ? 'rejeitada'
    : 'erro'

  let xml: string | null = null
  if (resp.ok && resp.xmlUrl) {
    try {
      const r = await fetch(resp.xmlUrl, { signal: AbortSignal.timeout(15_000) })
      if (r.ok) xml = await r.text()
    } catch { /* nota vale, arquivo fica para depois */ }
  }

  await admin.from('sales').update({
    nfce_status:          statusBanco,
    nfce_ref:             ref,
    nfce_chave:           resp.chave ?? null,
    nfce_numero:          resp.numero ? Number(resp.numero) : null,
    nfce_serie:           resp.serie ? Number(resp.serie) : null,
    nfce_danfe_url:       resp.danfeUrl ?? null,
    /* O cupom 80mm (/cupom/[id]) usa estes dois quando o XML não foi baixado. */
    nfce_qrcode_url:      resp.qrcodeUrl ?? null,
    nfce_protocolo:       resp.protocolo ?? null,
    nfce_xml:             xml,
    nfce_motivo_rejeicao: resp.ok ? null : (resp.mensagem ?? null),
    nfce_emitida_em:      resp.ok ? new Date().toISOString() : null,
  }).eq('id', saleId)

  // Avança a numeração da loja só quando a nota REALMENTE saiu.
  if (resp.ok && resp.numero) {
    const { data: v } = await admin.from('sales').select('store_id').eq('id', saleId).single()
    if (v?.store_id) {
      await admin.from('fiscal_emitentes')
        .update({ proximo_numero_nfce: Number(resp.numero) + 1, updated_at: new Date().toISOString() })
        .eq('store_id', v.store_id)
    }
  }
}

// ─── Sincronizar ──────────────────────────────────────────────────────────────

/**
 * Pergunta à Focus o que aconteceu com uma nota, pela nossa referência.
 *
 * É a saída para o caso "a rede caiu no meio": a nota pode ter sido autorizada
 * sem a resposta ter chegado. Reemitir seria o instinto errado — a consulta é
 * o que diz a verdade, e a `ref` é o que torna a pergunta possível.
 */
export async function sincronizarNota(saleId: string): Promise<ResultadoFiscal> {
  if (!EMISSAO_NOTA_ATIVA) return { success: false, error: MSG_EMISSAO_EM_BREVE }

  const { error: authErr } = await verificarUsuario()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { data: venda } = await admin
    .from('sales').select('id, store_id, nfce_ref').eq('id', saleId).single()

  if (!(await daMinhaLoja(venda?.store_id ?? null))) return { success: false, error: 'Esta venda é de outra loja.' }
  if (!venda?.nfce_ref) return { success: false, error: 'Esta venda nunca teve emissão iniciada.' }

  const { data: emitente } = await admin
    .from('fiscal_emitentes').select('ambiente').eq('store_id', venda.store_id).single()

  const ambiente = (emitente?.ambiente ?? 'homologacao') as AmbienteFiscal
  const resp = await consultarNfce(ambiente, venda.nfce_ref, true)

  if (resp.status === 'nao_encontrado') {
    // Nunca chegou lá: dá para emitir de novo com segurança.
    await admin.from('sales').update({
      nfce_status: 'erro',
      nfce_motivo_rejeicao: 'A Focus não conhece esta referência — a emissão não chegou. Pode emitir de novo.',
    }).eq('id', saleId)
    return { success: false, error: 'A emissão não chegou à Focus. Pode emitir de novo.' }
  }

  await gravarResultado(saleId, resp, ambiente, venda.nfce_ref)
  revalidatePath('/vendas')

  return resp.ok
    ? { success: true, status: 'autorizada', chave: resp.chave, danfeUrl: resp.danfeUrl }
    : { success: false, status: resp.status, error: resp.mensagem }
}

// ─── Cancelar ─────────────────────────────────────────────────────────────────

/**
 * Cancela a nota. **Não desfaz a venda.**
 *
 * São coisas separadas de propósito: cancelar nota é ato fiscal, desfazer venda
 * mexe em estoque e comissão. Juntar as duas numa ação faria alguém apagar uma
 * venda real querendo só corrigir a nota.
 *
 * O SEFAZ dá 30 minutos para cancelar NFC-e. Passado isso, o caminho é outro
 * (nota de devolução), e o erro que volta explica.
 */
export async function cancelarNotaDaVenda(saleId: string, justificativa: string): Promise<ResultadoFiscal> {
  const { error: authErr } = await verificarAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { data: venda } = await admin
    .from('sales').select('id, store_id, nfce_ref, nfce_status').eq('id', saleId).single()

  if (!(await daMinhaLoja(venda?.store_id ?? null))) return { success: false, error: 'Esta venda é de outra loja.' }
  if (!venda?.nfce_ref) return { success: false, error: 'Esta venda não tem nota.' }
  if (venda.nfce_status !== 'autorizada') {
    return { success: false, error: `Só nota autorizada pode ser cancelada (esta está "${venda.nfce_status}").` }
  }

  const { data: emitente } = await admin
    .from('fiscal_emitentes').select('ambiente').eq('store_id', venda.store_id).single()

  const resp = await cancelarNfce(
    (emitente?.ambiente ?? 'homologacao') as AmbienteFiscal,
    venda.nfce_ref,
    justificativa,
  )

  if (resp.ok || resp.status === 'cancelado') {
    await admin.from('sales').update({
      nfce_status: 'cancelada',
      nfce_motivo_rejeicao: justificativa.trim(),
    }).eq('id', saleId)
    revalidatePath('/vendas')
    return { success: true, status: 'cancelada' }
  }

  return { success: false, status: resp.status, error: resp.mensagem ?? 'Não foi possível cancelar.' }
}
