import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import DashboardClient from './DashboardClient'
import {
  buscarLojas, buscarDashboardSettings,
  buscarKpis, buscarEstoque, buscarGrafico,
  buscarTopVendedoras,
  buscarPecasParadas, buscarContasVencer, buscarAniversariantes,
  buscarVendasPorCategoria, buscarEvolucaoVendas,
} from './actions'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  // Operadora não usa o dashboard gerencial — vai direto pro PDV.
  if (profile?.role === 'operator') redirect('/pdv')

  const isAdmin  = profile?.role === 'admin'
  // Operators always see their own store; admins start with null (all)
  const storeId  = isAdmin ? null : (profile?.store_id ?? null)

  const now   = new Date()
  const month = now.getMonth() + 1
  const year  = now.getFullYear()

  const admin = createAdminClient()
  const [lojas, settings, inactiveSetting] = await Promise.all([
    buscarLojas(),
    buscarDashboardSettings(),
    admin.from('settings').select('value').eq('key', 'inactive_customer_days').maybeSingle(),
  ])
  const inactiveDays = Number(inactiveSetting.data?.value ?? 180)

  const [kpis, estoque, grafico, topVendedoras, pecasParadas, contasVencer, aniversariantes, categorias, evolucao] =
    await Promise.all([
      buscarKpis(storeId, month, year, settings.purchaseReservePct),
      buscarEstoque(storeId, settings.staleDays),
      buscarGrafico(storeId, 6),
      buscarTopVendedoras(storeId, month, year),
      buscarPecasParadas(storeId, settings.staleDays),
      buscarContasVencer(storeId),
      buscarAniversariantes(storeId),
      buscarVendasPorCategoria(storeId, month, year),
      buscarEvolucaoVendas(storeId, 6),
    ])

  return (
    <DashboardClient
      isAdmin={isAdmin}
      initialStoreId={storeId}
      lojas={lojas}
      settings={settings}
      inactiveDays={inactiveDays}
      initialKpis={kpis}
      initialEstoque={estoque}
      initialGrafico={grafico}
      initialTopVendedoras={topVendedoras}
      initialPecasParadas={pecasParadas}
      initialContasVencer={contasVencer}
      initialAniversariantes={aniversariantes}
      initialCategorias={categorias}
      initialEvolucao={evolucao}
      initialMonth={month}
      initialYear={year}
    />
  )
}
