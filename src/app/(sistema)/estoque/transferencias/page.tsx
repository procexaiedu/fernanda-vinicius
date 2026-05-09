import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import TransferenciasClient from './TransferenciasClient'

const PAGE_SIZE = 20

export interface TransferWithRelations {
  id: string
  product_id: string
  from_store_id: string
  to_store_id: string
  quantity: number
  transfer_date: string
  notes: string | null
  created_at: string
  products: { code: string; name: string } | null
  from_store: { name: string } | null
  to_store: { name: string } | null
  users: { name: string } | null
}

interface PageProps {
  searchParams: Promise<{
    page?: string
    store_id?: string
    q?: string
  }>
}

export default async function TransferenciasPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/estoque')

  const page = Math.max(1, Number(params.page ?? 1))
  const offset = (page - 1) * PAGE_SIZE
  const admin = createAdminClient()

  let query = admin
    .from('stock_transfers')
    .select(
      'id, product_id, from_store_id, to_store_id, quantity, transfer_date, notes, created_at, products(code, name), from_store:stores!from_store_id(name), to_store:stores!to_store_id(name), users(name)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (params.store_id) {
    query = query.or(`from_store_id.eq.${params.store_id},to_store_id.eq.${params.store_id}`)
  }

  const [transfersRes, storesRes, productsRes] = await Promise.all([
    query,
    admin.from('stores').select('id, name').order('name'),
    admin.from('products').select('id, code, name, quantity_in_stock, store_id, stores(id, name)').eq('is_active', true).gt('quantity_in_stock', 0).order('name'),
  ])

  const transfers = (transfersRes.data ?? []) as unknown as TransferWithRelations[]
  const total = transfersRes.count ?? 0
  const stores = storesRes.data ?? []
  const productsForTransfer = (productsRes.data ?? []) as unknown as {
    id: string; code: string; name: string; quantity_in_stock: number; store_id: string; stores: { id: string; name: string } | null
  }[]

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Transferências de Estoque
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Histórico de movimentações e nova transferência entre lojas.
        </p>
      </div>
      <TransferenciasClient
        transfers={transfers}
        total={total}
        page={page}
        perPage={PAGE_SIZE}
        stores={stores}
        productsForTransfer={productsForTransfer}
        filters={{ store_id: params.store_id ?? '' }}
      />
    </div>
  )
}
