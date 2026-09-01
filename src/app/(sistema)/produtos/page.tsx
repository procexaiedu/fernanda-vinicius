import { redirect } from 'next/navigation'
import { requireProfile, lojaDoEscopo, ehAdminGlobal, ehOperadora } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import ProdutosClient from './ProdutosClient'
import PageHeader from '@/components/ui/PageHeader'

const PAGE_SIZE = 50

export interface ProductWithRelations {
  id: string
  code: string
  name: string
  category: string
  material: string
  supplier_id: string
  store_id: string
  cost_price: number
  sale_price: number
  promotional_price: number | null
  promotional_active: boolean
  quantity_in_stock: number
  ownership_type: 'own' | 'consignment'
  purchase_month: number
  purchase_year: number
  last_sale_date: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  supplier_reference: string | null
  label_format: 'A' | 'B'
  barcode_number: string
  suppliers: { id: string; name: string; initials: string } | null
  stores: { id: string; name: string } | null
  /* Data da COMPRA que trouxe a peça — é a entrada de verdade, e não o dia em
   * que alguém digitou o cadastro. Ver src/lib/giro.ts. */
  purchases: { purchase_date: string } | null
}

export interface StoreOption { id: string; name: string }
export interface SupplierOption { id: string; name: string; initials: string }

interface PageProps {
  searchParams: Promise<{
    page?: string
    q?: string
    store_id?: string
    category?: string
    material?: string
    supplier_id?: string
    active?: string
  }>
}

export default async function ProdutosPage({ searchParams }: PageProps) {
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
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (effectiveStoreId) query = query.eq('store_id', effectiveStoreId)

  if (params.q) {
    const q = params.q.trim()
    query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,barcode_number.ilike.%${q}%`)
  }
  if (params.category) query = query.eq('category', params.category)
  if (params.material) query = query.eq('material', params.material)
  if (isAdmin && params.supplier_id) query = query.eq('supplier_id', params.supplier_id)

  if (!isAdmin) {
    query = query.eq('is_active', true)
  } else if (params.active !== 'false') {
    query = query.eq('is_active', true)
  }

  const [productsRes, materialsRes, storesRes, suppliersRes, categoryMappingsRes, markupRes, staleRes] = await Promise.all([
    query,
    admin.from('materials').select('name').eq('is_active', true).order('name'),
    podeTrocarLoja ? admin.from('stores').select('id, name').order('name') : Promise.resolve({ data: [] }),
    isAdmin ? admin.from('suppliers').select('id, name, initials').eq('is_active', true).order('name') : Promise.resolve({ data: [] }),
    admin.from('category_label_mapping').select('category, label_format').eq('is_active', true).order('category'),
    admin.from('settings').select('value').eq('key', 'default_markup_pct').maybeSingle(),
    admin.from('settings').select('value').eq('key', 'stale_product_days').maybeSingle(),
  ])

  const products = (productsRes.data ?? []) as ProductWithRelations[]
  const total = productsRes.count ?? 0

  const categories = [...new Set((categoryMappingsRes.data ?? []).map(r => r.category as string))].filter(Boolean).sort()
  const materials  = [...new Set((materialsRes.data ?? []).map(r => r.name as string))].filter(Boolean).sort()
  const stores     = (storesRes.data ?? []) as StoreOption[]
  const suppliers  = (suppliersRes.data ?? []) as SupplierOption[]
  const categoryLabelMap = Object.fromEntries(
    (categoryMappingsRes.data ?? []).map(r => [r.category, r.label_format as 'A' | 'B'])
  )
  // Mesmo markup usado na Compra — alimenta o preço de venda automático no cadastro de produto.
  const defaultMarkupPct = Number(markupRes.data?.value ?? 100)
  /* O corte de "parado" vem da configuração do negócio. As duas cópias de
   * getStatusVenda tinham 60 e 90 na mão, e a configuração diz 30. */
  const staleDays = Number(staleRes.data?.value ?? 60)

  return (
    <div>
      <PageHeader
        title="Produtos"
        subtitle={isAdmin
            ? 'Gerencie o catálogo de produtos e acompanhe o estoque por loja.'
            : 'Consulte os produtos disponíveis e seus preços.'}
      />
      <ProdutosClient
        products={products}
        total={total}
        page={page}
        perPage={PAGE_SIZE}
        isAdmin={isAdmin}
        stores={stores}
        suppliers={suppliers}
        categories={categories}
        materials={materials}
        categoryLabelMap={categoryLabelMap}
        defaultMarkupPct={defaultMarkupPct}
        staleDays={staleDays}
        filters={{
          q: params.q ?? '',
          store_id: params.store_id ?? '',
          category: params.category ?? '',
          material: params.material ?? '',
          supplier_id: params.supplier_id ?? '',
          active: params.active ?? 'true',
        }}
      />
    </div>
  )
}
