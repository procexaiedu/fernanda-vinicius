'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calcularTotalDaVenda } from '@/lib/vendas/total'
import { getProfile, ehAdmin, lojaDoEscopo } from '@/lib/auth'
import { produtoDeConserto } from '@/lib/conserto'
import { lojaEmiteNota } from '@/lib/fiscal/emitente'
import { idDeRequisicaoValido } from '@/lib/idempotencia'

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
 * O vínculo do conserto que a linha cobra — gravado DENTRO de `fv.salvar_venda`,
 * na mesma transação da venda (antes eram `registrarPagamentoDoConserto` /
 * `registrarConsertoDaVenda`, em consertos/interno.ts, com os mesmos valores).
 *
 * `{ id }`: peça já registrada — a venda diz que foi PAGA, não que saiu.
 * Pagar e entregar são coisas diferentes ("ela diz se a cliente paga o
 * conserto depois ou antes"); quem entrega é quem clica em "Cliente levou".
 *
 * `{ novo }`: cobrança direta, sem peça registrada antes. O PDV cria o
 * registro — senão o conserto existiria só como dinheiro, e a tela de
 * Consertos ficaria cega para ele. Pagou e levou nasce ENTREGUE; pagou
 * adiantado nasce NA LOJA.
 *
 * Falhar o vínculo NÃO derruba a venda: a venda aconteceu e o dinheiro
 * entrou. A função roda o vínculo num savepoint e devolve o que falhou em
 * `consertos_pendentes`, que vai para o log.
 */
function vinculoDoConserto(
  item: SaleItem,
  contexto: { storeId: string; customerId: string | null; userId: string },
): Record<string, unknown> | null {
  if (!item.isConserto) return null
  if (item.consertoId) return { id: item.consertoId }
  const hoje = new Date().toISOString().slice(0, 10)
  return {
    novo: {
      store_id:    contexto.storeId,
      customer_id: contexto.customerId,
      // Sem descrição digitada sobra o genérico — melhor que perder o registro.
      peca:        item.consertoDescricao?.trim() || 'Conserto',
      recebido_em: hoje,
      status:      item.consertoFicouNaLoja ? 'recebido' : 'entregue',
      entregue_em: item.consertoFicouNaLoja ? null : hoje,
      user_id:     contexto.userId,
    },
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
  /* `fv.exchanges.customer_id` é NOT NULL. A tela já barra, mas sem esta
   * checagem a RPC transacional desfaria a venda inteira com uma mensagem
   * genérica. */
  if (data.exchangeItems.length > 0 && !data.customerId) {
    return 'Troca precisa de cliente identificado. Selecione a cliente da venda.'
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

/* A tela reconhece este caso por `idReusado`, não pelo texto — e nem daria
 * para exportar a constante: arquivo 'use server' só exporta função async. */
const MSG_ID_DE_OUTRA_VENDA =
  'Este salvamento já foi usado para outra venda. Recarregue a página (F5) e lance de novo — nada desta venda foi gravado.'

const METODO_LABEL: Record<string, string> = { cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito' }

/**
 * A linha de `fv.sales` e o corpo da venda (itens, pagamentos, financeiro,
 * troca), já resolvidos — o pacote de `fv.salvar_venda` / `fv.editar_venda`.
 *
 * "O TypeScript calcula, o SQL persiste": toda conta de dinheiro fica aqui (e
 * o total em src/lib/vendas/total.ts); a função só grava estas linhas, com
 * estas colunas, e mexe no estoque. Os valores são os mesmos que cada insert
 * do caminho antigo mandava ao PostgREST.
 *
 * `data` já passou por `prepararVenda` (conserto resolvido, custo relido).
 */
function montarPacoteDaVenda(
  data: VendaFormData,
  ctx: {
    storeId: string
    userId: string
    pixPct: number
    birthdayPct: number
    /** Custo do cadastro, por peça — o das peças devolvidas vem daqui. */
    custos: Map<string, number>
  },
) {
  // ── Totais ────────────────────────────────────────────────────────────────
  const subtotal   = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const totalCost  = data.items.reduce((s, i) => s + i.unitCost  * i.quantity, 0)

  const discountPct = (data.hasPix ? ctx.pixPct : 0) + (data.hasBirthday ? ctx.birthdayPct : 0)
  // Espelha o front: quando há desconto, o total sobe para o inteiro seguinte
  // e o desconto é reconciliado (subtotal − total). Grava redondo.
  /* Um cálculo só para tela e banco — ver src/lib/vendas/total.ts. */
  const { total, discountAmt } = calcularTotalDaVenda({
    subtotal, discountPct, manualDiscount: data.manualDiscount,
  })

  const discountTypeParts: string[] = []
  if (data.hasPix)             discountTypeParts.push('pix')
  if (data.hasBirthday)        discountTypeParts.push('birthday')
  if (data.manualDiscount > 0) discountTypeParts.push('manual')
  const discountType = discountTypeParts.join(',') || null

  // ── Troca ─────────────────────────────────────────────────────────────────
  const exchangeCredit = data.exchangeItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const hasExchange    = data.exchangeItems.length > 0

  const sale = {
    store_id:        ctx.storeId,
    customer_id:     data.customerId ?? null,
    user_id:         ctx.userId,
    seller_id:       data.sellerId ?? ctx.userId,
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
    payment_summary: buildPaymentSummary(data.payments, hasExchange, exchangeCredit),
    status:          'completed',
    notes:           data.notes || null,
  }

  const contextoConserto = { storeId: ctx.storeId, customerId: data.customerId, userId: ctx.userId }
  const items = data.items.map(i => ({
    product_id: i.productId,
    quantity:   i.quantity,
    unit_price: i.unitPrice,
    unit_cost:  i.unitCost,
    subtotal:   parseFloat((i.unitPrice * i.quantity).toFixed(2)),
    conserto:   vinculoDoConserto(i, contextoConserto),
  }))

  const payments = data.payments.map(p => ({
    payment_method: p.method,
    amount:         p.amount,
    installments:   p.installments,
    card_brand:     (p.method === 'credit' || p.method === 'debit') ? (p.cardBrand ?? null) : null,
  }))

  /* Uma linha do financeiro por pagamento. `reference_id` (a venda) e
   * `paid_at` (now()) são preenchidos pela função. */
  const transactions = data.payments.map(p => ({
    store_id:         ctx.storeId,
    type:             'income',
    amount:           p.amount,
    category:         'venda',
    description:      p.installments > 1 ? `Venda — ${METODO_LABEL[p.method] ?? p.method} ${p.installments}x` : 'Venda',
    reference_type:   'sale',
    user_id:          ctx.userId,
    payment_method:   p.method,
    transaction_date: data.saleDate,
    status:           'completed',
  }))

  let exchange = null
  if (hasExchange) {
    const priceDifference = parseFloat((total - exchangeCredit).toFixed(2))
    const differenceMethod = data.payments[0]?.method ?? null
    exchange = {
      row: {
        original_sale_id: data.exchangeItems[0]?.originalSaleId ?? null,
        store_id:         ctx.storeId,
        customer_id:      data.customerId,
        user_id:          ctx.userId,
        exchange_date:    data.saleDate,
        reason:           'Troca de produto',
        price_difference: priceDifference,
        payment_method:   priceDifference > 0 ? differenceMethod : null,
      },
      // Voltam ao estoque (e reativam a peça), com o custo do cadastro para o CMV.
      returned: data.exchangeItems.map(ei => ({
        product_id: ei.productId,
        quantity:   ei.quantity,
        unit_price: ei.unitPrice,
        unit_cost:  ctx.custos.get(ei.productId) ?? 0,
      })),
      // O que a cliente está levando nessa venda.
      given: data.items.map(i => ({
        product_id: i.productId,
        quantity:   i.quantity,
        unit_price: i.unitPrice,
        unit_cost:  i.unitCost,
      })),
    }
  }

  return { sale, items, payments, transactions, exchange }
}

type ErroRpc = { code?: string; message?: string } | null

/**
 * O banco respondeu com um erro (a transação foi desfeita), ou a resposta nem
 * chegou (rede, timeout)? No segundo caso a venda PODE ter entrado.
 *
 * PGRST202 / 42883 = a função não existe: a migration 20261001 não foi
 * aplicada antes do deploy. Não há caminho antigo de propósito — fica no log
 * em destaque para quem for olhar.
 */
function erroDoBancoRespondeu(err: ErroRpc, onde: string): boolean {
  if (err?.code === 'PGRST202' || err?.code === '42883') {
    console.error(`[${onde}] função do banco AUSENTE — aplique supabase/migrations/20261001_venda_transacional.sql (e recarregue o schema do PostgREST)`, err)
  }
  return !!err?.code
}

/** Consertos cujo vínculo falhou dentro da função — a venda entrou mesmo assim. */
function logarConsertosPendentes(onde: string, saleId: string, pendentes: unknown) {
  if (Array.isArray(pendentes) && pendentes.length) {
    console.error(`[${onde}] conserto não foi fechado pela venda — corrigir na tela de Consertos`, { saleId, pendentes })
  }
}

function revalidarVendas() {
  revalidatePath('/vendas')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  revalidatePath('/clientes')
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
): Promise<{ data: VendaFormData; pixPct: number; birthdayPct: number; custos: Map<string, number> } | { error: string }> {
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
    custos: pecas.custos,
  }
}

// ─── Action: salvar venda ─────────────────────────────────────────────────────

/**
 * Lança uma venda nova — numa transação só, via `fv.salvar_venda`.
 *
 * "O TypeScript calcula, o SQL persiste": aqui ficam login, escopo de loja,
 * todas as conferências (`prepararVenda`) e todas as contas; a função do
 * banco recebe as linhas prontas e grava venda, itens, estoque (atômico),
 * consertos, pagamentos, financeiro e troca — ou nada. Por isso não existe
 * mais a resposta "a venda FOI gravada, mas…": ou entrou inteira, ou não
 * entrou.
 *
 * IDEMPOTÊNCIA: o `clientRequestId` vai no pacote e é conferido DENTRO da
 * função, sob trava — reenvio da mesma venda devolve a que já existe;
 * id de outra venda devolve `idReusado` sem gravar nada.
 *
 * DEPLOY: depende de supabase/migrations/20261001_venda_transacional.sql.
 * Aplique a migration ANTES do push — não há caminho antigo; sem a função
 * (PGRST202/42883) salvar responde erro e o log diz qual migration falta.
 */
export async function salvarVenda(data: VendaFormData): Promise<ActionResult> {
  const { userId, storeId: userStoreId, error: authErr } = await verifyUser()
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

  /* Id inválido = salva sem idempotência, como antes (ver src/lib/idempotencia.ts). */
  const idReq = idDeRequisicaoValido(data.clientRequestId)

  // ── 1. Conferir tudo antes de gravar (valores, settings, loja, custo) ─────
  const prep = await prepararVenda(admin, finalStoreId, data)
  if ('error' in prep) return { success: false, error: prep.error }

  // ── 2. Montar o pacote e gravar numa transação ────────────────────────────
  const pacote = montarPacoteDaVenda(prep.data, {
    storeId: finalStoreId, userId, pixPct: prep.pixPct, birthdayPct: prep.birthdayPct, custos: prep.custos,
  })

  const { data: resp, error } = await admin.rpc('salvar_venda', {
    p: { client_request_id: idReq, ...pacote },
  })

  if (error) {
    console.error('[salvarVenda] fv.salvar_venda falhou', error)
    if (erroDoBancoRespondeu(error, 'salvarVenda')) {
      /* O banco respondeu com erro: a transação foi desfeita inteira. */
      return { success: false, error: 'Não foi possível gravar a venda. Nada foi registrado — tente salvar de novo em instantes.' }
    }
    /* A resposta não chegou: a venda pode ter entrado. Com o id, salvar de
     * novo é seguro (o banco reconhece e não duplica); sem ele, não. */
    return {
      success: false,
      error: idReq
        ? 'Não consegui confirmar se a venda foi gravada (falha de conexão). Salve de novo — se ela já tiver entrado, o sistema reconhece e não duplica.'
        : 'Não consegui confirmar se a venda foi gravada (falha de conexão). Confira em Vendas ANTES de salvar de novo.',
    }
  }

  const r = (resp ?? {}) as {
    sale_id?: string; ja_existia?: boolean; incompleta?: boolean
    erro?: string; sale_id_existente?: string; consertos_pendentes?: unknown
  }

  if (r.erro === 'id_reusado') {
    console.error('[salvarVenda] clientRequestId de OUTRA venda — nada gravado', {
      saleIdExistente: r.sale_id_existente, loja: finalStoreId, cliente: data.customerId ?? null,
      total: pacote.sale.total, itens: pacote.items.length,
    })
    return { success: false, idReusado: true, error: MSG_ID_DE_OUTRA_VENDA }
  }

  if (!r.sale_id) {
    console.error('[salvarVenda] fv.salvar_venda respondeu sem sale_id', resp)
    return { success: false, error: 'Não foi possível gravar a venda. Nada foi registrado — tente salvar de novo em instantes.' }
  }

  if (r.ja_existia) {
    /* Só venda gravada pelo caminho antigo (sem transação) pode estar pela
     * metade. Volta `saleId` junto do erro: a tela trava o botão. */
    if (r.incompleta) {
      console.error('[salvarVenda] reenvio de venda gravada pela metade (anterior à venda transacional)', { saleId: r.sale_id })
      return {
        success: false, saleId: r.sale_id,
        error: 'Esta venda JÁ ESTAVA gravada, mas pode ter ficado incompleta (peças ou pagamentos). NÃO salve de novo (duplicaria a venda) — confira em Vendas e avise a administração.',
      }
    }
    console.info('[salvarVenda] reenvio reconhecido — devolvendo a venda já gravada', { saleId: r.sale_id })
    return { success: true, saleId: r.sale_id }
  }

  logarConsertosPendentes('salvarVenda', r.sale_id, r.consertos_pendentes)
  revalidarVendas()
  return { success: true, saleId: r.sale_id }
}

// ─── Action: detalhe de uma venda ─────────────────────────────────────────────

export async function buscarDetalheVenda(saleId: string): Promise<{ data: VendaDetail | null; error?: string }> {
  /* Antes não pedia nem login (auditoria de 07/10/2026): qualquer sessão lia
   * custo e código de venda de qualquer loja pelo id. Agora: só a loja de quem
   * pede, e custo/código só para admin, como já era na transferência. */
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active) return { data: null, error: 'Não autenticado.' }
  const escopo = lojaDoEscopo(perfil)
  const veCusto = ehAdmin(perfil)
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
  if (escopo && (sale as any).store_id !== escopo) return { data: null, error: 'Venda não encontrada.' }
  const codigo = (c: string | undefined) => (veCusto ? c ?? '—' : '—')

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
        product_code: codigo(e.products?.code),
        quantity:     e.quantity,
        unit_price:   e.unit_price,
      })),
      given_items:      given.map((e: any) => ({
        product_name: e.products?.name ?? '—',
        product_code: codigo(e.products?.code),
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
      total_cost:      veCusto ? Number(s.total_cost) : 0,
      payment_summary: s.payment_summary,
      status:          s.status,
      notes:           s.notes,
      items: (rawItems ?? []).map((i: any) => ({
        id:           i.id,
        product_name: i.products?.name ?? '—',
        product_code: codigo(i.products?.code),
        quantity:     i.quantity,
        unit_price:   Number(i.unit_price),
        unit_cost:    veCusto ? Number(i.unit_cost) : 0,
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

/**
 * Exclui a venda numa transação só, via `fv.excluir_venda`: estoque de volta
 * (a peça que voltou na troca sai de novo), financeiro, pagamentos, itens,
 * troca e a venda — ou nada — deixando uma linha em `fv.stock_movements`
 * por peça devolvida (sem isso a conferência não via a exclusão, porque os
 * itens somem). Antes eram deletes soltos: um que falhasse no
 * meio deixava a venda existindo com o estoque já devolvido.
 *
 * DEPLOY: depende de supabase/migrations/20261001_venda_transacional.sql
 * (aplicar ANTES do push; sem caminho antigo).
 */
export async function deletarVenda(saleId: string): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyUser()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  /* Excluir é do admin, e só na loja dele. A tela já escondia o botão da
   * operadora, mas a action aceitava qualquer sessão e qualquer loja (07/10). */
  const perfil = await getProfile()
  if (!perfil || !ehAdmin(perfil)) return { success: false, error: 'Só a administração pode excluir venda.' }

  const admin = createAdminClient()

  const escopo = lojaDoEscopo(perfil)
  if (escopo) {
    const { data: alvo, error: alvoErr } = await admin.from('sales').select('store_id').eq('id', saleId).maybeSingle()
    if (alvoErr) return { success: false, error: 'Não consegui conferir a venda. Nada foi alterado.' }
    if (!alvo || alvo.store_id !== escopo) return { success: false, error: 'Venda não encontrada.' }
  }

  /* `p_user_id`: quem excluiu, no rastro de `fv.stock_movements` — a
   * conferência de estoque lê de lá o que se mexeu durante a contagem. */
  const { error } = await admin.rpc('excluir_venda', { p_sale_id: saleId, p_user_id: userId })
  if (error) {
    console.error('[deletarVenda] fv.excluir_venda falhou', { saleId, error })
    return {
      success: false,
      error: erroDoBancoRespondeu(error, 'deletarVenda')
        ? 'Não foi possível excluir a venda. Nada foi alterado — tente de novo em instantes.'
        : 'Não consegui confirmar se a venda foi excluída (falha de conexão). Confira em Vendas se ela ainda aparece antes de tentar de novo.',
    }
  }

  revalidarVendas()
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
  // Só a loja de quem pede; custo só para admin (o servidor recalcula o custo
  // das peças ao salvar, então a tela não precisa dele). 07/10/2026.
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active) return { data: null, error: VENDA_NAO_ENCONTRADA }
  const escopo = lojaDoEscopo(perfil)
  const veCusto = ehAdmin(perfil)
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
  if (escopo && s.store_id !== escopo) return { data: null, error: VENDA_NAO_ENCONTRADA }

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
        // Serviço guarda o custo declarado na tela (o servidor não recalcula).
        unitCost:       veCusto || i.products?.is_service ? Number(i.unit_cost) : 0,
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
// reaplica com os novos dados, mantendo o MESMO id — numa transação só, via
// `fv.editar_venda`. As conferências e as contas são as mesmas de salvarVenda.
//
// DEPLOY: depende de supabase/migrations/20261001_venda_transacional.sql
// (aplicar ANTES do push; sem caminho antigo).

export async function editarVenda(saleId: string, data: VendaFormData): Promise<ActionResult> {
  const { userId, storeId: userStoreId, error: authErr } = await verifyUser()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  // Mesma regra do `salvarVenda`: quem tem loja está preso a ela, admin ou não.
  const finalStoreId = userStoreId ?? data.storeId
  if (!finalStoreId) return { success: false, error: 'Loja não definida.' }

  const { data: existing, error: exErr } = await admin.from('sales').select('id, sale_date, store_id').eq('id', saleId).single()
  if (exErr || !existing) return { success: false, error: 'Venda não encontrada.' }
  // Quem tem loja só edita venda da loja dele (antes editava e "mudava de loja"
  // venda alheia pelo id). 07/10/2026.
  if (userStoreId && existing.store_id !== userStoreId) return { success: false, error: 'Venda não encontrada.' }

  /* A tela de edição já não abre nesses casos; aqui é a garantia para quem
   * estava com ela aberta antes, ou chamou a ação por outro caminho. */
  const bloqueio = await motivoParaNaoEditar(admin, saleId)
  if (bloqueio) return { success: false, error: bloqueio }

  // Tudo conferido ANTES de mexer na venda — falhar aqui não muda nada.
  const prep = await prepararVenda(admin, finalStoreId, data)
  if ('error' in prep) return { success: false, error: prep.error }

  const pacote = montarPacoteDaVenda(prep.data, {
    storeId: finalStoreId, userId, pixPct: prep.pixPct, birthdayPct: prep.birthdayPct, custos: prep.custos,
  })

  const { data: resp, error } = await admin.rpc('editar_venda', {
    p: { sale_id: saleId, ...pacote },
  })

  if (error) {
    console.error('[editarVenda] fv.editar_venda falhou', { saleId, error })
    return {
      success: false,
      error: erroDoBancoRespondeu(error, 'editarVenda')
        ? 'Não foi possível salvar a edição. A venda continua como estava — tente de novo em instantes.'
        : 'Não consegui confirmar se a edição foi salva (falha de conexão). Abra a venda em Vendas e confira antes de tentar de novo.',
    }
  }

  const r = (resp ?? {}) as { sale_id?: string; erro?: string; consertos_pendentes?: unknown }
  if (r.erro === 'nao_encontrada') return { success: false, error: 'Venda não encontrada.' }

  logarConsertosPendentes('editarVenda', saleId, r.consertos_pendentes)
  revalidarVendas()
  return { success: true, saleId }
}
