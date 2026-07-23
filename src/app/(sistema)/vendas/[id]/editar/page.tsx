import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import NovaVendaForm from '../../nova/NovaVendaForm'
import { buscarVendaParaEdicao } from '../../actions'

export default async function EditarVendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role, store_id, full_name').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  const [saleRes, storesRes, productsRes, customersRes, settingsRes, userStoreRes, usersRes] = await Promise.all([
    buscarVendaParaEdicao(id),
    admin.from('stores').select('id, name, city').eq('is_active', true).order('name'),
    admin.from('products')
      .select('id, name, code, barcode_number, category, store_id, sale_price, promotional_price, promotional_active, cost_price, quantity_in_stock, is_service')
      .eq('is_active', true)
      .order('name'),
    admin.from('customers').select('id, name, phone, cpf, birthday').order('name'),
    admin.from('settings').select('key, value').in('key', [
      'pix_discount_pct',
      'birthday_discount_pct',
      'max_installments_default',
      'max_installments_above_3k',
      'installment_threshold',
    ]),
    profile.store_id
      ? admin.from('stores').select('id, name').eq('id', profile.store_id).single()
      : Promise.resolve({ data: null }),
    admin.from('users').select('id, full_name, store_id').eq('is_active', true).order('full_name'),
  ])

  if (!saleRes.data) notFound()

  const stores    = storesRes.data ?? []
  const products  = productsRes.data ?? []
  const customers = customersRes.data ?? []
  const users     = usersRes.data ?? []

  const settingsMap = new Map((settingsRes.data ?? []).map(s => [s.key, Number(s.value)]))
  const settings = {
    pixDiscountPct:         settingsMap.get('pix_discount_pct') ?? 5,
    birthdayDiscountPct:    settingsMap.get('birthday_discount_pct') ?? 10,
    installmentThreshold:   settingsMap.get('installment_threshold') ?? 3000,
    maxInstallmentsDefault: settingsMap.get('max_installments_default') ?? 5,
    maxInstallmentsAbove:   settingsMap.get('max_installments_above_3k') ?? 6,
  }

  const userProfile = {
    role:      profile.role as 'admin' | 'operator',
    storeId:   profile.store_id ?? null,
    storeName: (userStoreRes as any).data?.name ?? null,
    fullName:  profile.full_name ?? '',
    userId:    user.id,
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <a
          href="/vendas"
          style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          ← Voltar para Vendas
        </a>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: 'var(--text-primary)' }}>
          Editar Venda
        </h1>
      </div>

      <NovaVendaForm
        stores={stores}
        products={products}
        customers={customers}
        settings={settings}
        userProfile={userProfile}
        users={users}
        editSale={saleRes.data}
      />
    </div>
  )
}
