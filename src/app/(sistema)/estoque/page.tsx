import { redirect } from 'next/navigation'
import { requireProfile, lojaDoEscopo, ehAdminGlobal, ehOperadora } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import EstoqueClient from './EstoqueClient'
import type { ProductWithRelations, StoreOption } from '../produtos/page'
import PageHeader from '@/components/ui/PageHeader'

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
  const profile = await requireProfile()
  /* Trava própria: o layout é a rede geral, mas ela depende de um cabeçalho.
   * Aqui não depende de nada. Ver src/app/(sistema)/layout.tsx. */
  if (ehOperadora(profile)) redirect('/pdv')


  const isAdmin = profile.role === 'admin'
  /* O seletor de loja só faz sentido para quem pode trocar de loja. */
  const podeTrocarLoja = ehAdminGlobal(profile)
  /*
   * Quem tem loja está PRESO a ela — admin de loja inclusive.
   *
   * Antes era `isAdmin ? params.store_id : profile.store_id`, o que dava a rede
   * inteira a qualquer admin. O filtro da URL só vale para quem não tem loja
   * fixa; senão bastaria editar o endereço para ver a outra. Ver src/lib/auth.ts.
   */
  const effectiveStoreId = lojaDoEscopo(profile, params.store_id)

  const page = Math.max(1, Number(params.page ?? 1))
  const offset = (page - 1) * PAGE_SIZE
  const admin = createAdminClient()

  let query = admin
    .from('products')
    .select('*, suppliers(id, name, initials), stores(id, name), purchases(purchase_date)', { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (effectiveStoreId) query = query.eq('store_id', effectiveStoreId)
  if (params.qty_zero !== 'true') query = query.gt('quantity_in_stock', 0)
  if (params.q) {
    const q = params.q.trim()
    query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,barcode_number.ilike.%${q}%`)
  }
  if (params.category) query = query.eq('category', params.category)
  if (params.material) query = query.eq('material', params.material)

  const [productsRes, categoriesRes, materialsRes, storesRes, staleRes] = await Promise.all([
    query,
    admin.from('category_label_mapping').select('category').eq('is_active', true).order('category'),
    admin.from('products').select('material').eq('is_active', true).not('material', 'is', null),
    podeTrocarLoja ? admin.from('stores').select('id, name').order('name') : Promise.resolve({ data: [] }),
    admin.from('settings').select('value').eq('key', 'stale_product_days').maybeSingle(),
  ])

  const products = (productsRes.data ?? []) as ProductWithRelations[]
  const total = productsRes.count ?? 0
  const categories = [...new Set((categoriesRes.data ?? []).map(r => r.category as string))].filter(Boolean).sort()
  const materials  = [...new Set((materialsRes.data ?? []).map(r => r.material as string))].filter(Boolean).sort()
  const stores     = (storesRes.data ?? []) as StoreOption[]
  const staleDays  = Number(staleRes.data?.value ?? 60)

  return (
    <div>
      <PageHeader
        title="Estoque"
        subtitle="Visão operacional do estoque disponível por loja."
      />
      <EstoqueClient
        products={products}
        total={total}
        page={page}
        perPage={PAGE_SIZE}
        isAdmin={isAdmin}
        stores={stores}
        categories={categories}
        materials={materials}
        staleDays={staleDays}
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
