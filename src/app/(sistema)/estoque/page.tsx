import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import EstoqueClient from './EstoqueClient'
import type { ProductWithRelations, StoreOption } from '../produtos/page'

const PAGE_SIZE = 50

interface PageProps {
  searchParams: Promise<{
    page?: string
    q?: string
    store_id?: string
    category?: string
    material?: string
    qty_zero?: string
  }>
}

export default async function EstoquePage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'
  const effectiveStoreId = isAdmin ? (params.store_id ?? null) : profile.store_id

  const page = Math.max(1, Number(params.page ?? 1))
  const offset = (page - 1) * PAGE_SIZE
  const admin = createAdminClient()

  let query = admin
    .from('products')
    .select('*, suppliers(id, name, initials), stores(id, name)', { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (effectiveStoreId) query = query.eq('store_id', effectiveStoreId)
  if (params.qty_zero !== 'true') query = query.gt('quantity_in_stock', 0)
  if (params.q) query = query.or(`name.ilike.%${params.q}%,code.ilike.%${params.q}%`)
  if (params.category) query = query.eq('category', params.category)
  if (params.material) query = query.eq('material', params.material)

  const [productsRes, categoriesRes, materialsRes, storesRes] = await Promise.all([
    query,
    admin.from('products').select('category').eq('is_active', true).not('category', 'is', null),
    admin.from('products').select('material').eq('is_active', true).not('material', 'is', null),
    isAdmin ? admin.from('stores').select('id, name').order('name') : Promise.resolve({ data: [] }),
  ])

  const products = (productsRes.data ?? []) as ProductWithRelations[]
  const total = productsRes.count ?? 0
  const categories = [...new Set((categoriesRes.data ?? []).map(r => r.category as string))].filter(Boolean).sort()
  const materials  = [...new Set((materialsRes.data ?? []).map(r => r.material as string))].filter(Boolean).sort()
  const stores     = (storesRes.data ?? []) as StoreOption[]

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Estoque
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Visão operacional do estoque disponível por loja.
        </p>
      </div>
      <EstoqueClient
        products={products}
        total={total}
        page={page}
        perPage={PAGE_SIZE}
        isAdmin={isAdmin}
        stores={stores}
        categories={categories}
        materials={materials}
        filters={{
          q: params.q ?? '',
          store_id: params.store_id ?? '',
          category: params.category ?? '',
          material: params.material ?? '',
          qty_zero: params.qty_zero ?? '',
        }}
      />
    </div>
  )
}
