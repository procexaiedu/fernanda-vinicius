import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import FinanceiroClient from './FinanceiroClient'
import { buscarTransacoes } from './actions'

export default async function FinanceiroPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

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

  const stores = storesRes.data ?? []
  const users  = usersRes.data ?? []

  // Categorias DISTINCT
  const catSet = new Set<string>()
  for (const c of categoriesRes.data ?? []) {
    if (c.category) catSet.add(c.category)
  }
  const categories = Array.from(catSet).sort()

  return (
    <div style={{ padding: '24px 32px', maxWidth: '100%' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Financeiro</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Ledger de transações, P&L e despesas recorrentes.
        </p>
      </div>

      <FinanceiroClient
        stores={stores}
        users={users}
        categories={categories}
        initialTransactions={txInitial.data}
      />
    </div>
  )
}
