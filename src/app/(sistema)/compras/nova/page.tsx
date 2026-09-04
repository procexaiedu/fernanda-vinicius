import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import NovaCompraForm from './NovaCompraForm'

export default async function NovaCompraPage() {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  const escopo = lojaDoEscopo(profile)

  /*
   * FORNECEDOR CONTINUA DA REDE, de propósito.
   *
   * `suppliers` não tem loja e não deve ter: ela compra dos mesmos fornecedores
   * de São Paulo para as duas lojas. Cortar ali não protegeria nada e quebraria
   * a compra.
   *
   * Loja e catálogo, sim: sem isso a Eleandra abriria a compra e poderia
   * destinar as peças a Campinas, que é exatamente o que a separação impede.
   */
  const carregarLojasDaCompra = () => {
    let q = admin.from('stores').select('id, name, city').eq('is_active', true)
    if (escopo) q = q.eq('id', escopo)
    return q.order('name')
  }

  const carregarCatalogo = () => {
    let q = admin.from('products')
      .select('id, name, code, category, material, cost_price, sale_price, promotional_price, supplier_id, store_id, ownership_type')
      .eq('is_active', true)
    if (escopo) q = q.eq('store_id', escopo)
    return q.order('name')
  }

  const [suppliersRes, storesRes, productsRes, markupRes, categoryMappingsRes, materialsRes] = await Promise.all([
    admin.from('suppliers').select('id, name, initials').eq('is_active', true).order('name'),
    carregarLojasDaCompra(),
    carregarCatalogo(),
    admin.from('settings').select('value').eq('key', 'default_markup_pct').maybeSingle(),
    admin.from('category_label_mapping').select('category').eq('is_active', true).order('category'),
    admin.from('materials').select('name').eq('is_active', true).order('name'),
  ])

  const suppliers      = suppliersRes.data ?? []
  const stores         = storesRes.data ?? []
  const products       = productsRes.data ?? []
  const defaultMarkupPct = Number(markupRes.data?.value ?? 280)

  // Categorias e materiais vêm de tabelas dedicadas (fonte de verdade)
  const categories = [...new Set((categoryMappingsRes.data ?? []).map(r => r.category as string).filter(Boolean))].sort()
  const materials  = [...new Set((materialsRes.data ?? []).map(r => r.name as string).filter(Boolean))].sort()

  return (
    <div>
      <PageHeader title="Nova Compra" backHref="/compras" backLabel="Voltar para Compras" />

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
