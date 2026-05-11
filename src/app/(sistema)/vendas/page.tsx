import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import VendasClient from './VendasClient'

export interface SaleRow {
  id: string
  sale_date: string
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
      id, sale_date, subtotal, discount_pct, discount_amount, total,
      payment_summary, status, store_id, seller_id,
      customers(name, id),
      stores(name)
    `)
    .order('sale_date', { ascending: false })
    .limit(200)

  if (profile.role === 'operator' && profile.store_id) {
    salesQuery = salesQuery.eq('store_id', profile.store_id)
  }

  const { data: rawSales } = await salesQuery

  // Buscar item counts e exchange flags
  const saleIds = (rawSales ?? []).map(s => s.id)

  const [itemCountsRes, exchangesRes] = saleIds.length > 0
    ? await Promise.all([
        admin.from('sale_items').select('sale_id').in('sale_id', saleIds),
        admin.from('exchanges').select('original_sale_id').in('original_sale_id', saleIds),
      ])
    : [{ data: [] }, { data: [] }]

  const itemCounts = new Map<string, number>()
  for (const item of itemCountsRes.data ?? []) {
    itemCounts.set(item.sale_id, (itemCounts.get(item.sale_id) ?? 0) + 1)
  }

  const exchangeSaleIds = new Set((exchangesRes.data ?? []).map(e => e.original_sale_id))

  // Buscar sellers (nomes) para as vendas listadas
  const sellerIds = [...new Set((rawSales ?? []).map((s: any) => s.seller_id).filter(Boolean))]
  const sellersMap = new Map<string, string>()
  if (sellerIds.length > 0) {
    const { data: sellerUsers } = await admin.from('users').select('id, full_name').in('id', sellerIds)
    for (const u of sellerUsers ?? []) sellersMap.set(u.id, u.full_name)
  }

  const sales: SaleRow[] = (rawSales ?? []).map((s: any) => ({
    id:              s.id,
    sale_date:       s.sale_date,
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

  const [storesRes, usersRes] = await Promise.all([
    admin.from('stores').select('id, name').eq('is_active', true).order('name'),
    admin.from('users').select('id, full_name').eq('is_active', true).order('full_name'),
  ])

  const stores = storesRes.data ?? []
  const sellers = usersRes.data ?? []

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Vendas</h1>
        <Link
          href="/vendas/nova"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 16px',
            background: 'var(--accent)', color: '#000',
            borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          + Nova Venda
        </Link>
      </div>

      <VendasClient sales={sales} stores={stores} sellers={sellers} userRole={profile.role} />
    </div>
  )
}
