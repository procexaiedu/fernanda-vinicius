/**
 * Helpers puros (sem DB) para metas de vendas por vendedora.
 *
 * Modelo: cada vendedora tem uma meta de faturamento mensal. A meta efetiva de
 * um mês é o override daquele mês, senão a meta padrão recorrente. Quando o
 * realizado atinge a meta, a comissão incide sobre TODO o faturamento do mês.
 */

export interface MetaProgress {
  /** Meta de faturamento (R$). 0 = sem meta definida. */
  target: number
  /** % de comissão da vendedora. */
  commissionPct: number
  /** Faturamento realizado no mês (soma de sales.total por seller_id). */
  realized: number
  /** Nº de vendas no mês. */
  salesCount: number
  /** % atingido (realized/target*100). 0 se sem meta. */
  pct: number
  /** Tem meta definida (target > 0). */
  hasGoal: boolean
  /** Atingiu a meta (realized >= target e target > 0). */
  reached: boolean
  /** Comissão projetada: reached ? realized * pct/100 : 0. */
  commission: number
}

export interface GoalLike {
  user_id: string
  month: string | null
  target_amount: number | string
  commission_pct: number | string
  id?: string
}

/** Meta efetiva (override do mês vence; senão padrão) a partir de goals de um user. */
export function resolveGoal(
  goals: GoalLike[],
  userId: string,
  monthFirstDay: string,
): { target: number; pct: number; goalId: string | null } {
  const ofUser = goals.filter(g => g.user_id === userId)
  const override = ofUser.find(g => g.month === monthFirstDay)
  const padrao = ofUser.find(g => g.month === null)
  const chosen = override ?? padrao ?? null
  return {
    target: chosen ? Number(chosen.target_amount) : 0,
    pct: chosen ? Number(chosen.commission_pct) : 0,
    goalId: chosen?.id ?? null,
  }
}

export function computeProgress(
  target: number,
  commissionPct: number,
  realized: number,
  salesCount: number,
): MetaProgress {
  const hasGoal = target > 0
  const reached = hasGoal && realized >= target
  const pct = hasGoal ? (realized / target) * 100 : 0
  const commission = reached ? realized * (commissionPct / 100) : 0
  return { target, commissionPct, realized, salesCount, pct, hasGoal, reached, commission }
}

/** 'YYYY-MM' → '2026-05' do mês atual. */
export function currentMonthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM' → primeiro dia do mês em ISO date 'YYYY-MM-01'. */
export function monthKeyToFirstDay(monthKey: string): string {
  return `${monthKey}-01`
}

/** Valida 'YYYY-MM'. */
export function isValidMonthKey(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

/** Limites [início, fim) do mês como ISO timestamps, para filtrar sale_date. */
export function monthBounds(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

/** Rótulo amigável do mês: '2026-05' → 'Maio 2026'. */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  return `${meses[m - 1]} ${y}`
}
