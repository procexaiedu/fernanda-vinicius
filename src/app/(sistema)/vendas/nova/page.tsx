import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { listasDoEscopo } from '@/lib/listas-do-escopo'
import PageHeader from '@/components/ui/PageHeader'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/supabase/fetch-all'
import NovaVendaForm from './NovaVendaForm'

interface PageProps {
  /** `?bip=10100` — peça lida pelo leitor em outra tela do sistema. */
  searchParams: Promise<{ bip?: string }>
}

export default async function NovaVendaPage({ searchParams }: PageProps) {
  const { bip } = await searchParams
  const profile = await requireProfile()

  const admin = createAdminClient()

  // Quem tem loja está preso a ela — admin de loja inclusive. Ver lib/listas-do-escopo.
  const escopo = lojaDoEscopo(profile)
  const listas = listasDoEscopo(admin, escopo)

  const [storesRes, productsRes, customersRes, settingsRes, userStoreRes, usersRes] = await Promise.all([
    listas.lojas(),
    fetchAll((de, ate) => listas.produtos(de, ate)),
    listas.clientes(),
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
    listas.usuarios(),
  ])

  const stores    = storesRes.data ?? []
  const products  = productsRes
  const customers = customersRes.data ?? []
  const users     = usersRes.data ?? []

  const settingsMap = new Map((settingsRes.data ?? []).map(s => [s.key, Number(s.value)]))
  const settings = {
    pixDiscountPct:        settingsMap.get('pix_discount_pct') ?? 5,
    birthdayDiscountPct:   settingsMap.get('birthday_discount_pct') ?? 10,
    installmentThreshold:  settingsMap.get('installment_threshold') ?? 3000,
    maxInstallmentsDefault: settingsMap.get('max_installments_default') ?? 5,
    maxInstallmentsAbove:   settingsMap.get('max_installments_above_3k') ?? 6,
  }

  const userProfile = {
    role:      profile.role as 'admin' | 'operator',
    storeId:   profile.store_id ?? null,
    storeName: (userStoreRes as any).data?.name ?? null,
    fullName:  profile.full_name ?? '',
    userId:    profile.id,
  }

  return (
    <div>
      <PageHeader title="Nova Venda" backHref="/vendas" backLabel="Voltar para Vendas" />

      <NovaVendaForm
        stores={stores}
        products={products}
        customers={customers}
        settings={settings}
        userProfile={userProfile}
        users={users}
        bipInicial={bip ?? null}
      />
    </div>
  )
}
