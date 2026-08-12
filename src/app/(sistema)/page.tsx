import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
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
  const profile = await requireProfile()

  // Operadora não usa o dashboard gerencial — vai direto pro PDV.
  if (profile.role === 'operator') redirect('/pdv')

  const isAdmin  = profile.role === 'admin'
  // Operators always see their own store; admins start with null (all)
  const storeId  = isAdmin ? null : (profile.store_id ?? null)

  const now   = new Date()
  const month = now.getMonth() + 1
  const year  = now.getFullYear()

  /*
   * Tudo dispara em t=0, numa onda só.
   *
   * Antes eram DUAS ondas: primeiro `settings` + `lojas`, e só quando chegavam é
   * que as 12 consultas de dado partiam. Como cada ida ao Supabase custa ~190ms
   * de rede (o banco resolve em 16ms), essa espera era ~190ms de tela branca sem
   * nada acontecendo.
   *
   * O `settingsP` vai adiante SEM await: as ações que precisam de
   * `purchaseReservePct`/`staleDays` recebem a Promise e cobram o número só na
   * hora de fazer a conta, depois que as próprias linhas já voltaram.
   */
  const settingsP = buscarDashboardSettings()
  const staleDaysP   = settingsP.then(s => s.staleDays)
  const reservePctP  = settingsP.then(s => s.purchaseReservePct)

  const [
    lojas, settings,
    kpis, estoque, grafico, topVendedoras, pecasParadas, contasVencer, aniversariantes, categorias, evolucao,
  ] = await Promise.all([
    buscarLojas(),
    settingsP,
    buscarKpis(storeId, month, year, reservePctP),
    buscarEstoque(storeId, staleDaysP),
    buscarGrafico(storeId, 6),
    buscarTopVendedoras(storeId, month, year),
    buscarPecasParadas(storeId, staleDaysP),
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
      inactiveDays={settings.inactiveDays}
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
