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

  const [suppliersRes, storesRes, productsRes, markupRes, categoryMappingsRes, materialsRes] = await Promise.all([
    admin.from('suppliers').select('id, name, initials').eq('is_active', true).order('name'),
    admin.from('stores').select('id, name, city').eq('is_active', true).order('name'),
    admin.from('products').select('id, name, code, category, material, cost_price, sale_price, promotional_price, supplier_id, store_id, ownership_type').eq('is_active', true).order('name'),
    admin.from('settings').select('value').eq('key', 'default_markup_pct').maybeSingle(),
    admin.from('category_label_mapping').select('category').order('category'),
    admin.from('materials').select('name').order('name'),
  ])

  const suppliers      = suppliersRes.data ?? []
  const stores         = storesRes.data ?? []
  const products       = productsRes.data ?? []
  const defaultMarkupPct = Number(markupRes.data?.value ?? 280)

  // Categorias e materiais vêm de tabelas dedicadas (fonte de verdade)
  const categories = [...new Set((categoryMappingsRes.data ?? []).map(r => r.category as string).filter(Boolean))].sort()
  const materials  = [...new Set((materialsRes.data ?? []).map(r => r.name as string).filter(Boolean))].sort()

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
        defaultMarkupPct={defaultMarkupPct}
      />
    </div>
  )
}
