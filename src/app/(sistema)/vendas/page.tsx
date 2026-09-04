import { requireProfile, ehAdminGlobal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import VendasClient from './VendasClient'
import MinhaMetaCard from './MinhaMetaCard'
import { getUserProgress } from '@/lib/metas/server'
import { currentMonthKey, monthLabel, type MetaProgress } from '@/lib/metas/compute'

/** Fechamento de caixa — usado como filtro na tela de Vendas. */
export interface ClosingOption {
  id: string
  closing_date: string
  created_at: string
  period_start: string | null
  store_id: string
  store_name: string
  user_name: string
  sales_count: number
  total_sales: number
  counted_cash: number | null
  cash_difference: number | null
}

export interface SaleRow {
  id: string
  sale_date: string
  created_at: string
  customer_name: string | null
  customer_id: string | null
  store_name: string
  store_id: string
  seller_name: string | null
  seller_id: string | null
  items_count: number
  subtotal: number
  discount_pct: number
  discount_amount: number
  total: number
  payment_summary: string | null
  status: string
  has_exchange: boolean
  /*
   * Saldo em aberto: total menos o que entrou em `sale_payments`.
   *
   * DERIVADO, nunca guardado. `sale_payments` é quem sabe quanto foi pago; uma
   * coluna espelho em `sales` seria um segundo número contando a mesma coisa,
   * e um dia os dois discordariam.
   */
  valor_pago: number
  falta_pagar: number
  previsao_pagamento: string | null
}

export default async function VendasPage() {
  const profile = await requireProfile()

  const admin = createAdminClient()

  // Buscar vendas com joins
  let salesQuery = admin
    .from('sales')
    .select(`
      id, sale_date, created_at, subtotal, discount_pct, discount_amount, total,
      payment_summary, status, store_id, seller_id, previsao_pagamento,
      customers(name, id),
      stores(name)
    `)
    .order('sale_date', { ascending: false })
    .limit(200)

  /* Quem tem loja está preso a ela — admin de loja inclusive, não só operadora. */
  if (profile.store_id) {
    salesQuery = salesQuery.eq('store_id', profile.store_id)
  }

  /*
   * Operadora vê só as vendas de HOJE.
   *
   * Não é sigilo — é o que ela precisa. O papel dela é atender e fechar o
   * caixa do dia; histórico de meses é conversa de gestão. E limitar aqui, no
   * servidor, é o que impede que mudar o filtro na tela revele o resto.
   */
  if (profile.role === 'operator') {
    const hoje = new Date().toISOString().slice(0, 10)
    salesQuery = salesQuery.gte('sale_date', hoje).lte('sale_date', hoje)
  }

  // Fechamentos de caixa (para o filtro) — operadora vê os da própria loja
  let closingsQuery = admin
    .from('cash_closings')
    .select('id, closing_date, created_at, period_start, store_id, user_id, sales_count, total_sales, counted_cash, cash_difference')
    .order('created_at', { ascending: false })
    .limit(60)
  if (profile.store_id) {
    closingsQuery = closingsQuery.eq('store_id', profile.store_id)
  }

  // Lote 1 — vendas + listas de filtro (lojas/vendedoras/fechamentos não dependem das vendas)
  const [salesRes, storesRes, usersRes, closingsRes] = await Promise.all([
    salesQuery,
    /* Os filtros seguem o mesmo corte das vendas logo acima. Sem isto a tela
       oferece "vendedora: Rayane" para quem só tem venda de Campinas — filtro
       que nunca devolve nada e parece defeito. */
    (() => {
      let q = admin.from('stores').select('id, name').eq('is_active', true)
      if (profile.store_id) q = q.eq('id', profile.store_id)
      return q.order('name')
    })(),
    (() => {
      let q = admin.from('users').select('id, full_name').eq('is_active', true)
      if (profile.store_id) q = q.eq('store_id', profile.store_id)
      return q.order('full_name')
    })(),
    closingsQuery,
  ])

  const rawSales = salesRes.data
  const saleIds = (rawSales ?? []).map((s: any) => s.id)
  const sellerIds = [...new Set((rawSales ?? []).map((s: any) => s.seller_id).filter(Boolean))]

  // Lote 2 — tudo que depende dos ids das vendas, também em paralelo
  const [itemCountsRes, exchangesRes, sellersRes, paymentsRes] = await Promise.all([
    saleIds.length
      ? admin.from('sale_items').select('sale_id').in('sale_id', saleIds)
      : Promise.resolve({ data: [] as any[] }),
    saleIds.length
      ? admin.from('exchanges').select('id, sale_id, original_sale_id').or(`sale_id.in.(${saleIds.join(',')}),original_sale_id.in.(${saleIds.join(',')})`)
      : Promise.resolve({ data: [] as any[] }),
    sellerIds.length
      ? admin.from('users').select('id, full_name').in('id', sellerIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    saleIds.length
      ? admin.from('sale_payments').select('sale_id, amount').in('sale_id', saleIds)
      : Promise.resolve({ data: [] as { sale_id: string; amount: number }[] }),
  ])

  /* Quanto entrou por venda. Some daqui, não de uma coluna em `sales`. */
  const pagoPorVenda = new Map<string, number>()
  for (const p of (paymentsRes.data ?? []) as { sale_id: string; amount: number }[]) {
    pagoPorVenda.set(p.sale_id, (pagoPorVenda.get(p.sale_id) ?? 0) + Number(p.amount))
  }

  /*
   * Peça devolvida na troca também PAGA a venda.
   *
   * Sem isto a venda da Madalena — colar de R$498 pago com R$70 em Pix e um
   * colar de R$428 devolvido — aparecia como "FALTA R$428,00". Ela não devia
   * nada: a mercadoria cobriu a diferença.
   */
  const creditoTrocaPorVenda = new Map<string, number>()
  const trocaIds = ((exchangesRes.data ?? []) as { id?: string; sale_id?: string }[])
    .map(e => e.id).filter(Boolean) as string[]
  if (trocaIds.length) {
    const { data: devolvidos } = await admin
      .from('exchange_items')
      .select('exchange_id, quantity, unit_price')
      .in('exchange_id', trocaIds)
      .eq('direction', 'returned')

    const vendaPorTroca = new Map<string, string>()
    for (const e of (exchangesRes.data ?? []) as { id: string; sale_id: string | null }[]) {
      if (e.sale_id) vendaPorTroca.set(e.id, e.sale_id)
    }
    for (const it of (devolvidos ?? []) as { exchange_id: string; quantity: number; unit_price: number }[]) {
      const vendaId = vendaPorTroca.get(it.exchange_id)
      if (!vendaId) continue
      creditoTrocaPorVenda.set(
        vendaId,
        (creditoTrocaPorVenda.get(vendaId) ?? 0) + Number(it.unit_price) * Number(it.quantity),
      )
    }
  }

  const itemCounts = new Map<string, number>()
  for (const item of (itemCountsRes.data ?? []) as any[]) {
    itemCounts.set(item.sale_id, (itemCounts.get(item.sale_id) ?? 0) + 1)
  }

  const exchangeSaleIds = new Set(((exchangesRes.data ?? []) as any[]).map(e => e.original_sale_id))

  const sellersMap = new Map<string, string>()
  for (const u of (sellersRes.data ?? []) as any[]) sellersMap.set(u.id, u.full_name)

  const sales: SaleRow[] = (rawSales ?? []).map((s: any) => ({
    id:              s.id,
    sale_date:       s.sale_date,
    created_at:      s.created_at,
    customer_name:   s.customers?.name ?? null,
    customer_id:     s.customers?.id ?? null,
    store_name:      s.stores?.name ?? '—',
    store_id:        s.store_id,
    seller_name:     s.seller_id ? (sellersMap.get(s.seller_id) ?? null) : null,
    seller_id:       s.seller_id ?? null,
    items_count:     itemCounts.get(s.id) ?? 0,
    subtotal:        Number(s.subtotal),
    discount_pct:    Number(s.discount_pct),
    discount_amount: Number(s.discount_amount),
    total:           Number(s.total),
    payment_summary: s.payment_summary,
    status:          s.status,
    has_exchange:    exchangeSaleIds.has(s.id),
    valor_pago:      (pagoPorVenda.get(s.id) ?? 0) + (creditoTrocaPorVenda.get(s.id) ?? 0),
    /* Arredondado para não gerar "falta R$0,00" por resto de ponto flutuante. */
    falta_pagar:     parseFloat((
      Number(s.total) - (pagoPorVenda.get(s.id) ?? 0) - (creditoTrocaPorVenda.get(s.id) ?? 0)
    ).toFixed(2)),
    previsao_pagamento: s.previsao_pagamento ?? null,
  }))

  const stores = storesRes.data ?? []
  const sellers = usersRes.data ?? []

  const storeNameById = new Map((stores as any[]).map(s => [s.id, s.name]))
  const userNameById  = new Map((sellers as any[]).map(u => [u.id, u.full_name]))

  const closings: ClosingOption[] = ((closingsRes.data ?? []) as any[]).map(c => ({
    id:              c.id,
    closing_date:    c.closing_date,
    created_at:      c.created_at,
    period_start:    c.period_start,
    store_id:        c.store_id,
    store_name:      storeNameById.get(c.store_id) ?? '—',
    user_name:       userNameById.get(c.user_id) ?? '—',
    sales_count:     c.sales_count ?? 0,
    total_sales:     Number(c.total_sales) || 0,
    counted_cash:    c.counted_cash != null ? Number(c.counted_cash) : null,
    cash_difference: c.cash_difference != null ? Number(c.cash_difference) : null,
  }))

  // Operadora vê a própria meta do mês
  const monthKey = currentMonthKey(new Date())
  let minhaMeta: MetaProgress | null = null
  if (profile.role === 'operator') {
    minhaMeta = await getUserProgress(profile.id, monthKey)
  }

  return (
    <div>
      {minhaMeta && <MinhaMetaCard progress={minhaMeta} monthLabel={monthLabel(monthKey)} />}
      <VendasClient sales={sales} stores={stores} sellers={sellers} closings={closings} userRole={profile.role} podeTrocarLoja={ehAdminGlobal(profile)} />
    </div>
  )
}
