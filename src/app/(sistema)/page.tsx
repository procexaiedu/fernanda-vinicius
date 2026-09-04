import { redirect } from 'next/navigation'
import { requireProfile, lojaDoEscopo, ehAdminGlobal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import DashboardClient from './DashboardClient'
import {
  buscarLojas, lojaPadrao, buscarDashboardSettings,
  buscarKpis, buscarEstoque, buscarGrafico,
  buscarTopVendedoras,
  buscarPecasParadas, buscarContasVencer, buscarCobrancasDoDia, buscarAniversariantes,
  buscarVendasPorCategoria, buscarEvolucaoVendas,
} from './actions'

export default async function DashboardPage() {
  const profile = await requireProfile()

  // Operadora não usa o dashboard gerencial — vai direto pro PDV.
  if (profile.role === 'operator') redirect('/pdv')

  const isAdmin  = profile.role === 'admin'
  /*
   * Quem tem loja está preso a ela — admin de loja inclusive.
   * Era `isAdmin ? null : profile.store_id`, que dava a rede inteira a
   * qualquer admin. Ver src/lib/auth.ts.
   */
  const escopo = lojaDoEscopo(profile)

  /*
   * O PAINEL SEMPRE MOSTRA UMA LOJA. Nunca as duas somadas.
   *
   * "Todas as lojas" produzia o número que ninguém explicava: −R$86 mil no
   * total, Campinas positiva e Brasília zerada — três valores que não podem
   * coexistir se um for a soma dos outros. Não eram: as despesas não tinham
   * loja e só apareciam no total.
   *
   * A despesa passou a ser rateada (`fv.despesas_por_loja`), então cada loja
   * agora fecha sozinha e a soma perdeu a razão de existir.
   *
   * `lojasP` vai sem await: quem tem loja própria não espera nada, e a onda
   * única de consultas continua partindo em t=0. Só o admin global paga a
   * espera de descobrir em qual loja cair.
   */
  const lojasP  = buscarLojas()
  const storeId = escopo ?? await lojaPadrao(await lojasP)

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
    kpis, estoque, grafico, topVendedoras, pecasParadas, contasVencer, cobrancas, aniversariantes, categorias, evolucao,
  ] = await Promise.all([
    lojasP,
    settingsP,
    buscarKpis(storeId, month, year, reservePctP),
    buscarEstoque(storeId, staleDaysP),
    buscarGrafico(storeId, 6),
    buscarTopVendedoras(storeId, month, year),
    buscarPecasParadas(storeId, staleDaysP),
    buscarContasVencer(storeId),
    buscarCobrancasDoDia(storeId),
    buscarAniversariantes(storeId),
    buscarVendasPorCategoria(storeId, month, year),
    buscarEvolucaoVendas(storeId, 6),
  ])

  return (
    <DashboardClient
      isAdmin={isAdmin}
      podeTrocarLoja={ehAdminGlobal(profile)}
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
      initialCobrancas={cobrancas}
      initialAniversariantes={aniversariantes}
      initialCategorias={categorias}
      initialEvolucao={evolucao}
      initialMonth={month}
      initialYear={year}
    />
  )
}
