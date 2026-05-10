import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import NovaCompraForm from './NovaCompraForm'

export default async function NovaCompraPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  const [suppliersRes, storesRes, productsRes] = await Promise.all([
    admin.from('suppliers').select('id, name, initials').eq('is_active', true).order('name'),
    admin.from('stores').select('id, name, city').eq('is_active', true).order('name'),
    admin.from('products').select('id, name, code, category, material, cost_price, sale_price, promotional_price, supplier_id, store_id, ownership_type').eq('is_active', true).order('name'),
  ])

  const suppliers = suppliersRes.data ?? []
  const stores    = storesRes.data ?? []
  const products  = productsRes.data ?? []

  // Categorias e materiais distintos para combobox
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort()
  const materials  = [...new Set(products.map(p => p.material).filter(Boolean))].sort()

  return (
    <div style={{ padding: '24px 32px', maxWidth: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <a
          href="/compras"
          style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          ← Voltar para Compras
        </a>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: 'var(--text-primary)' }}>
          Nova Compra
        </h1>
      </div>

      <NovaCompraForm
        suppliers={suppliers}
        stores={stores}
        products={products}
        categories={categories}
        materials={materials}
      />
    </div>
  )
}
