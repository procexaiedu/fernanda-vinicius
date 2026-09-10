import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeProgress, monthBounds, monthKeyToFirstDay, resolveGoal, type MetaProgress, type GoalLike } from './compute'

type GoalRow = GoalLike & { id: string }

export { resolveGoal }

/**
 * Quanto de cada venda foi CONSERTO — o que não entra na comissão.
 *
 * Regra dita pela dona na reunião de 09/09, sem margem para dúvida:
 *
 *   "A venda deu 500 reais, só que 80 reais é conserto. Então só 420 que vai
 *    ser calculado de comissão."
 *
 * O motivo é o mesmo que faz o conserto não ter custo: a loja não ganha nele.
 * Comissionar sobre dinheiro que vai inteiro para o Ourives sairia do bolso
 * dela.
 *
 * Reconhece pelo produto ser SERVIÇO. É a mesma marca que já dispensa o
 * conserto de baixar estoque, então não há duas verdades sobre o que é serviço.
 */
async function consertoPorVenda(
  admin: ReturnType<typeof createAdminClient>,
  saleIds: string[],
): Promise<Map<string, number>> {
  const fora = new Map<string, number>()
  if (!saleIds.length) return fora

  const { data } = await admin
    .from('sale_items')
    .select('sale_id, subtotal, products!inner(is_service)')
    .in('sale_id', saleIds)
    .eq('products.is_service', true)

  for (const linha of (data ?? []) as { sale_id: string; subtotal: number | string }[]) {
    fora.set(linha.sale_id, (fora.get(linha.sale_id) ?? 0) + Number(linha.subtotal))
  }
  return fora
}

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
    admin.from('sales').select('id, seller_id, total').gte('sale_date', start).lt('sale_date', end).neq('status', 'cancelled'),
  ])

  const goals = (goalsRes.data ?? []) as GoalRow[]
  const vendas = (salesRes.data ?? []) as { id: string; seller_id: string | null; total: number | string }[]

  // Conserto sai da base: a loja não ganha nele. Ver consertoPorVenda.
  const conserto = await consertoPorVenda(admin, vendas.map(v => v.id))

  // Agrega realizado por seller_id
  const realizedMap = new Map<string, { realized: number; count: number }>()
  for (const s of vendas) {
    if (!s.seller_id) continue
    const base = Number(s.total) - (conserto.get(s.id) ?? 0)
    const prev = realizedMap.get(s.seller_id) ?? { realized: 0, count: 0 }
    realizedMap.set(s.seller_id, { realized: prev.realized + base, count: prev.count + 1 })
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
    admin.from('sales').select('id, total').eq('seller_id', userId).gte('sale_date', start).lt('sale_date', end).neq('status', 'cancelled'),
  ])

  const goals = (goalsRes.data ?? []) as GoalRow[]
  const { target, pct } = resolveGoal(goals, userId, monthFirstDay)
  const rows = (salesRes.data ?? []) as { id: string; total: number | string }[]

  // Mesma regra do painel: conserto fora da base. Ver consertoPorVenda.
  const conserto = await consertoPorVenda(admin, rows.map(r => r.id))
  const realized = rows.reduce((s, r) => s + Number(r.total) - (conserto.get(r.id) ?? 0), 0)
  return computeProgress(target, pct, realized, rows.length)
}
