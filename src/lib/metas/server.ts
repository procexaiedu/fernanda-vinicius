import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeProgress, monthBounds, monthKeyToFirstDay, resolveGoal, type MetaProgress, type GoalLike } from './compute'

type GoalRow = GoalLike & { id: string }

export { resolveGoal }

/**
 * Progresso de meta por usuária (seller_id) para um mês.
 * Realizado = soma de sales.total por seller_id no mês (status != cancelled).
 */
export async function getProgressByUser(monthKey: string): Promise<Map<string, MetaProgress>> {
  const admin = createAdminClient()
  const { start, end } = monthBounds(monthKey)
  const monthFirstDay = monthKeyToFirstDay(monthKey)

  const [goalsRes, salesRes] = await Promise.all([
    admin.from('seller_goals').select('id, user_id, month, target_amount, commission_pct'),
    admin.from('sales').select('seller_id, total').gte('sale_date', start).lt('sale_date', end).neq('status', 'cancelled'),
  ])

  const goals = (goalsRes.data ?? []) as GoalRow[]

  // Agrega realizado por seller_id
  const realizedMap = new Map<string, { realized: number; count: number }>()
  for (const s of (salesRes.data ?? []) as { seller_id: string | null; total: number | string }[]) {
    if (!s.seller_id) continue
    const prev = realizedMap.get(s.seller_id) ?? { realized: 0, count: 0 }
    realizedMap.set(s.seller_id, { realized: prev.realized + Number(s.total), count: prev.count + 1 })
  }

  // Conjunto de usuários relevantes: quem tem meta OU vendeu no mês
  const userIds = new Set<string>([...goals.map(g => g.user_id), ...realizedMap.keys()])

  const out = new Map<string, MetaProgress>()
  for (const userId of userIds) {
    const { target, pct } = resolveGoal(goals, userId, monthFirstDay)
    const r = realizedMap.get(userId) ?? { realized: 0, count: 0 }
    out.set(userId, computeProgress(target, pct, r.realized, r.count))
  }
  return out
}

/** Progresso de uma única usuária no mês (ex.: detalhe da vendedora ou "minha meta"). */
export async function getUserProgress(userId: string, monthKey: string): Promise<MetaProgress> {
  const admin = createAdminClient()
  const { start, end } = monthBounds(monthKey)
  const monthFirstDay = monthKeyToFirstDay(monthKey)

  const [goalsRes, salesRes] = await Promise.all([
    admin.from('seller_goals').select('id, user_id, month, target_amount, commission_pct').eq('user_id', userId),
    admin.from('sales').select('total').eq('seller_id', userId).gte('sale_date', start).lt('sale_date', end).neq('status', 'cancelled'),
  ])

  const goals = (goalsRes.data ?? []) as GoalRow[]
  const { target, pct } = resolveGoal(goals, userId, monthFirstDay)
  const rows = (salesRes.data ?? []) as { total: number | string }[]
  const realized = rows.reduce((s, r) => s + Number(r.total), 0)
  return computeProgress(target, pct, realized, rows.length)
}
