import { redirect } from 'next/navigation'
import { requireProfile, escopoDeUsuarios } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProgressByUser } from '@/lib/metas/server'
import { currentMonthKey } from '@/lib/metas/compute'
import UsuariosClient from './UsuariosClient'
import styles from './page.module.css'
import PageHeader from '@/components/ui/PageHeader'

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
  const profile = await requireProfile()
  /*
   * CADA ADMIN MANDA NA PRÓPRIA LOJA.
   *
   * Decisão do dono em 10/09: *"a Eleandra é admin de Brasília, então ela pode
   * criar, editar, apagar usuárias de Brasília, mas não pode fazer nada global
   * e nem ver nada de Campinas."*
   *
   * De 01/09 até aqui a tela era só do admin global — o que deixava a Leandra
   * sem conseguir nem repor uma operadora na própria loja, e isso ficou
   * concreto quando a Rayane pediu demissão em 09/09.
   *
   * O corte de verdade está nas ações (`actions.ts`); esta tela só não mostra
   * o que a pessoa não pode alcançar.
   */
  const { pode, loja: lojaDoAdmin } = escopoDeUsuarios(profile)
  if (!pode) redirect('/')

  const adminClient = createAdminClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [usersRes, emailsRes, salesMonthRes, storesRes] = await Promise.all([
    /* Admin de loja vê só a gente dele. Admin global (store_id NULL) não casa
       com loja nenhuma, então some da lista dela — e é isso que impede a
       Leandra de mexer na conta da dona. */
    (() => {
      let q = adminClient.from('users').select('*, stores(id, name)')
      if (lojaDoAdmin) q = q.eq('store_id', lojaDoAdmin)
      return q
    })(),
    adminClient.rpc('get_user_emails'),
    adminClient
      .from('sales')
      .select('seller_id, total')
      .gte('sale_date', monthStart)
      .neq('status', 'cancelled'),
    /* As lojas que o formulário pode oferecer: uma só para admin de loja,
       senão o seletor viraria a porta de criar gente na outra. */
    (() => {
      let q = adminClient.from('stores').select('id, name')
      if (lojaDoAdmin) q = q.eq('id', lojaDoAdmin)
      return q.order('name')
    })(),
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
      <PageHeader
        title="Usuários"
        subtitle="Gerencie a equipe e acompanhe a performance das vendedoras."
      />
      <UsuariosClient
        users={users}
        stores={stores}
        currentUserId={profile.id}
      />
    </div>
  )
}
