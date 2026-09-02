import { redirect } from 'next/navigation'
import { requireProfile, podeConfigurarRede } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  currentMonthKey, isValidMonthKey, monthBounds, monthKeyToFirstDay, computeProgress,
} from '@/lib/metas/compute'
import { resolveGoal } from '@/lib/metas/server'
import MetasClient, { type MetaRow } from './MetasClient'
import PageHeader from '@/components/ui/PageHeader'

interface PageProps {
  searchParams: Promise<{ month?: string }>
}

interface GoalRow {
  id: string; user_id: string; month: string | null
  target_amount: number | string; commission_pct: number | string
}

export default async function MetasPage({ searchParams }: PageProps) {
  const { month: monthParam } = await searchParams
  const profile = await requireProfile()
  /*
   * Configuração é da REDE, não da loja: lojas, usuários, metas e regras do
   * negócio valem para as duas. `role !== 'admin'` deixava o admin de loja
   * entrar — de onde ele criava usuário e mudava a regra de desconto da outra
   * loja. Ver podeConfigurarRede() em src/lib/auth.ts.
   */
  if (!podeConfigurarRede(profile)) redirect('/')

  const admin = createAdminClient()

  // 'padrao' = editar meta padrão recorrente; senão um mês específico.
  const isDefaultMode = monthParam === 'padrao'
  const monthKey = isDefaultMode
    ? 'padrao'
    : (isValidMonthKey(monthParam) ? monthParam : currentMonthKey(new Date()))

  // Vendedoras = usuárias ativas com papel operadora
  const sellersRes = await admin
    .from('users')
    .select('id, full_name, store_id, stores(name)')
    .eq('role', 'operator')
    .eq('is_active', true)
    .order('full_name')

  const sellers = (sellersRes.data ?? []) as unknown as {
    id: string; full_name: string; store_id: string | null; stores: { name: string } | null
  }[]

  const goalsRes = await admin.from('seller_goals').select('id, user_id, month, target_amount, commission_pct')
  const goals = (goalsRes.data ?? []) as GoalRow[]

  let rows: MetaRow[]

  if (isDefaultMode) {
    rows = sellers.map(s => {
      const def = goals.find(g => g.user_id === s.id && g.month === null)
      return {
        userId: s.id,
        name: s.full_name,
        storeName: s.stores?.name ?? null,
        target: def ? Number(def.target_amount) : 0,
        commissionPct: def ? Number(def.commission_pct) : 0,
        hasOverride: false,
        defaultTarget: def ? Number(def.target_amount) : 0,
        realized: 0, salesCount: 0, pct: 0, reached: false, commission: 0,
        commissionGenerated: false,
      }
    })
  } else {
    const { start, end } = monthBounds(monthKey)
    const monthFirstDay = monthKeyToFirstDay(monthKey)
    const txDate = lastDayOfMonth(monthKey)

    const [salesRes, txRes] = await Promise.all([
      admin.from('sales').select('seller_id, total').gte('sale_date', start).lt('sale_date', end).neq('status', 'cancelled'),
      admin.from('transactions').select('user_id').eq('reference_type', 'seller_commission').eq('transaction_date', txDate),
    ])

    const realized = new Map<string, { realized: number; count: number }>()
    for (const sale of (salesRes.data ?? []) as { seller_id: string | null; total: number | string }[]) {
      if (!sale.seller_id) continue
      const p = realized.get(sale.seller_id) ?? { realized: 0, count: 0 }
      realized.set(sale.seller_id, { realized: p.realized + Number(sale.total), count: p.count + 1 })
    }
    const generated = new Set((txRes.data ?? []).map((t: { user_id: string | null }) => t.user_id))

    rows = sellers.map(s => {
      const { target, pct } = resolveGoal(goals, s.id, monthFirstDay)
      const def = goals.find(g => g.user_id === s.id && g.month === null)
      const hasOverride = goals.some(g => g.user_id === s.id && g.month === monthFirstDay)
      const r = realized.get(s.id) ?? { realized: 0, count: 0 }
      const prog = computeProgress(target, pct, r.realized, r.count)
      return {
        userId: s.id,
        name: s.full_name,
        storeName: s.stores?.name ?? null,
        target, commissionPct: pct,
        hasOverride,
        defaultTarget: def ? Number(def.target_amount) : 0,
        realized: prog.realized, salesCount: prog.salesCount, pct: prog.pct,
        reached: prog.reached, commission: prog.commission,
        commissionGenerated: generated.has(s.id),
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Metas de Vendas"
        subtitle="Defina a meta de faturamento e a comissão de cada vendedora, e acompanhe o progresso do mês."
      />
      <MetasClient mode={isDefaultMode ? 'default' : 'month'} monthKey={monthKey} rows={rows} />
    </div>
  )
}

function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
