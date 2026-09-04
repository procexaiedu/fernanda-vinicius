import { notFound } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { listasDoEscopo } from '@/lib/listas-do-escopo'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/supabase/fetch-all'
import NovaVendaForm from '../../nova/NovaVendaForm'
import { buscarVendaParaEdicao } from '../../actions'

export default async function EditarVendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireProfile()

  const admin = createAdminClient()

  // Quem tem loja está preso a ela — admin de loja inclusive. Ver lib/listas-do-escopo.
  const escopo = lojaDoEscopo(profile)
  const listas = listasDoEscopo(admin, escopo)

  const [saleRes, storesRes, productsRes, customersRes, settingsRes, userStoreRes, usersRes] = await Promise.all([
    buscarVendaParaEdicao(id),
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

  if (!saleRes.data) notFound()

  const stores    = storesRes.data ?? []
  const products  = productsRes
  const users     = usersRes.data ?? []

  /*
   * A cliente DESTA venda entra na lista mesmo fora do escopo.
   *
   * Vendas anteriores à separação de 04/09 podem ter cliente de outra loja de
   * origem. Sem esta linha, abrir a venda para editar apagaria a cliente do
   * seletor — e salvar depois gravaria a venda sem ela, silenciosamente.
   * Aparecer aqui não abre a base da outra loja: é uma cliente só, a que já
   * está nesta venda.
   */
  const daVenda   = saleRes.data?.customer
  const listaBase = customersRes.data ?? []
  const customers = daVenda && !listaBase.some((c: any) => c.id === daVenda.id)
    ? [daVenda as any, ...listaBase]
    : listaBase

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

  return (
    <div>
      <PageHeader title="Editar Venda" backHref="/vendas" backLabel="Voltar para Vendas" />

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
