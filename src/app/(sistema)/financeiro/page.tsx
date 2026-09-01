import { redirect } from 'next/navigation'
import { requireProfile, ehAdminGlobal, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import FinanceiroClient from './FinanceiroClient'
import { buscarTransacoes } from './actions'
import PageHeader from '@/components/ui/PageHeader'

export default async function FinanceiroPage() {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  // Período default: mês atual
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const dateFrom = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const dateTo = `${y}-${String(m).padStart(2, '0')}-${lastDay}`

  const [storesRes, usersRes, categoriesRes, txInitial] = await Promise.all([
    admin.from('stores').select('id, name').eq('is_active', true).order('name'),
    admin.from('users').select('id, full_name').eq('is_active', true).order('full_name'),
    admin.from('transactions').select('category').order('category'),
    buscarTransacoes({ dateFrom, dateTo }),
  ])

  /*
   * A lista de lojas é o que a tela oferece — em filtro e em formulário de
   * despesa. Para quem está preso a uma loja ela tem um item só, senão o
   * cadastro de despesa deixaria lançar conta na loja da outra.
   */
  const escopo = lojaDoEscopo(profile)
  const todasAsLojas = storesRes.data ?? []
  const stores = escopo ? todasAsLojas.filter(s => s.id === escopo) : todasAsLojas
  const users  = usersRes.data ?? []

  // Categorias DISTINCT
  const catSet = new Set<string>()
  for (const c of categoriesRes.data ?? []) {
    if (c.category) catSet.add(c.category)
  }
  const categories = Array.from(catSet).sort()

  return (
    <div className="page-pad">
      <PageHeader
        title="Financeiro"
        subtitle="Ledger de transações, P&L e despesas recorrentes."
      />

      <FinanceiroClient
        podeTrocarLoja={ehAdminGlobal(profile)}
        stores={stores}
        users={users}
        categories={categories}
        initialTransactions={txInitial.data}
      />
    </div>
  )
}
