'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean
  error?: string
  saleId?: string
}

export interface SaleItem {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  unitCost: number
}

export interface SalePaymentRow {
  method: 'cash' | 'pix' | 'debit' | 'credit'
  amount: number
  installments: number
}

export interface ExchangeItemSelected {
  saleItemId: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number            // preço efetivo pago (com desconto)
  originalSaleId: string
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
  notes: string
}

export interface VendaDetail {
  id: string
  sale_date: string
  store_name: string
  customer_name: string | null
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

function buildPaymentSummary(payments: SalePaymentRow[], hasExchange: boolean, exchangeCredit: number): string {
  const labels: string[] = []
  for (const p of payments) {
    const methodLabel = { cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito' }[p.method] ?? p.method
    if (p.method === 'credit' && p.installments > 1) {
      labels.push(`${methodLabel} ${p.installments}x`)
    } else {
      labels.push(methodLabel)
    }
  }
  if (hasExchange) labels.push(`Troca (R$ ${exchangeCredit.toFixed(2).replace('.', ',')})`)
  return labels.join(' + ')
}

// ─── Action: salvar venda ─────────────────────────────────────────────────────

export async function salvarVenda(data: VendaFormData): Promise<ActionResult> {
  const { userId, role, storeId: userStoreId, error: authErr } = await verifyUser()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  // Loja: operadora usa sua própria loja, admin usa a do form
  const finalStoreId = role === 'operator' && userStoreId ? userStoreId : data.storeId
  if (!finalStoreId) return { success: false, error: 'Loja não definida.' }
  if (!data.items.length) return { success: false, error: 'Adicione ao menos um produto.' }

  // ── 1. Carregar settings ──────────────────────────────────────────────────
  const { data: settingsRows } = await admin
    .from('settings')
    .select('key, value')
    .in('key', ['pix_discount_pct', 'birthday_discount_pct'])

  const settingsMap = new Map((settingsRows ?? []).map(s => [s.key, Number(s.value)]))
  const pixPct      = settingsMap.get('pix_discount_pct') ?? 5
  const birthdayPct = settingsMap.get('birthday_discount_pct') ?? 10

  // ── 2. Calcular totais ────────────────────────────────────────────────────
  const subtotal   = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const totalCost  = data.items.reduce((s, i) => s + i.unitCost  * i.quantity, 0)

  const discountPct = (data.hasPix ? pixPct : 0) + (data.hasBirthday ? birthdayPct : 0)
  const discountAmt = parseFloat((subtotal * discountPct / 100 + data.manualDiscount).toFixed(2))
  const total       = parseFloat((subtotal - discountAmt).toFixed(2))

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
  const { data: sale, error: saleErr } = await admin
    .from('sales')
    .insert({
      store_id:        finalStoreId,
      customer_id:     data.customerId ?? null,
      user_id:         userId,
      seller_id:       data.sellerId ?? userId,
      sale_date:       data.saleDate,
      subtotal,
      discount_type:   discountType,
      discount_pct:    discountPct,
      discount_amount: discountAmt,
      total,
      total_cost:      totalCost,
      payment_summary: paymentSummary,
      status:          'completed',
      notes:           data.notes || null,
    })
    .select('id')
    .single()

  if (saleErr || !sale) return { success: false, error: `Erro ao criar venda: ${saleErr?.message}` }

  // ── 6. Criar sale_items e decrementar estoque ─────────────────────────────
  const saleItems = data.items.map(i => ({
    sale_id:    sale.id,
    product_id: i.productId,
    quantity:   i.quantity,
    unit_price: i.unitPrice,
    unit_cost:  i.unitCost,
    subtotal:   parseFloat((i.unitPrice * i.quantity).toFixed(2)),
  }))

  const { error: itemsErr } = await admin.from('sale_items').insert(saleItems)
  if (itemsErr) return { success: false, error: `Erro ao criar itens: ${itemsErr.message}` }

  for (const item of data.items) {
    const { data: prod } = await admin.from('products').select('quantity_in_stock').eq('id', item.productId).single()
    const newQty = (prod?.quantity_in_stock ?? 0) - item.quantity
    await admin.from('products').update({ quantity_in_stock: newQty }).eq('id', item.productId)
  }

  // ── 7. Criar sale_payments + transactions ─────────────────────────────────
  for (const payment of data.payments) {
    const { error: ppErr } = await admin.from('sale_payments').insert({
      sale_id:        sale.id,
      payment_method: payment.method,
      amount:         payment.amount,
      installments:   payment.installments,
    })
    if (ppErr) return { success: false, error: `Erro ao criar pagamento: ${ppErr.message}` }

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
    if (txErr) return { success: false, error: `Erro ao criar transação: ${txErr.message}` }
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

    if (exchErr || !exchange) return { success: false, error: `Erro ao criar troca: ${exchErr?.message}` }

    // Itens devolvidos (returned) — voltam ao estoque, snapshot do custo para CMV
    for (const ei of data.exchangeItems) {
      const { data: prod } = await admin.from('products')
        .select('quantity_in_stock, cost_price')
        .eq('id', ei.productId).single()
      await admin.from('exchange_items').insert({
        exchange_id: exchange.id,
        direction:   'returned',
        product_id:  ei.productId,
        quantity:    ei.quantity,
        unit_price:  ei.unitPrice,
        unit_cost:   prod?.cost_price ?? 0,
      })
      await admin.from('products')
        .update({ quantity_in_stock: (prod?.quantity_in_stock ?? 0) + ei.quantity })
        .eq('id', ei.productId)
    }

    // Itens dados (given) — os que o cliente está levando nessa venda
    for (const item of data.items) {
      await admin.from('exchange_items').insert({
        exchange_id: exchange.id,
        direction:   'given',
        product_id:  item.productId,
        quantity:    item.quantity,
        unit_price:  item.unitPrice,
        unit_cost:   item.unitCost,
      })
    }
  }

  revalidatePath('/vendas')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  revalidatePath('/clientes')
  return { success: true, saleId: sale.id }
}

// ─── Action: detalhe de uma venda ─────────────────────────────────────────────

export async function buscarDetalheVenda(saleId: string): Promise<{ data: VendaDetail | null; error?: string }> {
  const admin = createAdminClient()

  const { data: sale, error: saleErr } = await admin
    .from('sales')
    .select('id, sale_date, subtotal, discount_type, discount_pct, discount_amount, total, total_cost, payment_summary, status, notes, customer_id, seller_id, customers(name), stores(name)')
    .eq('id', saleId)
    .single()

  if (saleErr || !sale) return { data: null, error: saleErr?.message }

  let sellerName: string | null = null
  const sellerIdVal = (sale as any).seller_id
  if (sellerIdVal) {
    const { data: sellerUser } = await admin.from('users').select('full_name').eq('id', sellerIdVal).single()
    sellerName = sellerUser?.full_name ?? null
  }

  const { data: rawItems } = await admin
    .from('sale_items')
    .select('id, quantity, unit_price, unit_cost, subtotal, products(name, code)')
    .eq('sale_id', saleId)

  const { data: payments } = await admin
    .from('sale_payments')
    .select('id, payment_method, amount, installments')
    .eq('sale_id', saleId)

  // Buscar exchange vinculado à venda (via sale_id)
  const { data: exchanges } = await admin
    .from('exchanges')
    .select('id, price_difference')
    .eq('sale_id', saleId)
    .limit(1)

  let exchangeDetail: VendaDetail['exchange'] = null

  if (exchanges && exchanges.length > 0) {
    const exch = exchanges[0]
    const { data: exchItems } = await admin
      .from('exchange_items')
      .select('direction, quantity, unit_price, products(name, code)')
      .eq('exchange_id', exch.id)

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
    }
  }
}

// ─── Action: vendas do cliente para troca ─────────────────────────────────────

export async function buscarVendasCliente(customerId: string, storeId: string): Promise<VendaParaTroca[]> {
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

  if (items) {
    for (const item of items) {
      const { data: prod } = await admin.from('products').select('quantity_in_stock').eq('id', item.product_id).single()
      await admin.from('products')
        .update({ quantity_in_stock: (prod?.quantity_in_stock ?? 0) + item.quantity })
        .eq('id', item.product_id)
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
          const { data: prod } = await admin.from('products').select('quantity_in_stock').eq('id', r.product_id).single()
          await admin.from('products')
            .update({ quantity_in_stock: (prod?.quantity_in_stock ?? 0) - r.quantity })
            .eq('id', r.product_id)
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

  if (error) return { success: false, error: error.message }

  revalidatePath('/vendas')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  revalidatePath('/clientes')
  return { success: true }
}

// ─── Action: gerar fechamento ─────────────────────────────────────────────────

export interface FechamentoParams {
  dateFrom: string   // YYYY-MM-DD
  dateTo: string     // YYYY-MM-DD
  sellerId: string | null  // null = todas as vendedoras (admin), ignorado para operadora
}

export interface FechamentoData {
  vendas: number
  receita: number
  ticketMedio: number
  trocas: number
  pagamentos: Array<{ method: string; label: string; amount: number }>
  categorias: Array<{ category: string; quantidade: number; receita: number }>
  porVendedora: Array<{ id: string; name: string; vendas: number; receita: number }>
}

export async function gerarFechamento(params: FechamentoParams): Promise<{ data: FechamentoData | null; error?: string }> {
  const { userId, role, storeId: userStoreId, error: authErr } = await verifyUser()
  if (authErr || !userId) return { data: null, error: authErr ?? 'Não autenticado.' }

  const admin = createAdminClient()

  let salesQuery = admin
    .from('sales')
    .select('id, total, seller_id')
    .gte('sale_date', params.dateFrom)
    .lte('sale_date', params.dateTo)
    .eq('status', 'completed')

  if (role === 'operator') {
    salesQuery = salesQuery.eq('seller_id', userId)
    if (userStoreId) salesQuery = salesQuery.eq('store_id', userStoreId)
  } else if (params.sellerId) {
    salesQuery = salesQuery.eq('seller_id', params.sellerId)
  }

  const { data: sales, error: salesErr } = await salesQuery
  if (salesErr) return { data: null, error: salesErr.message }

  const saleIds = (sales ?? []).map(s => s.id)

  if (saleIds.length === 0) {
    return { data: { vendas: 0, receita: 0, ticketMedio: 0, trocas: 0, pagamentos: [], categorias: [], porVendedora: [] } }
  }

  const [itemsRes, paymentsRes, exchangesRes] = await Promise.all([
    admin.from('sale_items').select('quantity, unit_price, products(category)').in('sale_id', saleIds),
    admin.from('sale_payments').select('payment_method, amount').in('sale_id', saleIds),
    admin.from('exchanges').select('id').in('sale_id', saleIds),
  ])

  const receita = (sales ?? []).reduce((s, v) => s + Number(v.total), 0)
  const vendas  = sales?.length ?? 0
  const trocas  = exchangesRes.data?.length ?? 0

  // Payment breakdown
  const paymentMap = new Map<string, number>()
  for (const p of paymentsRes.data ?? []) {
    paymentMap.set(p.payment_method, (paymentMap.get(p.payment_method) ?? 0) + Number(p.amount))
  }
  const methodLabels: Record<string, string> = { cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito' }
  const pagamentos = [...paymentMap.entries()]
    .map(([method, amount]) => ({ method, label: methodLabels[method] ?? method, amount }))
    .sort((a, b) => b.amount - a.amount)

  // Category breakdown
  const catMap = new Map<string, { quantidade: number; receita: number }>()
  for (const item of itemsRes.data ?? []) {
    const cat = ((item.products as any)?.category ?? 'outros').toLowerCase()
    const prev = catMap.get(cat) ?? { quantidade: 0, receita: 0 }
    catMap.set(cat, {
      quantidade: prev.quantidade + item.quantity,
      receita: prev.receita + Number(item.unit_price) * item.quantity,
    })
  }
  const categorias = [...catMap.entries()]
    .map(([category, d]) => ({
      category: category.charAt(0).toUpperCase() + category.slice(1),
      quantidade: d.quantidade,
      receita: d.receita,
    }))
    .sort((a, b) => b.receita - a.receita)

  // Per-seller breakdown (admin, all sellers)
  let porVendedora: FechamentoData['porVendedora'] = []
  if (role === 'admin' && !params.sellerId) {
    const sellerTotals = new Map<string, { vendas: number; receita: number }>()
    for (const sale of sales ?? []) {
      const sid = sale.seller_id ?? '__sem_vendedora__'
      const prev = sellerTotals.get(sid) ?? { vendas: 0, receita: 0 }
      sellerTotals.set(sid, { vendas: prev.vendas + 1, receita: prev.receita + Number(sale.total) })
    }
    const sellerIds = [...sellerTotals.keys()].filter(id => id !== '__sem_vendedora__')
    const { data: sellerUsers } = sellerIds.length > 0
      ? await admin.from('users').select('id, full_name').in('id', sellerIds)
      : { data: [] }
    const nameMap = new Map((sellerUsers ?? []).map(u => [u.id, u.full_name]))
    porVendedora = [...sellerTotals.entries()]
      .map(([id, d]) => ({ id, name: nameMap.get(id) ?? '—', vendas: d.vendas, receita: d.receita }))
      .sort((a, b) => b.receita - a.receita)
  }

  return { data: { vendas, receita, ticketMedio: vendas ? receita / vendas : 0, trocas, pagamentos, categorias, porVendedora } }
}
