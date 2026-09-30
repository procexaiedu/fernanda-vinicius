'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calcularTotalDaVenda } from '@/lib/vendas/total'
import { getProfile, lojaDoEscopo } from '@/lib/auth'
import { produtoDeConserto } from '@/lib/conserto'
import { registrarPagamentoDoConserto, registrarConsertoDaVenda } from '@/app/(sistema)/consertos/interno'
import { lojaEmiteNota } from '@/lib/fiscal/emitente'
import {
  idDeRequisicaoValido, colunaDeIdempotenciaAusente, violouUnico, avisarIdempotenciaDesligada,
} from '@/lib/idempotencia'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean
  error?: string
  saleId?: string
  /**
   * O `clientRequestId` enviado já pertence a OUTRA venda — ver
   * `respostaDaVendaJaGravada`. Nada foi gravado; a tela troca o id para que
   * o próximo clique lance esta venda de verdade.
   */
  idReusado?: boolean
}

export interface SaleItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  unitCost: number
  /**
   * Linha de CONSERTO: serviço do Ourives que a cliente paga junto com as
   * peças. Sem custo, sem estoque e fora da comissão — ver src/lib/conserto.ts.
   *
   * Quando marcada, o `productId` que vem da tela é IGNORADO: quem resolve o
   * serviço da loja é o servidor.
   */
  isConserto?: boolean
  /**
   * O conserto registrado que esta linha está cobrando, quando houver.
   *
   * Ao salvar a venda, ele é marcado como ENTREGUE e passa a apontar para esta
   * linha. É o que faz a tela de consertos e o PDV falarem a mesma língua: sem
   * isso, ela cobrava na venda e a peça continuava "na loja" para sempre.
   *
   * Opcional de propósito — cobrar um conserto que ninguém registrou tem de
   * continuar funcionando, senão ela trava no balcão.
   */
  consertoId?: string | null
  /** O que foi consertado, quando ela digita em vez de escolher uma peça registrada. */
  consertoDescricao?: string | null
  /**
   * A peça FICOU na loja? Só faz sentido quando o conserto nasce desta venda.
   *
   * Distingue os dois jeitos: pagou e levou na hora, ou pagou adiantado e a
   * peça continua aqui esperando o ourives.
   */
  consertoFicouNaLoja?: boolean
}

export interface SalePaymentRow {
  method: 'cash' | 'pix' | 'debit' | 'credit'
  amount: number
  installments: number
  cardBrand?: string | null   // bandeira (crédito/débito), opcional
}

export interface ExchangeItemSelected {
  productId: string
  productName: string
  quantity: number
  unitPrice: number            // valor creditado à cliente pela peça devolvida
  /*
   * A venda de origem, quando se sabe qual é.
   *
   * No fluxo do balcão a peça chega com a etiqueta e é bipada — ninguém
   * procura a venda antiga. Fica nulo, e tudo bem: o que importa para o
   * estoque e para o caixa é a peça e o valor, não de qual nota ela saiu.
   */
  originalSaleId?: string | null
  saleItemId?: string
}

export interface VendaFormData {
  storeId: string
  saleDate: string          // YYYY-MM-DD
  customerId: string | null
  customerBirthdayMonth: number | null   // 1-12 ou null
  sellerId: string | null   // funcionária que realizou a venda
  items: SaleItem[]
  hasPix: boolean
  hasBirthday: boolean
  manualDiscount: number    // valor fixo R$
  payments: SalePaymentRow[]
  exchangeItems: ExchangeItemSelected[]  // itens a devolver via troca
  /** Data prometida quando a venda fecha com saldo em aberto. Null quando quitada. */
  previsaoPagamento?: string | null
  /** CPF que vai na NFC-e desta venda. Fica na venda, não no cadastro da cliente. */
  destinatarioCpf?: string | null
  notes: string
  /**
   * Id desta venda NOVA, gerado pela tela e guardado no rascunho — ver
   * `vendaJaGravada`. É o que impede o reenvio (resposta perdida, rascunho
   * recuperado, duplo clique) de lançar a venda duas vezes. Só `salvarVenda`
   * usa; a edição ignora.
   */
  clientRequestId?: string | null
}

export interface VendaDetail {
  id: string
  sale_date: string
  store_name: string
  customer_name: string | null
  customer_phone: string | null
  customer_id: string | null
  seller_name: string | null
  subtotal: number
  discount_type: string | null
  discount_pct: number
  discount_amount: number
  total: number
  total_cost: number
  payment_summary: string | null
  status: string
  notes: string | null
  items: Array<{
    id: string
    product_name: string
    product_code: string
    quantity: number
    unit_price: number
    unit_cost: number
    subtotal: number
  }>
  payments: Array<{
    id: string
    payment_method: string
    amount: number
    installments: number
  }>
  exchange: {
    id: string
    price_difference: number
    returned_items: Array<{ product_name: string; product_code: string; quantity: number; unit_price: number }>
    given_items: Array<{ product_name: string; product_code: string; quantity: number; unit_price: number }>
  } | null
  /** A nota, quando existe. `null` em status = nunca pediu nota. */
  nfce: {
    status: string | null
    chave: string | null
    numero: number | null
    serie: number | null
    danfe_url: string | null
    motivo_rejeicao: string | null
    emitida_em: string | null
  }
  destinatario_cpf: string | null
  /** A loja desta venda tem emitente ligado. Decide se o botão de emitir existe. */
  emiteNota: boolean
}

export interface VendaParaTroca {
  id: string
  sale_date: string
  subtotal: number   // soma dos preços sem desconto
  total: number      // valor efetivamente pago (com desconto)
  items: Array<{
    id: string
    product_id: string
    product_name: string
    product_code: string
    unit_price: number       // preço unitário sem desconto
    effective_unit_price: number  // preço efetivo pago (proporcional ao desconto)
    quantity: number
    already_returned: boolean
  }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function verifyUser(): Promise<{ userId: string | null; role: string | null; storeId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, role: null, storeId: null, error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users').select('role, store_id').eq('id', user.id).single()

  return {
    userId: user.id,
    role: profile?.role ?? null,
    storeId: profile?.store_id ?? null,
    error: null,
  }
}

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa', mastercard: 'Master', elo: 'Elo', amex: 'Amex', hipercard: 'Hipercard',
}

function buildPaymentSummary(payments: SalePaymentRow[], hasExchange: boolean, exchangeCredit: number): string {
  const labels: string[] = []
  for (const p of payments) {
    const methodLabel = { cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito' }[p.method] ?? p.method
    const brand = p.cardBrand ? ` ${BRAND_LABEL[p.cardBrand] ?? p.cardBrand}` : ''
    if (p.method === 'credit' && p.installments > 1) {
      labels.push(`${methodLabel}${brand} ${p.installments}x`)
    } else {
      labels.push(`${methodLabel}${brand}`)
    }
  }
  if (hasExchange) labels.push(`Troca (R$ ${exchangeCredit.toFixed(2).replace('.', ',')})`)
  return labels.join(' + ')
}

// NOTA: o fechamento de caixa é um SNAPSHOT de conferência de um período (a
// vendedora fecha e a visão zera dali). Por isso registros de fechamento não são
// reescritos quando uma venda é criada/editada/excluída depois — o snapshot vale
// como "o que foi conferido naquele momento". A verdade contábil está nas vendas.

/**
 * Troca as linhas de conserto pelo serviço da loja, com custo zero.
 *
 * Roda no servidor de propósito: a tela só declara "isto é conserto e custa
 * tanto". Deixar o `productId` vir de lá abriria caminho para lançar qualquer
 * produto como serviço — e serviço não baixa estoque, então a peça sairia da
 * loja sem sair do sistema.
 */
async function resolverConsertos(
  admin: ReturnType<typeof createAdminClient>,
  storeId: string,
  items: SaleItem[],
): Promise<{ items: SaleItem[]; error?: string }> {
  if (!items.some(i => i.isConserto)) return { items }

  const { id, error } = await produtoDeConserto(admin, storeId)
  if (!id) return { items, error }

  return {
    items: items.map(i => i.isConserto
      ? { ...i, productId: id, productName: 'Conserto', unitCost: 0 }
      : i),
  }
}

/**
 * Fecha os consertos que esta venda cobrou.
 *
 * O `RETURNING` de um INSERT com várias linhas devolve na MESMA ORDEM em que
 * foram enviadas, então o índice casa item com a linha criada. É o que permite
 * gravar em qual `sale_item` cada conserto foi cobrado.
 *
 * Falhar aqui não derruba a venda: a venda aconteceu e o dinheiro entrou. Um
 * conserto que ficou marcado como "pronto" é corrigível na tela; uma venda
 * perdida, não.
 */
async function fecharConsertosDaVenda(
  items: SaleItem[],
  criados: { id: string }[] | null,
  contexto: { storeId: string; customerId: string | null; userId: string },
): Promise<void> {
  if (!criados?.length) return

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item?.isConserto || !criados[i]) continue

    try {
      if (item.consertoId) {
        /*
         * Peça já registrada: a venda diz que foi PAGA, não que saiu.
         *
         * Pagar e entregar são coisas diferentes — "ela diz se a cliente paga o
         * conserto depois ou antes". Pagando adiantado, a peça continua na loja,
         * e marcá-la como entregue aqui a apagaria da tela justamente enquanto
         * ainda está aqui. Quem entrega é quem clica em "Cliente levou".
         */
        await registrarPagamentoDoConserto(item.consertoId, criados[i].id)
      } else {
        /*
         * Cobrança direta, sem peça registrada antes. O PDV cria o registro —
         * senão o conserto existiria só como dinheiro, e a tela de Consertos
         * ficaria cega para ele.
         */
        await registrarConsertoDaVenda({
          storeId:     contexto.storeId,
          customerId:  contexto.customerId,
          descricao:   item.consertoDescricao ?? null,
          saleItemId:  criados[i].id,
          userId:      contexto.userId,
          ficouNaLoja: !!item.consertoFicouNaLoja,
        })
      }
    } catch (e) {
      /*
       * A venda NÃO falha por isto (ver a nota acima: a venda vale mais que o
       * vínculo). Mas o catch era vazio, e um conserto que não fechou sumia
       * sem rastro — agora fica no log do servidor com o que precisa para
       * corrigir à mão na tela de Consertos.
       */
      console.error('[vendas] conserto não foi fechado pela venda', {
        consertoId: item.consertoId ?? null, saleItemId: criados[i].id, erro: e,
      })
    }
  }
}

