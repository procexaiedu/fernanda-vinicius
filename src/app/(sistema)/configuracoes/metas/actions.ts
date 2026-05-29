'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  isValidMonthKey, monthKeyToFirstDay, monthBounds, monthLabel, computeProgress,
} from '@/lib/metas/compute'
import { resolveGoal } from '@/lib/metas/server'

export interface MetaActionResult {
  success: boolean
  error?: string
}

async function verifyAdmin(): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, error: 'Não autenticado.' }
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { userId: null, error: 'Acesso negado.' }
  return { userId: user.id, error: null }
}

function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function firstDayNextMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Cria/atualiza a meta padrão recorrente (month NULL) de uma vendedora. */
export async function upsertMetaPadrao(userId: string, targetAmount: number, commissionPct: number): Promise<MetaActionResult> {
  const { error } = await verifyAdmin()
  if (error) return { success: false, error }
  const admin = createAdminClient()
  const payload = { target_amount: targetAmount, commission_pct: commissionPct, updated_at: new Date().toISOString() }

  const { data: existing } = await admin
    .from('seller_goals').select('id').eq('user_id', userId).is('month', null).maybeSingle()

  const res = existing
    ? await admin.from('seller_goals').update(payload).eq('id', existing.id)
    : await admin.from('seller_goals').insert({ user_id: userId, month: null, ...payload })

  if (res.error) return { success: false, error: res.error.message }
  revalidatePath('/configuracoes/metas')
  revalidatePath('/configuracoes/usuarios')
  return { success: true }
}

/** Cria/atualiza o override de meta de um mês específico. */
export async function upsertMetaMes(userId: string, monthKey: string, targetAmount: number, commissionPct: number): Promise<MetaActionResult> {
  const { error } = await verifyAdmin()
  if (error) return { success: false, error }
  if (!isValidMonthKey(monthKey)) return { success: false, error: 'Mês inválido.' }
  const admin = createAdminClient()
  const month = monthKeyToFirstDay(monthKey)
  const payload = { target_amount: targetAmount, commission_pct: commissionPct, updated_at: new Date().toISOString() }

  const { data: existing } = await admin
    .from('seller_goals').select('id').eq('user_id', userId).eq('month', month).maybeSingle()

  const res = existing
    ? await admin.from('seller_goals').update(payload).eq('id', existing.id)
    : await admin.from('seller_goals').insert({ user_id: userId, month, ...payload })

  if (res.error) return { success: false, error: res.error.message }
  revalidatePath('/configuracoes/metas')
  revalidatePath('/configuracoes/usuarios')
  return { success: true }
}

/** Remove o override do mês (volta a valer a meta padrão). */
export async function removeMetaMes(userId: string, monthKey: string): Promise<MetaActionResult> {
  const { error } = await verifyAdmin()
  if (error) return { success: false, error }
  if (!isValidMonthKey(monthKey)) return { success: false, error: 'Mês inválido.' }
  const admin = createAdminClient()
  const month = monthKeyToFirstDay(monthKey)
  const res = await admin.from('seller_goals').delete().eq('user_id', userId).eq('month', month)
  if (res.error) return { success: false, error: res.error.message }
  revalidatePath('/configuracoes/metas')
  return { success: true }
}

export interface GerarComissoesResult extends MetaActionResult {
  created?: number
  updated?: number
  removed?: number
  total?: number
}

/**
 * Gera/reconcilia as despesas de comissão do mês no Financeiro (idempotente).
 * Para cada vendedora que atingiu a meta, cria/atualiza uma transação de despesa;
 * remove as de quem deixou de qualificar (ex.: vendas alteradas).
 */
export async function gerarComissoesDoMes(monthKey: string): Promise<GerarComissoesResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }
  if (!isValidMonthKey(monthKey)) return { success: false, error: 'Mês inválido.' }

  const admin = createAdminClient()
  const { start, end } = monthBounds(monthKey)
  const monthFirstDay = monthKeyToFirstDay(monthKey)
  const txDate = lastDayOfMonth(monthKey)
  const dueDate = firstDayNextMonth(monthKey)

  const [goalsRes, salesRes, usersRes, existingRes] = await Promise.all([
    admin.from('seller_goals').select('id, user_id, month, target_amount, commission_pct'),
    admin.from('sales').select('seller_id, total').gte('sale_date', start).lt('sale_date', end).neq('status', 'cancelled'),
    admin.from('users').select('id, full_name, store_id'),
    admin.from('transactions').select('id, user_id').eq('reference_type', 'seller_commission').eq('transaction_date', txDate),
  ])

  const goals = (goalsRes.data ?? []) as { id: string; user_id: string; month: string | null; target_amount: number | string; commission_pct: number | string }[]
  const usersById = new Map((usersRes.data ?? []).map((u: { id: string; full_name: string; store_id: string | null }) => [u.id, u]))
  const existingByUser = new Map((existingRes.data ?? []).map((t: { id: string; user_id: string | null }) => [t.user_id, t.id]))

  const realized = new Map<string, { realized: number; count: number }>()
  for (const s of (salesRes.data ?? []) as { seller_id: string | null; total: number | string }[]) {
    if (!s.seller_id) continue
    const p = realized.get(s.seller_id) ?? { realized: 0, count: 0 }
    realized.set(s.seller_id, { realized: p.realized + Number(s.total), count: p.count + 1 })
  }

  const qualifying = new Map<string, number>()
  const userIds = new Set<string>([...goals.map(g => g.user_id), ...realized.keys()])
  for (const uid of userIds) {
    const { target, pct } = resolveGoal(goals, uid, monthFirstDay)
    const r = realized.get(uid) ?? { realized: 0, count: 0 }
    const prog = computeProgress(target, pct, r.realized, r.count)
    if (prog.reached && prog.commission > 0) qualifying.set(uid, prog.commission)
  }

  let created = 0, updated = 0, removed = 0
  for (const [uid, commission] of qualifying) {
    const u = usersById.get(uid)
    const desc = `Comissão ${u?.full_name ?? 'vendedora'} — ${monthLabel(monthKey)}`
    const amount = Math.round(commission * 100) / 100
    const existingId = existingByUser.get(uid)
    if (existingId) {
      const { error } = await admin.from('transactions').update({ amount, description: desc, store_id: u?.store_id ?? null }).eq('id', existingId)
      if (error) return { success: false, error: `Erro ao atualizar comissão: ${error.message}` }
      updated++
    } else {
      const { error } = await admin.from('transactions').insert({
        type: 'expense', cost_type: 'variable', category: 'Comissão', amount,
        description: desc, reference_type: 'seller_commission', reference_id: null,
        user_id: uid, store_id: u?.store_id ?? null,
        transaction_date: txDate, due_date: dueDate, status: 'pending',
      })
      if (error) return { success: false, error: `Erro ao criar comissão: ${error.message}` }
      created++
    }
  }

  for (const [uid, txId] of existingByUser) {
    if (!qualifying.has(uid as string)) {
      const { error } = await admin.from('transactions').delete().eq('id', txId)
      if (error) return { success: false, error: `Erro ao remover comissão: ${error.message}` }
      removed++
    }
  }

  revalidatePath('/configuracoes/metas')
  revalidatePath('/financeiro')
  return { success: true, created, updated, removed, total: qualifying.size }
}
