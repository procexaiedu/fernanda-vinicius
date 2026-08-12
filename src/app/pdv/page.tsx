import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/supabase/fetch-all'
import PdvClient from './PdvClient'
import { buscarCaixaDoDia } from './actions'
import { todaySP } from '@/lib/date'

export default async function PdvPage() {
  const profile = await requireProfile()

  const admin = createAdminClient()

  // Operadora só vende na própria loja → carrega apenas o catálogo dela (menos dados).
  const isOperator = profile.role === 'operator' && !!profile.store_id
  // Paginado: o Supabase corta em 1000 linhas por requisição e já são 1.031
  // produtos ativos — 31 ficavam invisíveis para o leitor. Ver lib/supabase/fetch-all.
  const carregarProdutos = (de: number, ate: number) => {
    let q = admin.from('products')
      .select('id, name, code, barcode_number, category, store_id, sale_price, promotional_price, promotional_active, cost_price, quantity_in_stock, is_service')
      .eq('is_active', true)
    if (isOperator) q = q.eq('store_id', profile.store_id!)
    return q.order('name').range(de, ate)
  }

  const [storesRes, productsRes, customersRes, settingsRes, userStoreRes, usersRes] = await Promise.all([
    admin.from('stores').select('id, name, city').eq('is_active', true).order('name'),
    fetchAll(carregarProdutos),
    admin.from('customers').select('id, name, phone, cpf, birthday').order('name').limit(400),
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
