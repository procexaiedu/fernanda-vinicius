import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProgressByUser } from '@/lib/metas/server'
import { currentMonthKey } from '@/lib/metas/compute'
import UsuariosClient from './UsuariosClient'
import styles from './page.module.css'

export interface UserWithMetrics {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'operator'
  store_id: string | null
  store_name: string | null
  is_active: boolean
  created_at: string
  month_sales: number
  month_revenue: number
  meta_target: number
  meta_pct: number
  meta_reached: boolean
}

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

  const adminClient = createAdminClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [usersRes, emailsRes, salesMonthRes, storesRes] = await Promise.all([
    adminClient.from('users').select('*, stores(id, name)'),
    adminClient.rpc('get_user_emails'),
    adminClient
      .from('sales')
      .select('seller_id, total')
      .gte('sale_date', monthStart)
      .neq('status', 'cancelled'),
    adminClient.from('stores').select('id, name').order('name'),
  ])

  // Map de email por user id (via função SQL com JOIN em auth.users)
  const emailMap = new Map<string, string>(
    ((emailsRes.data ?? []) as { id: string; email: string }[]).map(u => [u.id, u.email ?? ''])
  )

  // Agregar métricas do mês por seller_id (vendedora real que fez a venda)
  const metricsMap = new Map<string, { month_sales: number; month_revenue: number }>()
  for (const sale of (salesMonthRes.data ?? []) as { seller_id: string | null; total: string | number }[]) {
    if (!sale.seller_id) continue
    const prev = metricsMap.get(sale.seller_id) ?? { month_sales: 0, month_revenue: 0 }
    metricsMap.set(sale.seller_id, {
      month_sales: prev.month_sales + 1,
      month_revenue: prev.month_revenue + Number(sale.total),
    })
  }

  const progressByUser = await getProgressByUser(currentMonthKey(now))

  const users: UserWithMetrics[] = ((usersRes.data ?? []) as {
    id: string
    full_name: string
    role: string
    store_id: string | null
    is_active: boolean
    created_at: string
    stores: { id: string; name: string } | null
  }[]).map(u => {
    const prog = progressByUser.get(u.id)
    return {
      id: u.id,
      full_name: u.full_name,
      email: emailMap.get(u.id) ?? '',
      role: u.role as 'admin' | 'operator',
      store_id: u.store_id,
      store_name: u.stores?.name ?? null,
      is_active: u.is_active,
      created_at: u.created_at,
      ...(metricsMap.get(u.id) ?? { month_sales: 0, month_revenue: 0 }),
      meta_target: prog?.target ?? 0,
      meta_pct: prog?.pct ?? 0,
      meta_reached: prog?.reached ?? false,
    }
  })

  const stores = (storesRes.data ?? []) as { id: string; name: string }[]

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Usuários</h1>
        <p className={styles.subtitle}>Gerencie a equipe e acompanhe a performance das vendedoras.</p>
      </div>
      <UsuariosClient
        users={users}
        stores={stores}
        currentUserId={user.id}
      />
    </div>
  )
}
