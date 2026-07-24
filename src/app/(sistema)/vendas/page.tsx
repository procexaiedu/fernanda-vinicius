import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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
}

export default async function VendasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role, store_id').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  // Buscar vendas com joins
  let salesQuery = admin
    .from('sales')
    .select(`
      id, sale_date, created_at, subtotal, discount_pct, discount_amount, total,
      payment_summary, status, store_id, seller_id,
      customers(name, id),
      stores(name)
    `)
    .order('sale_date', { ascending: false })
    .limit(200)

  if (profile.role === 'operator' && profile.store_id) {
    salesQuery = salesQuery.eq('store_id', profile.store_id)
  }

  // Fechamentos de caixa (para o filtro) — operadora vê os da própria loja
  let closingsQuery = admin
    .from('cash_closings')
    .select('id, closing_date, created_at, period_start, store_id, user_id, sales_count, total_sales, counted_cash, cash_difference')
    .order('created_at', { ascending: false })
    .limit(60)
  if (profile.role === 'operator' && profile.store_id) {
    closingsQuery = closingsQuery.eq('store_id', profile.store_id)
  }

  // Lote 1 — vendas + listas de filtro (lojas/vendedoras/fechamentos não dependem das vendas)
  const [salesRes, storesRes, usersRes, closingsRes] = await Promise.all([
    salesQuery,
    admin.from('stores').select('id, name').eq('is_active', true).order('name'),
    admin.from('users').select('id, full_name').eq('is_active', true).order('full_name'),
    closingsQuery,
  ])

  const rawSales = salesRes.data
  const saleIds = (rawSales ?? []).map((s: any) => s.id)
  const sellerIds = [...new Set((rawSales ?? []).map((s: any) => s.seller_id).filter(Boolean))]

  // Lote 2 — tudo que depende dos ids das vendas, também em paralelo
  const [itemCountsRes, exchangesRes, sellersRes] = await Promise.all([
    saleIds.length
      ? admin.from('sale_items').select('sale_id').in('sale_id', saleIds)
      : Promise.resolve({ data: [] as any[] }),
    saleIds.length
      ? admin.from('exchanges').select('original_sale_id').in('original_sale_id', saleIds)
      : Promise.resolve({ data: [] as any[] }),
    sellerIds.length
      ? admin.from('users').select('id, full_name').in('id', sellerIds as string[])
      : Promise.resolve({ data: [] as any[] }),
  ])

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
    minhaMeta = await getUserProgress(user.id, monthKey)
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      {minhaMeta && <MinhaMetaCard progress={minhaMeta} monthLabel={monthLabel(monthKey)} />}
      <VendasClient sales={sales} stores={stores} sellers={sellers} closings={closings} userRole={profile.role} />
    </div>
  )
}
