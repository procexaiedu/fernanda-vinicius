import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { listasDoEscopo } from '@/lib/listas-do-escopo'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/supabase/fetch-all'
import PdvClient from './PdvClient'
import { buscarCaixaDoDia } from './actions'
import { todaySP } from '@/lib/date'

export default async function PdvPage() {
  const profile = await requireProfile()

  const admin = createAdminClient()

  /*
   * A loja desta sessão. `null` só para admin global (Fernanda e nós).
   *
   * Era `profile.role === 'operator' && !!profile.store_id`, que deixava o
   * ADMIN DE LOJA de fora: a Eleandra, de Brasília, carregava o catálogo de
   * Campinas junto. Papel e escopo são eixos diferentes — quem tem loja está
   * preso a ela, admin ou não.
   */
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
    userId:    profile.id,
  }

  // Loja do caixa: operadora usa a sua; admin usa Campinas (ou a 1ª).
  const defaultStore =
    stores.find(s => /campin/i.test(s.name) || /campin/i.test(s.city))?.id
    ?? stores[0]?.id ?? ''
  const caixaStoreId = profile.store_id ?? defaultStore
  const date = todaySP()
  const initialCaixa = await buscarCaixaDoDia(caixaStoreId, date)

  return (
    <PdvClient
      stores={stores}
      products={products}
      customers={customers}
      settings={settings}
      userProfile={userProfile}
      users={users}
      initialCaixa={initialCaixa}
      caixaStoreId={caixaStoreId}
      date={date}
    />
  )
}
