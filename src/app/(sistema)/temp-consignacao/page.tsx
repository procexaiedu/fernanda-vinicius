import { redirect } from 'next/navigation'
import { requireProfile, ehAdminGlobal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PageHeader from '@/components/ui/PageHeader'
import { listarLotes } from './actions'
import TempConsignacaoClient from './TempConsignacaoClient'

/*
 * TELA TEMPORÁRIA — ver o cabeçalho de ./actions.ts.
 * Apagar esta pasta inteira quando o lote da Emília estiver em Campinas.
 */
export const dynamic = 'force-dynamic'

export default async function TempConsignacaoPage() {
  const profile = await requireProfile()
  // O layout de (sistema) já barra a operadora; isto barra o admin de loja.
  if (!ehAdminGlobal(profile)) redirect('/')

  const [lotes, lojasRes] = await Promise.all([
    listarLotes(),
    createAdminClient().from('stores').select('id, name').order('name'),
  ])

  return (
    <>
      <PageHeader
        title="Consignações — correção de loja"
        subtitle="Tela temporária. Some assim que o lote da Emília estiver em Campinas."
      />
      <TempConsignacaoClient lotes={lotes} lojas={(lojasRes.data ?? []) as { id: string; name: string }[]} />
    </>
  )
}