type Admin = ReturnType<typeof createAdminClient>

/** Número que a conta aceita: finito, não NaN. `typeof` sozinho deixa NaN passar. */
function numeroValido(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * A mesma conferência que o formulário faz, agora também aqui.
 *
 * A tela bloqueia quantidade zero, preço zero e pagamento sem valor — mas a
 * tela é só uma das portas: um formulário antigo aberto antes de um deploy,
 * ou uma chamada feita à mão, mandava o que quisesse, e o banco gravava venda
 * com quantidade −1 (estoque SUBINDO numa venda) ou pagamento de R$0 que vira
 * transação de R$0 no financeiro.
 */
function conferirValores(data: VendaFormData): string | null {
  for (const [i, it] of data.items.entries()) {
    if (!numeroValido(it.quantity) || !Number.isInteger(it.quantity) || it.quantity < 1) {
      return `Item ${i + 1}: a quantidade tem de ser 1 ou mais.`
    }
    /* O formulário não aceita preço zero em linha nenhuma, nem no conserto
     * ("informe quanto você cobrou"). Brinde não existe no fluxo da loja. */
    if (!numeroValido(it.unitPrice) || it.unitPrice <= 0) {
      return `Item ${i + 1} (${it.productName || 'sem nome'}): preço inválido.`
    }
  }
  for (const [i, ei] of data.exchangeItems.entries()) {
    if (!numeroValido(ei.quantity) || !Number.isInteger(ei.quantity) || ei.quantity < 1) {
      return `Peça devolvida ${i + 1}: a quantidade tem de ser 1 ou mais.`
    }
    if (!numeroValido(ei.unitPrice) || ei.unitPrice <= 0) {
      return `Peça devolvida ${i + 1} (${ei.productName || 'sem nome'}): valor inválido.`
    }
  }
  for (const [i, p] of data.payments.entries()) {
    if (!numeroValido(p.amount) || p.amount <= 0) {
      return `Pagamento ${i + 1}: informe um valor maior que zero, ou remova a linha.`
    }
    if (!numeroValido(p.installments) || !Number.isInteger(p.installments) || p.installments < 1) {
      return `Pagamento ${i + 1}: número de parcelas inválido.`
    }
  }
  if (!numeroValido(data.manualDiscount) || data.manualDiscount < 0) {
    return 'Desconto manual inválido.'
  }
  return null
}

/**
 * Lê os percentuais de desconto. Antes era `settingsRows ?? []`: uma falha de
 * leitura caía no padrão (5% e 10%) calada — e se a dona tivesse mudado o
 * percentual, a venda gravava com o desconto velho sem ninguém saber.
 */
async function lerPercentuais(admin: Admin): Promise<{ pixPct: number; birthdayPct: number } | { error: string }> {
  const { data: settingsRows, error } = await admin
    .from('settings')
    .select('key, value')
    .in('key', ['pix_discount_pct', 'birthday_discount_pct'])
  if (error || !settingsRows) {
    console.error('[vendas] falha ao ler settings de desconto', error)
    return { error: 'Não consegui ler as configurações de desconto. Nada foi gravado — tente de novo em instantes.' }
  }
  const settingsMap = new Map(settingsRows.map(s => [s.key, Number(s.value)]))
  return {
    pixPct:      settingsMap.get('pix_discount_pct') ?? 5,
    birthdayPct: settingsMap.get('birthday_discount_pct') ?? 10,
  }
}

/**
 * Toda peça da venda (levada ou devolvida) é da loja da venda — e o custo sai
 * do cadastro, não do navegador.
 *
 * LOJA: o admin trocava a loja no formulário com peças da outra loja já na
 * grade, e a venda gravava em Campinas baixando estoque de Brasília. A tela
 * agora tira essas linhas ao trocar; aqui é a garantia.
 *
 * CUSTO: `unit_cost` vinha do navegador. O preço de custo é escondido das
 * funcionárias na interface, mas ia no pacote de produtos para o formulário
 * e voltava de lá — qualquer valor que chegasse virava o CMV da venda.
 * Relendo aqui, o que grava é o cadastro no momento da venda.
 *
 * Linha de conserto fica de fora: o `productId` dela é ignorado e trocado
 * pelo serviço da loja em `resolverConsertos`, com custo zero.
 */
async function conferirPecasDaLoja(
  admin: Admin,
  storeId: string,
  data: VendaFormData,
): Promise<{ custos: Map<string, number> } | { error: string }> {
  const ids = [...new Set([
    ...data.items.filter(i => !i.isConserto).map(i => i.productId),
    ...data.exchangeItems.map(i => i.productId),
  ])]
  if (ids.some(id => !id)) return { error: 'Há uma linha sem peça escolhida do catálogo.' }
  if (!ids.length) return { custos: new Map() }

  const { data: prods, error } = await admin
    .from('products')
    .select('id, name, store_id, cost_price')
    .in('id', ids)
  if (error || !prods) {
    console.error('[vendas] falha ao conferir as peças da venda', error)
    return { error: 'Não consegui conferir as peças no cadastro. Nada foi gravado — tente de novo em instantes.' }
  }

  const porId = new Map(prods.map(p => [p.id as string, p]))
  for (const id of ids) {
    const p = porId.get(id)
    if (!p) return { error: 'Uma das peças da venda não existe mais no cadastro. Tire a linha e bipe de novo.' }
    if (p.store_id !== storeId) {
      return { error: `A peça "${p.name}" é de outra loja. Tire a linha da venda — cada loja só vende o próprio estoque.` }
    }
  }
  return { custos: new Map(prods.map(p => [p.id as string, Number(p.cost_price) || 0])) }
}

/**
 * O conserto que a linha diz cobrar é mesmo DESTA cliente?
 *
 * A tela oferece os consertos da cliente selecionada, mas trocar a cliente
 * depois de escolher deixava o `consertoId` antigo na linha — e a venda da
 * Maria marcava como pago o conserto da Ana. A tela passou a limpar; esta é a
 * conferência que não depende dela.
 */
async function conferirConsertosDaCliente(
  admin: Admin,
  customerId: string | null,
  items: SaleItem[],
): Promise<string | null> {
  const ids = [...new Set(items.filter(i => i.isConserto && i.consertoId).map(i => i.consertoId as string))]
  if (!ids.length) return null
  if (!customerId) return 'O conserto escolhido pertence a uma cliente — selecione a cliente da venda.'

  const { data: consertos, error } = await admin
    .from('consertos')
    .select('id, customer_id')
    .in('id', ids)
  if (error || !consertos) {
    console.error('[vendas] falha ao conferir consertos da venda', error)
    return 'Não consegui conferir o conserto escolhido. Nada foi gravado — tente de novo em instantes.'
  }
  if (consertos.length !== ids.length || consertos.some(c => c.customer_id !== customerId)) {
    return 'O conserto escolhido não é desta cliente. Escolha de novo a peça na linha do conserto.'
  }
  return null
}

/**
 * Soma `delta` ao estoque de uma peça (negativo = saiu). Serviço não tem estoque.
 *
 * Antes cada lugar fazia `(prod?.quantity_in_stock ?? 0) + delta`: se a
 * LEITURA falhasse (rede, timeout), o `?? 0` gravava o saldo como se a peça
 * tivesse zero — uma peça com 5 em estoque vendida com a leitura falhando
 * ficava com −1. Agora leitura falhou = não grava nada, e quem chamou fica
 * sabendo qual peça ficou para trás.
 *
 * Continua sendo ler-e-escrever (não é atômico); o conserto de verdade é uma
 * RPC com `quantity_in_stock = quantity_in_stock + delta`, que muda o banco e
 * ficou fora desta correção.
 *
 * Devolve `null` quando deu certo, ou o nome/id da peça que ficou para trás.
 */
async function moverEstoque(
  admin: Admin,
  productId: string,
  delta: number,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  const { data: prod, error } = await admin
    .from('products')
    .select('name, quantity_in_stock, is_service')
    .eq('id', productId)
    .single()
  if (error || !prod) {
    console.error('[vendas] leitura de estoque falhou — saldo NÃO alterado', { productId, delta, error })
    return productId
  }
  if (prod.is_service) return null   // serviço (conserto) não controla estoque

  const { error: updErr } = await admin
    .from('products')
    .update({ quantity_in_stock: (Number(prod.quantity_in_stock) || 0) + delta, ...extra })
    .eq('id', productId)
  if (updErr) {
    console.error('[vendas] gravação de estoque falhou', { productId, delta, error: updErr })
    return prod.name ?? productId
  }
  return null
}

/**
 * Mensagem para quando a venda JÁ ESTÁ gravada mas um passo depois falhou.
 *
 * Voltar "erro" puro aqui era o pior dos mundos: a tela liberava o botão, ela
 * clicava de novo e a venda entrava duas vezes. Com `saleId` na resposta o
 * formulário sabe que a venda existe e não deixa salvar de novo.
 */
function gravadaComPendencia(o_que: string): string {
  return `A venda FOI gravada, mas ${o_que}. NÃO salve de novo (duplicaria a venda) — confira em Vendas e avise a administração.`
}

/**
 * A venda com este `client_request_id` — o reenvio de uma venda que já entrou.
 *
 * `{ saleId: null }` = não existe, pode gravar. `colunaAusente` = a migration
 * de 30/09 ainda não foi aplicada: segue SEM idempotência (o deploy não pode
 * travar o balcão por causa da ordem). `erro` = não deu para conferir.
 */
async function procurarVendaPorPedido(
  admin: Admin, idReq: string,
): Promise<{ saleId: string | null } | { colunaAusente: true } | { erro: true }> {
  const { data, error } = await admin
    .from('sales').select('id').eq('client_request_id', idReq).maybeSingle()
  if (error) {
    if (colunaDeIdempotenciaAusente(error)) {
      avisarIdempotenciaDesligada('sales', error)
      return { colunaAusente: true }
    }
    console.error('[salvarVenda] falha ao procurar venda pelo client_request_id', error)
    return { erro: true }
  }
  return { saleId: (data?.id as string | undefined) ?? null }
}

/** Diferença até um centavo é arredondamento, não outra venda. */
const TOLERANCIA_CENTAVO = 0.011

/* A tela reconhece este caso por `idReusado`, não pelo texto — e nem daria
 * para exportar a constante: arquivo 'use server' só exporta função async. */
const MSG_ID_DE_OUTRA_VENDA =
  'Este salvamento já foi usado para outra venda. Recarregue a página (F5) e lance de novo — nada desta venda foi gravado.'

/**
 * A resposta para um reenvio cuja venda JÁ EXISTE.
 *
 * Não basta devolver "sucesso": o primeiro envio pode ter gravado a venda e
 * parado num passo depois (itens, pagamento) — a resposta de pendência é que
 * se perdeu. Então confere se itens e pagamentos entraram todos, pela mesma
 * contagem que a tela mandou (cada linha vira uma linha, 1 para 1).
 *
 * ANTES disso confere se é MESMO a mesma venda (impressão digital: loja,
 * cliente, total e nº de peças). O id vive no rascunho e na tela; se por
 * qualquer caminho ele sobrar de uma venda já gravada e for mandado com
 * OUTRA venda, só contar linhas devolvia "sucesso" — a tela mostrava "venda
 * registrada", o rascunho sumia e a venda nova nunca entrava no caixa.
 * Divergiu: erro claro, nada gravado, e `idReusado` para a tela gerar outro id.
 *
 * Com pendência (ou sem conseguir conferir) volta `saleId` junto do erro: a
 * tela trava o botão e apaga o rascunho, como no caminho normal — ver
 * `gravadaComPendencia`.
 */
async function respostaDaVendaJaGravada(
  admin: Admin, saleId: string, data: VendaFormData, storeId: string,
): Promise<ActionResult> {
  const [vendaRes, itensRes, pagRes] = await Promise.all([
    admin.from('sales').select('store_id, customer_id, total, discount_pct').eq('id', saleId).maybeSingle(),
    admin.from('sale_items').select('id', { count: 'exact', head: true }).eq('sale_id', saleId),
    admin.from('sale_payments').select('id', { count: 'exact', head: true }).eq('sale_id', saleId),
  ])
  if (vendaRes.error || !vendaRes.data || itensRes.error || pagRes.error) {
    console.error('[salvarVenda] reenvio: falha ao conferir a venda existente', { saleId, error: vendaRes.error ?? itensRes.error ?? pagRes.error })
    return {
      success: false, saleId,
      error: 'Esta venda JÁ ESTAVA gravada (o primeiro envio chegou), mas não consegui conferir se entrou completa. NÃO salve de novo — confira em Vendas.',
    }
  }

  /*
   * O total esperado sai da MESMA conta do insert (src/lib/vendas/total.ts),
   * com o percentual que ficou gravado na venda — assim uma mudança de
   * configuração entre os dois envios não faz a mesma venda parecer outra.
   */
  const venda    = vendaRes.data
  const subtotal = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const pctGravado = data.hasPix || data.hasBirthday ? Number(venda.discount_pct) || 0 : 0
  const { total: totalEsperado } = calcularTotalDaVenda({
    subtotal, discountPct: pctGravado, manualDiscount: data.manualDiscount,
  })
  const outraVenda =
    venda.store_id !== storeId
    || (venda.customer_id ?? null) !== (data.customerId ?? null)
    || Math.abs((Number(venda.total) || 0) - totalEsperado) > TOLERANCIA_CENTAVO
    /* Mais peças gravadas do que as mandadas não é pendência — é outra venda.
     * Menos continua sendo "gravada pela metade", logo abaixo. */
    || (itensRes.count ?? 0) > data.items.length
  if (outraVenda) {
    console.error('[salvarVenda] clientRequestId de OUTRA venda — nada gravado', {
      saleId,
      gravada: { loja: venda.store_id, cliente: venda.customer_id, total: venda.total, itens: itensRes.count },
      enviada: { loja: storeId, cliente: data.customerId ?? null, total: totalEsperado, itens: data.items.length },
    })
    return { success: false, idReusado: true, error: MSG_ID_DE_OUTRA_VENDA }
  }

  if ((itensRes.count ?? 0) < data.items.length || (pagRes.count ?? 0) < data.payments.length) {
    console.error('[salvarVenda] reenvio de venda gravada pela metade', {
      saleId, itens: itensRes.count, esperadoItens: data.items.length, pagamentos: pagRes.count,
    })
    return { success: false, saleId, error: gravadaComPendencia('pode ter ficado incompleta (peças ou pagamentos)') }
  }
  console.info('[salvarVenda] reenvio reconhecido — devolvendo a venda já gravada', { saleId })
  return { success: true, saleId }
}

/**
 * O motivo para uma venda NÃO poder ser editada, ou `null`.
 *
 * `editarVenda` refaz a venda do zero: apaga itens, pagamentos e troca e
 * grava de novo. Dois vínculos não sobrevivem a isso:
 *
 * - TROCA: a tela de edição não carrega as peças devolvidas. Salvar apagava a
 *   troca, tirava do estoque a peça que tinha voltado e o crédito da cliente
 *   sumia.
 * - CONSERTO: o conserto aponta para a linha da venda (`sale_item_id`). Apagar
 *   as linhas solta o conserto (ON DELETE SET NULL) — ele volta a parecer "não
 *   pago" na tela de Consertos, com o dinheiro já no caixa.
 *
 * Refazer os dois com segurança é trabalho maior; até lá, bloquear é o que não
 * estraga nada. Excluir e lançar de novo continua possível.
 */
async function motivoParaNaoEditar(admin: Admin, saleId: string): Promise<string | null> {
  const [exchRes, itensRes] = await Promise.all([
    admin.from('exchanges').select('id').eq('sale_id', saleId).limit(1),
    admin.from('sale_items').select('id').eq('sale_id', saleId),
  ])
  if (exchRes.error || itensRes.error || !itensRes.data) {
    console.error('[vendas] falha ao conferir se a venda pode ser editada', exchRes.error ?? itensRes.error)
    return 'Não consegui conferir se esta venda pode ser editada. Tente de novo em instantes.'
  }
  if (exchRes.data?.length) {
    return 'Esta venda tem troca (peça devolvida) e não pode ser editada — editar apagaria a troca e o crédito da cliente. Se precisar corrigir, exclua a venda e lance de novo.'
  }

  const itemIds = itensRes.data.map(i => i.id as string)
  if (itemIds.length) {
    const { data: consertos, error } = await admin
      .from('consertos').select('id').in('sale_item_id', itemIds).limit(1)
    if (error) {
      console.error('[vendas] falha ao conferir consertos da venda', error)
      return 'Não consegui conferir se esta venda pode ser editada. Tente de novo em instantes.'
    }
    if (consertos?.length) {
      return 'Esta venda cobrou um conserto e não pode ser editada — editar soltaria o conserto do pagamento na tela de Consertos. Se precisar corrigir, exclua a venda e lance de novo.'
    }
  }
  return null
}

/**
 * Tudo o que se confere ANTES de gravar qualquer coisa: valores, percentuais,
 * peças da loja (e o custo delas), conserto da cliente, serviço de conserto.
 *
 * Numa ordem só para `salvarVenda` e `editarVenda` — foi por ter a mesma regra
 * escrita em dois lugares que o arredondamento divergiu em 01/09 (ver
 * src/lib/vendas/total.ts). Falhar aqui não deixa rastro no banco.
 */
async function prepararVenda(
  admin: Admin,
  storeId: string,
  data: VendaFormData,
): Promise<{ data: VendaFormData; pixPct: number; birthdayPct: number } | { error: string }> {
  if (!data.items.length) return { error: 'Adicione ao menos um produto.' }

  const erroValores = conferirValores(data)
  if (erroValores) return { error: erroValores }

  const pct = await lerPercentuais(admin)
  if ('error' in pct) return pct

  const pecas = await conferirPecasDaLoja(admin, storeId, data)
  if ('error' in pecas) return pecas

  const erroConserto = await conferirConsertosDaCliente(admin, data.customerId, data.items)
  if (erroConserto) return { error: erroConserto }

  /* Antes rodava DEPOIS de inserir a venda: se o serviço da loja não
   * existisse, a venda ficava gravada sem itens. */
  const { items: itensResolvidos, error: consertoErr } = await resolverConsertos(admin, storeId, data.items)
  if (consertoErr) {
    console.error('[vendas] serviço de conserto da loja indisponível', consertoErr)
    return { error: 'Não consegui preparar a linha de conserto. Nada foi gravado — tente de novo em instantes.' }
  }

  return {
    data: {
      ...data,
      items: itensResolvidos.map(i => i.isConserto
        ? i
        : { ...i, unitCost: pecas.custos.get(i.productId) ?? 0 }),
    },
    pixPct: pct.pixPct,
    birthdayPct: pct.birthdayPct,
  }
}

// ─── Action: salvar venda ─────────────────────────────────────────────────────

export async function salvarVenda(data: VendaFormData): Promise<ActionResult> {
  const { userId, role, storeId: userStoreId, error: authErr } = await verifyUser()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  /*
   * QUEM TEM LOJA ESTÁ PRESO A ELA — admin ou não. É a regra de
   * `lojaDoEscopo` em src/lib/auth.ts, escrita aqui à mão porque só temos
   * `role` e `storeId`, não o perfil inteiro.
   *
   * Era `role === 'operator' && userStoreId ? userStoreId : data.storeId`: a
   * Eleandra é ADMIN COM LOJA, caía no segundo ramo e lançava venda em
   * Campinas mandando outro `storeId` pelo navegador. O ternário sobre o papel
   * não sabe responder sobre escopo — são eixos diferentes.
   */
  const finalStoreId = userStoreId ?? data.storeId
  if (!finalStoreId) return { success: false, error: 'Loja não definida.' }

  // ── 0. Reenvio de uma venda que já entrou? ────────────────────────────────
  /*
   * ANTES de qualquer escrita — inclusive `resolverConsertos`, dentro de
   * `prepararVenda`. A resposta do primeiro envio pode ter se perdido (rede,
   * timeout, deploy) com a venda inteira gravada; sem esta conferência o
   * segundo clique — ou o rascunho recuperado — lançava tudo de novo: estoque
   * baixado duas vezes, pagamento em dobro no caixa.
   */
  let idReq = idDeRequisicaoValido(data.clientRequestId)
  if (idReq) {
    const achada = await procurarVendaPorPedido(admin, idReq)
    if ('colunaAusente' in achada) idReq = null
    else if ('erro' in achada) {
      /* Na dúvida não grava: seguir às cegas é exatamente o que duplica. */
      return { success: false, error: 'Não consegui conferir se esta venda já tinha sido gravada. Nada foi registrado agora — tente salvar de novo em instantes.' }
    } else if (achada.saleId) {
      return respostaDaVendaJaGravada(admin, achada.saleId, data, finalStoreId)
    }
  }

  // ── 1. Conferir tudo antes de gravar (valores, settings, loja, custo) ─────
  const prep = await prepararVenda(admin, finalStoreId, data)
  if ('error' in prep) return { success: false, error: prep.error }
  data = prep.data
  const { pixPct, birthdayPct } = prep

  // ── 2. Calcular totais ────────────────────────────────────────────────────
  const subtotal   = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const totalCost  = data.items.reduce((s, i) => s + i.unitCost  * i.quantity, 0)

  const discountPct = (data.hasPix ? pixPct : 0) + (data.hasBirthday ? birthdayPct : 0)
  // Espelha o front: quando há desconto, o total é arredondado ao inteiro mais próximo
  // e o desconto é reconciliado (subtotal − total). Grava redondo, sem centavos quebrados.
  /* Um cálculo só para tela e banco — ver src/lib/vendas/total.ts. */
  const { total, discountAmt } = calcularTotalDaVenda({
    subtotal, discountPct, manualDiscount: data.manualDiscount,
  })

  const discountTypeParts: string[] = []
  if (data.hasPix)          discountTypeParts.push('pix')
  if (data.hasBirthday)     discountTypeParts.push('birthday')
  if (data.manualDiscount > 0) discountTypeParts.push('manual')
  const discountType = discountTypeParts.join(',') || null

  // ── 3. Calcular crédito de troca ──────────────────────────────────────────
  const exchangeCredit = data.exchangeItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const hasExchange    = data.exchangeItems.length > 0

  // ── 4. Montar payment_summary ─────────────────────────────────────────────
  const paymentSummary = buildPaymentSummary(data.payments, hasExchange, exchangeCredit)

  // ── 5. Criar venda ────────────────────────────────────────────────────────
  const linhaDaVenda = {
    store_id:        finalStoreId,
    customer_id:     data.customerId ?? null,
    user_id:         userId,
    seller_id:       data.sellerId ?? userId,
    sale_date:       data.saleDate,
    subtotal,
    discount_type:   discountType,
    discount_pct:    discountPct,
    discount_amount: discountAmt,
    manual_discount: data.manualDiscount,
    total,
    total_cost:      totalCost,
    /* Só quando ficou saldo. O saldo em si não é gravado: sai da soma de
     * sale_payments, que é a única fonte que não pode divergir. */
    previsao_pagamento: data.previsaoPagamento ?? null,
    destinatario_cpf:   data.destinatarioCpf ?? null,
    payment_summary: paymentSummary,
    status:          'completed',
    notes:           data.notes || null,
  }
  /* O `as` só silencia a checagem de propriedade extra da inferência do
   * insert — a coluna é opcional e pode nem existir ainda (ver abaixo). */
  const inserirVenda = (comId: boolean) => admin
    .from('sales')
    .insert(comId && idReq ? { ...linhaDaVenda, client_request_id: idReq } as typeof linhaDaVenda : linhaDaVenda)
    .select('id')
    .single()

  let { data: sale, error: saleErr } = await inserirVenda(true)

  if (saleErr && idReq) {
    if (violouUnico(saleErr)) {
      /* Corrida: o outro envio desta MESMA venda (duplo clique) gravou entre a
       * conferência lá em cima e este insert. O índice único barrou; devolve a
       * dele. Não confere itens aqui — o outro envio ainda está gravando e
       * responde por eles. */
      const outra = await procurarVendaPorPedido(admin, idReq)
      if ('saleId' in outra && outra.saleId) {
        console.info('[salvarVenda] envio duplo barrado pelo índice único', { saleId: outra.saleId })
        return { success: true, saleId: outra.saleId }
      }
    } else if (colunaDeIdempotenciaAusente(saleErr)) {
      /* A conferência passou (cache velho?) mas o insert não conhece a coluna:
       * grava sem ela, como antes da migration. */
      avisarIdempotenciaDesligada('sales', saleErr)
      ;({ data: sale, error: saleErr } = await inserirVenda(false))
    }
  }

  /* O detalhe técnico (mensagem do Postgres) vai para o log; no balcão ela lê
   * o que aconteceu e o que fazer. Aqui nada foi gravado ainda. */
  if (saleErr || !sale) {
    console.error('[salvarVenda] insert em sales falhou', saleErr)
    return { success: false, error: 'Não foi possível gravar a venda. Nada foi registrado — tente salvar de novo em instantes.' }
  }

  // ── 6. Criar sale_items e decrementar estoque ─────────────────────────────
  // (Consertos já resolvidos em `prepararVenda`, antes de a venda existir.)
  const saleItems = data.items.map(i => ({
    sale_id:    sale.id,
    product_id: i.productId,
    quantity:   i.quantity,
    unit_price: i.unitPrice,
    unit_cost:  i.unitCost,
    subtotal:   parseFloat((i.unitPrice * i.quantity).toFixed(2)),
  }))

  const { data: itensCriados, error: itemsErr } = await admin.from('sale_items').insert(saleItems).select('id')
  if (itemsErr) {
    console.error('[salvarVenda] insert em sale_items falhou', { saleId: sale.id, error: itemsErr })
    return { success: false, saleId: sale.id, error: gravadaComPendencia('as peças não entraram nela') }
  }

  await fecharConsertosDaVenda(data.items, itensCriados, {
    storeId: finalStoreId, customerId: data.customerId, userId,
  })

  /* Peça que não teve o estoque atualizado. A venda segue (o dinheiro entrou),
   * mas quem salvou fica sabendo — ver `moverEstoque`. */
  const estoquePendente: string[] = []

  for (const item of data.items) {
    // `last_sale_date` nunca era gravado: dos 77 produtos já vendidos, ZERO
    // tinham a data. Isso quebrava a view `v_stale_products` e o alerta
    // "produtos sem venda há X dias" do dashboard, que passava a contar o
    // catálogo inteiro como parado — 601 de 971 SKUs, número sem significado.
    const falhou = await moverEstoque(admin, item.productId, -item.quantity, { last_sale_date: data.saleDate })
    if (falhou) estoquePendente.push(item.productName || falhou)
  }

  // ── 7. Criar sale_payments + transactions ─────────────────────────────────
  for (const payment of data.payments) {
    const { error: ppErr } = await admin.from('sale_payments').insert({
      sale_id:        sale.id,
      payment_method: payment.method,
      amount:         payment.amount,
      installments:   payment.installments,
      card_brand:     (payment.method === 'credit' || payment.method === 'debit') ? (payment.cardBrand ?? null) : null,
    })
    if (ppErr) {
      console.error('[salvarVenda] insert em sale_payments falhou', { saleId: sale.id, error: ppErr })
      return { success: false, saleId: sale.id, error: gravadaComPendencia('um dos pagamentos não foi registrado') }
    }

    const methodLabel = { cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito' }[payment.method] ?? payment.method
    const desc = payment.installments > 1
      ? `Venda — ${methodLabel} ${payment.installments}x`
      : `Venda${data.customerId ? '' : ''}`

    const { error: txErr } = await admin.from('transactions').insert({
      store_id:         finalStoreId,
      type:             'income',
      amount:           payment.amount,
      category:         'venda',
      description:      desc,
      reference_type:   'sale',
      reference_id:     sale.id,
      user_id:          userId,
      payment_method:   payment.method,
      transaction_date: data.saleDate,
      status:           'completed',
      paid_at:          new Date().toISOString(),
    })
    if (txErr) {
      console.error('[salvarVenda] insert em transactions falhou', { saleId: sale.id, error: txErr })
      return { success: false, saleId: sale.id, error: gravadaComPendencia('um pagamento não entrou no financeiro') }
    }
  }

  // ── 8. Criar exchange se tiver troca ──────────────────────────────────────
  if (hasExchange) {
    const priceDifference = parseFloat((total - exchangeCredit).toFixed(2))
    const differenceMethod = data.payments[0]?.method ?? null

    const { data: exchange, error: exchErr } = await admin
      .from('exchanges')
      .insert({
        sale_id:          sale.id,
        original_sale_id: data.exchangeItems[0]?.originalSaleId ?? null,
        store_id:         finalStoreId,
        customer_id:      data.customerId,
        user_id:          userId,
        exchange_date:    data.saleDate,
        reason:           'Troca de produto',
        price_difference: priceDifference,
        payment_method:   priceDifference > 0 ? differenceMethod : null,
      })
      .select('id')
      .single()

    if (exchErr || !exchange) {
      console.error('[salvarVenda] insert em exchanges falhou', { saleId: sale.id, error: exchErr })
      return { success: false, saleId: sale.id, error: gravadaComPendencia('a troca (peça devolvida) não foi registrada') }
    }

    const erroTroca = await gravarItensDaTroca(admin, exchange.id, data, estoquePendente)
    if (erroTroca) {
      return { success: false, saleId: sale.id, error: gravadaComPendencia(erroTroca) }
    }
  }

  revalidatePath('/vendas')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  revalidatePath('/clientes')

  if (estoquePendente.length) {
    return {
      success: false, saleId: sale.id,
      error: gravadaComPendencia(`o estoque destas peças não foi atualizado: ${estoquePendente.join(', ')}`),
    }
  }
  return { success: true, saleId: sale.id }
}

/**
 * As duas metades da troca: o que voltou (entra no estoque) e o que saiu.
 *
 * Antes os inserts de `exchange_items` não conferiam erro — a troca podia
 * ficar gravada sem as peças, e o estoque da peça devolvida subia mesmo
 * assim. Agora: peça devolvida só volta ao estoque se a linha dela gravou.
 *
 * Devolve o que falhou (para a mensagem) ou `null`. As falhas de ESTOQUE vão
 * para `estoquePendente`, que quem chamou já reporta.
 */
async function gravarItensDaTroca(
  admin: Admin,
  exchangeId: string,
  data: VendaFormData,
  estoquePendente: string[],
): Promise<string | null> {
  // Custo da peça devolvida: snapshot do cadastro, para o CMV
  const idsDevolvidos = [...new Set(data.exchangeItems.map(ei => ei.productId))]
  const { data: custos, error: custoErr } = idsDevolvidos.length
    ? await admin.from('products').select('id, cost_price').in('id', idsDevolvidos)
    : { data: [], error: null }
  if (custoErr || !custos) {
    console.error('[vendas] leitura do custo das peças devolvidas falhou', { exchangeId, error: custoErr })
    return 'as peças devolvidas não foram registradas na troca'
  }
  const custoDe = new Map(custos.map(c => [c.id as string, Number(c.cost_price) || 0]))

  // Itens devolvidos (returned) — voltam ao estoque, snapshot do custo para CMV
  for (const ei of data.exchangeItems) {
    const { error: insErr } = await admin.from('exchange_items').insert({
      exchange_id: exchangeId,
      direction:   'returned',
      product_id:  ei.productId,
      quantity:    ei.quantity,
      unit_price:  ei.unitPrice,
      unit_cost:   custoDe.get(ei.productId) ?? 0,
    })
    if (insErr) {
      console.error('[vendas] insert em exchange_items (returned) falhou', { exchangeId, error: insErr })
      return `a peça devolvida "${ei.productName}" não foi registrada na troca`
    }
    /*
     * `is_active: true` junto com o saldo.
     *
     * Peça vendida costuma ficar zerada, e peça zerada é inativada — foram
     * 703 delas em 30/08, depois da recontagem. Devolver só a quantidade
     * deixaria a peça com estoque e invisível: não aparece em /estoque, não
     * é achada na busca e o bipe não encontra. Voltou para a gaveta, volta
     * para as listas.
     */
    const falhou = await moverEstoque(admin, ei.productId, ei.quantity, {
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    if (falhou) estoquePendente.push(ei.productName || falhou)
  }

  // Itens dados (given) — os que o cliente está levando nessa venda
  for (const item of data.items) {
    const { error: insErr } = await admin.from('exchange_items').insert({
      exchange_id: exchangeId,
      direction:   'given',
      product_id:  item.productId,
      quantity:    item.quantity,
      unit_price:  item.unitPrice,
      unit_cost:   item.unitCost,
    })
    if (insErr) {
      console.error('[vendas] insert em exchange_items (given) falhou', { exchangeId, error: insErr })
      return 'as peças levadas não foram registradas na troca'
    }
  }
  return null
}

// ─── Action: detalhe de uma venda ─────────────────────────────────────────────

export async function buscarDetalheVenda(saleId: string): Promise<{ data: VendaDetail | null; error?: string }> {
  const admin = createAdminClient()

  // Lote 1 — tudo que só depende do saleId vai em PARALELO (antes eram 6 idas
  // sequenciais ao banco, o que fazia o modal levar ~10s para abrir).
  const [saleRes, itemsRes, paymentsRes, exchangesRes] = await Promise.all([
    admin
      .from('sales')
      .select('id, sale_date, subtotal, discount_type, discount_pct, discount_amount, total, total_cost, payment_summary, status, notes, customer_id, seller_id, store_id, destinatario_cpf, nfce_status, nfce_chave, nfce_numero, nfce_serie, nfce_danfe_url, nfce_motivo_rejeicao, nfce_emitida_em, customers(name, phone), stores(name)')
      .eq('id', saleId)
      .single(),
    admin
      .from('sale_items')
      .select('id, quantity, unit_price, unit_cost, subtotal, products(name, code)')
      .eq('sale_id', saleId),
    admin
      .from('sale_payments')
      .select('id, payment_method, amount, installments, card_brand')
      .eq('sale_id', saleId),
    admin
      .from('exchanges')
      .select('id, price_difference')
      .eq('sale_id', saleId)
      .limit(1),
  ])

  const sale = saleRes.data
  const saleErr = saleRes.error
  if (saleErr || !sale) return { data: null, error: saleErr?.message }

  const rawItems = itemsRes.data
  const payments = paymentsRes.data
  const exchanges = exchangesRes.data

  // Lote 2 — vendedora e itens da troca também em paralelo
  const sellerIdVal = (sale as any).seller_id
  const exchId = exchanges && exchanges.length > 0 ? exchanges[0].id : null

  const [sellerRes, exchItemsRes, emiteNota] = await Promise.all([
    sellerIdVal
      ? admin.from('users').select('full_name').eq('id', sellerIdVal).single()
      : Promise.resolve({ data: null }),
    exchId
      ? admin.from('exchange_items').select('direction, quantity, unit_price, products(name, code)').eq('exchange_id', exchId)
      : Promise.resolve({ data: null }),
    // No mesmo lote: é uma ida a mais ao banco, mas em paralelo não custa nada.
    lojaEmiteNota(admin, (sale as any).store_id ?? null),
  ])

  const sellerName: string | null = (sellerRes as any).data?.full_name ?? null

  let exchangeDetail: VendaDetail['exchange'] = null

  if (exchanges && exchanges.length > 0) {
    const exch = exchanges[0]
    const exchItems = (exchItemsRes as any).data   // já veio no lote 2

    const returned = (exchItems ?? []).filter((e: any) => e.direction === 'returned')
    const given    = (exchItems ?? []).filter((e: any) => e.direction === 'given')

    exchangeDetail = {
      id:               exch.id,
      price_difference: exch.price_difference,
      returned_items:   returned.map((e: any) => ({
        product_name: e.products?.name ?? '—',
        product_code: e.products?.code ?? '—',
        quantity:     e.quantity,
        unit_price:   e.unit_price,
      })),
      given_items:      given.map((e: any) => ({
        product_name: e.products?.name ?? '—',
        product_code: e.products?.code ?? '—',
        quantity:     e.quantity,
        unit_price:   e.unit_price,
      })),
    }
  }

  const s = sale as any
  return {
    data: {
      id:              s.id,
      sale_date:       s.sale_date,
      store_name:      s.stores?.name ?? '—',
      customer_name:   s.customers?.name ?? null,
      // Telefone só para o botão de mandar a nota no WhatsApp.
      customer_phone:  s.customers?.phone ?? null,
      customer_id:     s.customer_id,
      seller_name:     sellerName,
      subtotal:        Number(s.subtotal),
      discount_type:   s.discount_type,
      discount_pct:    Number(s.discount_pct),
      discount_amount: Number(s.discount_amount),
      total:           Number(s.total),
      total_cost:      Number(s.total_cost),
      payment_summary: s.payment_summary,
      status:          s.status,
      notes:           s.notes,
      items: (rawItems ?? []).map((i: any) => ({
        id:           i.id,
        product_name: i.products?.name ?? '—',
        product_code: i.products?.code ?? '—',
        quantity:     i.quantity,
        unit_price:   Number(i.unit_price),
        unit_cost:    Number(i.unit_cost),
        subtotal:     Number(i.subtotal),
      })),
      payments: (payments ?? []).map((p: any) => ({
        id:             p.id,
        payment_method: p.payment_method,
        amount:         Number(p.amount),
        installments:   p.installments,
      })),
      exchange: exchangeDetail,
      nfce: {
        status:          sale.nfce_status ?? null,
        chave:           sale.nfce_chave ?? null,
        numero:          sale.nfce_numero ?? null,
        serie:           sale.nfce_serie ?? null,
        danfe_url:       sale.nfce_danfe_url ?? null,
        motivo_rejeicao: sale.nfce_motivo_rejeicao ?? null,
        emitida_em:      sale.nfce_emitida_em ?? null,
      },
      destinatario_cpf: sale.destinatario_cpf ?? null,
      emiteNota,
    }
  }
}

// ─── Action: vendas do cliente para troca ─────────────────────────────────────

export async function buscarVendasCliente(customerId: string, storeId: string): Promise<VendaParaTroca[]> {
  // Troca só olha as vendas da própria loja. Ver lib/auth.
  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil, storeId) : null
  if (!loja) return []
  storeId = loja

  const admin = createAdminClient()

  const { data: sales } = await admin
    .from('sales')
    .select('id, sale_date, subtotal, total')
    .eq('customer_id', customerId)
    .eq('store_id', storeId)
    .eq('status', 'completed')
    .order('sale_date', { ascending: false })
    .limit(20)

  if (!sales || sales.length === 0) return []

  const results: VendaParaTroca[] = []

  for (const sale of sales) {
    const { data: items } = await admin
      .from('sale_items')
      .select('id, product_id, quantity, unit_price, products(name, code)')
      .eq('sale_id', sale.id)

    // Verificar quais itens já foram devolvidos
    const { data: returnedItems } = (items ?? []).length > 0
      ? await admin
          .from('exchange_items')
          .select('product_id')
          .eq('direction', 'returned')
          .in('product_id', (items ?? []).map((i: any) => i.product_id))
      : { data: [] }

    const returnedProductIds = new Set((returnedItems ?? []).map((r: any) => r.product_id))

    // Ratio desconto: quanto do subtotal o cliente realmente pagou
    const saleSubtotal = Number(sale.subtotal) || 1
    const saleTotal    = Number(sale.total)
    const discountRatio = saleTotal / saleSubtotal  // ex: 0.85 se teve 15% desconto

    results.push({
      id:        sale.id,
      sale_date: sale.sale_date,
      subtotal:  saleSubtotal,
      total:     saleTotal,
      items:     (items ?? []).map((i: any) => {
        const unitPrice = Number(i.unit_price)
        return {
          id:                   i.id,
          product_id:           i.product_id,
          product_name:         i.products?.name ?? '—',
          product_code:         i.products?.code ?? '—',
          unit_price:           unitPrice,
          effective_unit_price: parseFloat((unitPrice * discountRatio).toFixed(2)),
          quantity:             i.quantity,
          already_returned:     returnedProductIds.has(i.product_id),
        }
      }),
    })
  }

  return results
}

// ─── Action: deletar venda ────────────────────────────────────────────────────

export async function deletarVenda(saleId: string): Promise<ActionResult> {
  const { error: authErr } = await verifyUser()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  // Reverter estoque dos itens vendidos
  const { data: items } = await admin
    .from('sale_items').select('product_id, quantity').eq('sale_id', saleId)

  /* Ver `moverEstoque`: leitura que falha não grava mais saldo inventado.
   * A exclusão segue (a dona pediu para excluir), e o log diz qual peça
   * ficou com o saldo por corrigir. */
  if (items) {
    for (const item of items) {
      await moverEstoque(admin, item.product_id, item.quantity)
    }
  }

  // Reverter exchange vinculado à venda atual (via sale_id, não original_sale_id)
  const { data: exchanges } = await admin
    .from('exchanges').select('id').eq('sale_id', saleId)

  if (exchanges) {
    for (const exch of exchanges) {
      // Itens que voltaram ao estoque (returned) precisam ser decrementados de volta
      const { data: returned } = await admin
        .from('exchange_items').select('product_id, quantity').eq('exchange_id', exch.id).eq('direction', 'returned')

      if (returned) {
        for (const r of returned) {
          await moverEstoque(admin, r.product_id, -r.quantity)
        }
      }

      await admin.from('exchange_items').delete().eq('exchange_id', exch.id)
      await admin.from('exchanges').delete().eq('id', exch.id)
    }
  }

  await admin.from('transactions').delete().eq('reference_id', saleId).eq('reference_type', 'sale')
  await admin.from('sale_payments').delete().eq('sale_id', saleId)
  await admin.from('sale_items').delete().eq('sale_id', saleId)
  const { error } = await admin.from('sales').delete().eq('id', saleId)

  if (error) {
    console.error('[deletarVenda] delete em sales falhou', { saleId, error })
    return { success: false, error: 'Não foi possível excluir a venda. Confira em Vendas se ela ainda aparece e avise a administração.' }
  }

  revalidatePath('/vendas')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  revalidatePath('/clientes')
  return { success: true }
}

// ─── Action: carregar venda para edição ───────────────────────────────────────

export interface EditSaleData {
  id: string
  storeId: string
  saleDate: string   // YYYY-MM-DD
  customer: { id: string; name: string; phone: string; cpf: string | null; birthday: string | null } | null
  /** CPF gravado nesta venda (não o do cadastro). */
  destinatarioCpf?: string | null
  /**
   * Fiado: a venda foi gravada com saldo em aberto. Sem carregar isto, a tela
   * de edição abria com "fica devendo" desmarcado e não deixava salvar — ou,
   * pior, `editarVenda` gravava `previsao_pagamento` nulo e a data prometida
   * sumia da cobrança.
   */
  fiado?: boolean
  previsaoPagamento?: string | null
  /**
   * Presente = esta venda NÃO pode ser editada (tem troca ou conserto
   * vinculado). A tela mostra o motivo em vez do formulário; ver
   * `motivoParaNaoEditar`.
   */
  bloqueio?: string | null
  sellerId: string | null
  hasPix: boolean
  hasBirthday: boolean
  manualDiscount: number
  notes: string
  rows: Array<{
    productId: string
    productName: string
    quantity: number
    unitPrice: number
    unitCost: number
    stockAvailable: number
    isService: boolean
  }>
  payments: Array<{ method: 'cash' | 'pix' | 'debit' | 'credit'; amount: number; installments: number; cardBrand: string | null }>
}

/*
 * Arquivo 'use server' só exporta função assíncrona, então a constante fica
 * local; a página compara pelo texto.
 */
const VENDA_NAO_ENCONTRADA = 'Venda não encontrada.'

export async function buscarVendaParaEdicao(saleId: string): Promise<{ data: EditSaleData | null; error?: string }> {
  const admin = createAdminClient()

  const { data: sale, error: saleErr } = await admin
    .from('sales')
    .select('id, store_id, sale_date, customer_id, seller_id, discount_type, manual_discount, notes, status, total, destinatario_cpf, previsao_pagamento')
    .eq('id', saleId)
    .single()
  /* PGRST116 = nenhuma linha: a venda não existe (vira 404). Qualquer outro
   * erro é falha de leitura, e a tela diz isso em vez de "não encontrada". */
  if (!sale && (!saleErr || saleErr.code === 'PGRST116')) return { data: null, error: VENDA_NAO_ENCONTRADA }
  if (saleErr || !sale) {
    console.error('[buscarVendaParaEdicao] leitura da venda falhou', saleErr)
    return { data: null, error: 'Não consegui carregar esta venda. Tente de novo em instantes.' }
  }

  const s = sale as any

  const bloqueio = await motivoParaNaoEditar(admin, saleId)

  const { data: rawItems, error: itemsErr } = await admin
    .from('sale_items')
    .select('product_id, quantity, unit_price, unit_cost, products(name, is_service, quantity_in_stock)')
    .eq('sale_id', saleId)

  const { data: rawPayments, error: paymentsErr } = await admin
    .from('sale_payments')
    .select('payment_method, amount, installments, card_brand')
    .eq('sale_id', saleId)

  /*
   * Leitura falhou = não abre a edição. Com `?? []` a tela abria SEM itens ou
   * SEM pagamentos, e salvar dali gravava a venda vazia por cima da real.
   */
  if (itemsErr || paymentsErr || !rawItems || !rawPayments) {
    console.error('[buscarVendaParaEdicao] leitura falhou', itemsErr ?? paymentsErr)
    return { data: null, error: 'Não consegui carregar os itens desta venda. Tente de novo em instantes.' }
  }

  let customer: EditSaleData['customer'] = null
  if (s.customer_id) {
    const { data: c } = await admin
      .from('customers').select('id, name, phone, cpf, birthday').eq('id', s.customer_id).single()
    if (c) customer = { id: c.id, name: c.name, phone: c.phone, cpf: c.cpf, birthday: c.birthday }
  }

  const discountType: string = s.discount_type ?? ''

  /* Mesma régua do formulário: sobra de até 1 centavo não é fiado. Venda com
   * troca não chega aqui editável, então o crédito da troca não entra na conta. */
  const pago = (rawPayments ?? []).reduce((soma: number, p: { amount: unknown }) => soma + (Number(p.amount) || 0), 0)
  const fiado = Number(s.total) - pago > 0.009

  return {
    data: {
      id:            s.id,
      storeId:       s.store_id,
      saleDate:      String(s.sale_date).slice(0, 10),
      customer,
      destinatarioCpf:   s.destinatario_cpf ?? null,
      fiado,
      previsaoPagamento: s.previsao_pagamento ? String(s.previsao_pagamento).slice(0, 10) : null,
      bloqueio,
      sellerId:      s.seller_id ?? null,
      hasPix:        discountType.includes('pix'),
      hasBirthday:   discountType.includes('birthday'),
      manualDiscount: Number(s.manual_discount) || 0,
      notes:         s.notes ?? '',
      rows: (rawItems ?? []).map((i: any) => ({
        productId:      i.product_id,
        productName:    i.products?.name ?? '—',
        quantity:       i.quantity,
        unitPrice:      Number(i.unit_price),
        unitCost:       Number(i.unit_cost),
        stockAvailable: i.products?.quantity_in_stock ?? 0,
        isService:      !!i.products?.is_service,
      })),
      payments: (rawPayments ?? []).map((p: any) => ({
        method:       p.payment_method,
        amount:       Number(p.amount),
        installments: p.installments ?? 1,
        cardBrand:    p.card_brand ?? null,
      })),
    },
  }
}

// ─── Action: editar venda ──────────────────────────────────────────────────────
// Reverte os efeitos da venda antiga (estoque, troca, pagamentos, transações) e
// reaplica com os novos dados, mantendo o MESMO id. Reaproveita a lógica já
// validada de salvarVenda/deletarVenda.

export async function editarVenda(saleId: string, data: VendaFormData): Promise<ActionResult> {
  const { userId, role, storeId: userStoreId, error: authErr } = await verifyUser()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  // Mesma regra do `salvarVenda`: quem tem loja está preso a ela, admin ou não.
  const finalStoreId = userStoreId ?? data.storeId
  if (!finalStoreId) return { success: false, error: 'Loja não definida.' }

  const { data: existing, error: exErr } = await admin.from('sales').select('id, sale_date, store_id').eq('id', saleId).single()
  if (exErr || !existing) return { success: false, error: 'Venda não encontrada.' }

  /* A tela de edição já não abre nesses casos; aqui é a garantia para quem
   * estava com ela aberta antes, ou chamou a ação por outro caminho. */
  const bloqueio = await motivoParaNaoEditar(admin, saleId)
  if (bloqueio) return { success: false, error: bloqueio }

  // Tudo conferido ANTES de desfazer a venda antiga — falhar aqui não muda nada.
  const prep = await prepararVenda(admin, finalStoreId, data)
  if ('error' in prep) return { success: false, error: prep.error }
  data = prep.data
  const { pixPct, birthdayPct } = prep

  /* Peças cujo saldo não foi atualizado — ver `moverEstoque`. */
  const estoquePendente: string[] = []
  /* A partir daqui a venda antiga começa a ser desfeita: falhar deixa a venda
   * pela metade, e a mensagem precisa dizer isso. */
  const parouNoMeio = 'A edição parou no meio e a venda pode ter ficado incompleta. NÃO tente de novo — abra a venda em Vendas, confira e avise a administração.'

  // ── 1. Reverter efeitos antigos ───────────────────────────────────────────
  /* Sem conferir o erro desta leitura, uma falha pulava a devolução ao
   * estoque e apagava os itens mesmo assim — a peça saía duas vezes. */
  const { data: oldItems, error: oldItemsErr } = await admin.from('sale_items').select('product_id, quantity').eq('sale_id', saleId)
  if (oldItemsErr || !oldItems) {
    console.error('[editarVenda] leitura dos itens antigos falhou', { saleId, error: oldItemsErr })
    return { success: false, error: 'Não consegui ler os itens atuais da venda. Nada foi alterado — tente de novo em instantes.' }
  }
  for (const it of oldItems) {
    const falhou = await moverEstoque(admin, it.product_id, it.quantity)
    if (falhou) estoquePendente.push(falhou)
  }

  /* Com o bloqueio acima, venda com troca não chega aqui; o laço fica para o
   * caso de a troca ter sido gravada entre a conferência e este ponto. */
  const { data: oldExchanges } = await admin.from('exchanges').select('id').eq('sale_id', saleId)
  if (oldExchanges) {
    for (const exch of oldExchanges) {
      const { data: returned } = await admin.from('exchange_items').select('product_id, quantity').eq('exchange_id', exch.id).eq('direction', 'returned')
      if (returned) {
        for (const r of returned) {
          const falhou = await moverEstoque(admin, r.product_id, -r.quantity)
          if (falhou) estoquePendente.push(falhou)
        }
      }
      await admin.from('exchange_items').delete().eq('exchange_id', exch.id)
      await admin.from('exchanges').delete().eq('id', exch.id)
    }
  }

  /* Delete que falha e segue em frente duplicava pagamento (o velho fica, o
   * novo entra) — o caixa do dia dobrava. */
  const delTx = await admin.from('transactions').delete().eq('reference_id', saleId).eq('reference_type', 'sale')
  const delPg = delTx.error ? null : await admin.from('sale_payments').delete().eq('sale_id', saleId)
  const delIt = !delPg || delPg.error ? null : await admin.from('sale_items').delete().eq('sale_id', saleId)
  if (delTx.error || !delPg || delPg.error || !delIt || delIt.error) {
    console.error('[editarVenda] limpeza da venda antiga falhou', {
      saleId, error: delTx.error ?? delPg?.error ?? delIt?.error,
    })
    return { success: false, error: parouNoMeio }
  }

  // ── 2. Recalcular totais (igual salvarVenda) ──────────────────────────────
  const subtotal   = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const totalCost   = data.items.reduce((s, i) => s + i.unitCost * i.quantity, 0)
  const discountPct = (data.hasPix ? pixPct : 0) + (data.hasBirthday ? birthdayPct : 0)
  /* Um cálculo só para tela e banco — ver src/lib/vendas/total.ts. */
  const { total, discountAmt } = calcularTotalDaVenda({
    subtotal, discountPct, manualDiscount: data.manualDiscount,
  })

  const discountTypeParts: string[] = []
  if (data.hasPix)             discountTypeParts.push('pix')
  if (data.hasBirthday)        discountTypeParts.push('birthday')
  if (data.manualDiscount > 0) discountTypeParts.push('manual')
  const discountType = discountTypeParts.join(',') || null

  const exchangeCredit = data.exchangeItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const hasExchange    = data.exchangeItems.length > 0
  const paymentSummary = buildPaymentSummary(data.payments, hasExchange, exchangeCredit)

  // ── 3. Atualizar a venda (mesmo id) ───────────────────────────────────────
  const { error: updErr } = await admin.from('sales').update({
    store_id:        finalStoreId,
    customer_id:     data.customerId ?? null,
    seller_id:       data.sellerId ?? userId,
    sale_date:       data.saleDate,
    subtotal,
    discount_type:   discountType,
    discount_pct:    discountPct,
    discount_amount: discountAmt,
    manual_discount: data.manualDiscount,
    total,
    total_cost:      totalCost,
    payment_summary: paymentSummary,
    status:          'completed',
    /* Faltava aqui: a edição gravava tudo menos a data prometida, então
     * marcar "fica devendo" numa venda existente não persistia nada. */
    previsao_pagamento: data.previsaoPagamento ?? null,
    destinatario_cpf:   data.destinatarioCpf ?? null,
    notes:           data.notes || null,
    updated_at:      new Date().toISOString(),
  }).eq('id', saleId)
  if (updErr) {
    console.error('[editarVenda] update em sales falhou', { saleId, error: updErr })
    return { success: false, error: parouNoMeio }
  }

  // ── 4. Reinserir itens + baixar estoque (skip serviço) ────────────────────
  // (Consertos já resolvidos em `prepararVenda`.)
  const saleItems = data.items.map(i => ({
    sale_id:    saleId,
    product_id: i.productId,
    quantity:   i.quantity,
    unit_price: i.unitPrice,
    unit_cost:  i.unitCost,
    subtotal:   parseFloat((i.unitPrice * i.quantity).toFixed(2)),
  }))
  const { data: itensCriados, error: itemsErr } = await admin.from('sale_items').insert(saleItems).select('id')
  if (itemsErr) {
    console.error('[editarVenda] insert em sale_items falhou', { saleId, error: itemsErr })
    return { success: false, error: parouNoMeio }
  }

  await fecharConsertosDaVenda(data.items, itensCriados, {
    storeId: finalStoreId, customerId: data.customerId, userId,
  })

  for (const item of data.items) {
    const falhou = await moverEstoque(admin, item.productId, -item.quantity)
    if (falhou) estoquePendente.push(item.productName || falhou)
  }

  // ── 5. Pagamentos + transações ────────────────────────────────────────────
  for (const payment of data.payments) {
    const { error: ppErr } = await admin.from('sale_payments').insert({
      sale_id:        saleId,
      payment_method: payment.method,
      amount:         payment.amount,
      installments:   payment.installments,
      card_brand:     (payment.method === 'credit' || payment.method === 'debit') ? (payment.cardBrand ?? null) : null,
    })
    if (ppErr) {
      console.error('[editarVenda] insert em sale_payments falhou', { saleId, error: ppErr })
      return { success: false, error: parouNoMeio }
    }

    const methodLabel = { cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito' }[payment.method] ?? payment.method
    const desc = payment.installments > 1 ? `Venda — ${methodLabel} ${payment.installments}x` : 'Venda'
    const { error: txErr } = await admin.from('transactions').insert({
      store_id:         finalStoreId,
      type:             'income',
      amount:           payment.amount,
      category:         'venda',
      description:      desc,
      reference_type:   'sale',
      reference_id:     saleId,
      user_id:          userId,
      payment_method:   payment.method,
      transaction_date: data.saleDate,
      status:           'completed',
      paid_at:          new Date().toISOString(),
    })
    if (txErr) {
      console.error('[editarVenda] insert em transactions falhou', { saleId, error: txErr })
      return { success: false, error: parouNoMeio }
    }
  }

  // ── 6. Recriar troca, se houver ───────────────────────────────────────────
  if (hasExchange) {
    const priceDifference = parseFloat((total - exchangeCredit).toFixed(2))
    const differenceMethod = data.payments[0]?.method ?? null

    const { data: exchange, error: exchErr } = await admin
      .from('exchanges')
      .insert({
        sale_id:          saleId,
        original_sale_id: data.exchangeItems[0]?.originalSaleId ?? null,
        store_id:         finalStoreId,
        customer_id:      data.customerId,
        user_id:          userId,
        exchange_date:    data.saleDate,
        reason:           'Troca de produto',
        price_difference: priceDifference,
        payment_method:   priceDifference > 0 ? differenceMethod : null,
      })
      .select('id')
      .single()

    if (exchErr || !exchange) {
      console.error('[editarVenda] insert em exchanges falhou', { saleId, error: exchErr })
      return { success: false, error: parouNoMeio }
    }

    /* Mesma gravação da venda nova — e agora com os erros conferidos. */
    const erroTroca = await gravarItensDaTroca(admin, exchange.id, data, estoquePendente)
    if (erroTroca) return { success: false, error: parouNoMeio }
  }

  revalidatePath('/vendas')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  revalidatePath('/clientes')

  if (estoquePendente.length) {
    return {
      success: false, saleId,
      error: `A venda foi atualizada, mas o estoque destas peças não foi: ${estoquePendente.join(', ')}. NÃO salve de novo — confira em Vendas e avise a administração.`,
    }
  }
  return { success: true, saleId }
}

