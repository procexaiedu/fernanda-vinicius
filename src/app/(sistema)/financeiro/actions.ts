'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface TransactionFilters {
  type?: 'income' | 'expense' | ''
  status?: 'completed' | 'pending' | ''
  storeId?: string
  category?: string
  dateFrom?: string
  dateTo?: string
  userId?: string
}

export interface TransactionRow {
  id: string
  type: 'income' | 'expense'
  amount: number
  category: string
  description: string
  reference_type: string
  reference_id: string | null
  payment_method: string | null
  transaction_date: string
  due_date: string | null
  status: 'completed' | 'pending'
  paid_at: string | null
  cost_type: string | null
  store_id: string | null
  store_name: string | null
  user_id: string | null
  user_name: string | null
  recurring_expense_id: string | null
}

export interface PnlData {
  receitaBruta: number
  cmv: number
  lucroBruto: number
  despesasOp: number
  lucroLiquido: number
  aPagar: number
  breakdown: Array<{ category: string; amount: number; pct: number }>
  pendingBreakdown: Array<{ category: string; description: string; amount: number; due_date: string | null; reference_type: string }>
}

export interface RecurrenteRow {
  id: string
  store_id: string | null
  store_name: string | null
  description: string
  amount: number
  category: string
  cost_type: string
  recurrence: string
  day_of_month: number | null
  is_active: boolean
}

export interface DespesaManualData {
  description: string
  amount: number
  category: string
  store_id: string | null
  transaction_date: string
  due_date: string | null
  status: 'completed' | 'pending'
  cost_type: 'fixed' | 'variable'
  payment_method?: string
}

export interface RecurrenteData {
  description: string
  amount: number
  category: string
  store_id: string | null
  cost_type: 'fixed' | 'variable'
  recurrence: 'monthly' | 'weekly' | 'annual'
  day_of_month: number
  is_active: boolean
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export async function buscarTransacoes(filters: TransactionFilters): Promise<{ data: TransactionRow[]; error?: string }> {
  const admin = createAdminClient()

  let q = admin
    .from('transactions')
    .select('id, type, amount, category, description, reference_type, reference_id, payment_method, transaction_date, due_date, status, paid_at, cost_type, store_id, user_id, recurring_expense_id, stores(name), users(full_name)')
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.type)     q = q.eq('type', filters.type)
  if (filters.status)   q = q.eq('status', filters.status)
  if (filters.storeId)  q = q.eq('store_id', filters.storeId)
  if (filters.category) q = q.eq('category', filters.category)
  if (filters.dateFrom) q = q.gte('transaction_date', filters.dateFrom)
  if (filters.dateTo)   q = q.lte('transaction_date', filters.dateTo)
  if (filters.userId)   q = q.eq('user_id', filters.userId)

  const { data, error } = await q

  if (error) return { data: [], error: error.message }

  const rows: TransactionRow[] = (data ?? []).map((t: any) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    category: t.category,
    description: t.description,
    reference_type: t.reference_type,
    reference_id: t.reference_id,
    payment_method: t.payment_method,
    transaction_date: t.transaction_date,
    due_date: t.due_date,
    status: t.status,
    paid_at: t.paid_at,
    cost_type: t.cost_type,
    store_id: t.store_id,
    store_name: t.stores?.name ?? null,
    user_id: t.user_id,
    user_name: t.users?.full_name ?? null,
    recurring_expense_id: t.recurring_expense_id,
  }))

  return { data: rows }
}

export async function marcarComoPago(transactionId: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('transactions').update({
    status: 'completed',
    paid_at: new Date().toISOString(),
  }).eq('id', transactionId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

export async function criarDespesaManual(data: DespesaManualData): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()
  const paidAt = data.status === 'completed' ? new Date().toISOString() : null

  const { error } = await admin.from('transactions').insert({
    store_id: data.store_id,
    type: 'expense',
    amount: data.amount,
    category: data.category,
    description: data.description,
    reference_type: 'manual',
    payment_method: data.payment_method || null,
    transaction_date: data.transaction_date,
    due_date: data.due_date || null,
    status: data.status,
    paid_at: paidAt,
    cost_type: data.cost_type,
    user_id: userId,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

export async function editarDespesaManual(id: string, data: DespesaManualData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  // Só edita se for manual
  const { data: tx } = await admin.from('transactions').select('reference_type').eq('id', id).single()
  if (tx?.reference_type !== 'manual') return { success: false, error: 'Só é possível editar despesas manuais.' }

  const paidAt = data.status === 'completed' ? new Date().toISOString() : null

  const { error } = await admin.from('transactions').update({
    store_id: data.store_id,
    amount: data.amount,
    category: data.category,
    description: data.description,
    payment_method: data.payment_method || null,
    transaction_date: data.transaction_date,
    due_date: data.due_date || null,
    status: data.status,
    paid_at: paidAt,
    cost_type: data.cost_type,
  }).eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

export async function deletarDespesaManual(id: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { data: tx } = await admin.from('transactions').select('reference_type').eq('id', id).single()
  if (tx?.reference_type !== 'manual') return { success: false, error: 'Só é possível deletar despesas manuais.' }

  const { error } = await admin.from('transactions').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

// ─── Detalhe de Comissão ──────────────────────────────────────────────────────

export interface ComissaoSale {
  id: string
  sale_date: string
  client_name: string | null
  total: number
  total_cost: number
  profit: number
  store_name: string | null
}

export interface ComissaoDetail {
  transaction_id: string
  description: string
  seller_name: string
  month: string        // "YYYY-MM"
  commission_amount: number
  total_vendas: number
  total_custo: number
  lucro: number
  sales: ComissaoSale[]
}

export async function buscarDetalheComissao(transactionId: string): Promise<{ data: ComissaoDetail | null; error?: string }> {
  const admin = createAdminClient()

  const { data: tx, error: txErr } = await admin
    .from('transactions')
    .select('id, description, amount, transaction_date, user_id, users(full_name)')
    .eq('id', transactionId)
    .eq('reference_type', 'seller_commission')
    .single()

  if (txErr || !tx) return { data: null, error: 'Comissão não encontrada.' }

  const month = (tx.transaction_date as string).slice(0, 7) // "YYYY-MM"
  const dateFrom = `${month}-01`
  const lastDay  = new Date(parseInt(month.slice(0, 4)), parseInt(month.slice(5, 7)), 0).getDate()
  const dateTo   = `${month}-${String(lastDay).padStart(2, '0')}`

  const { data: salesRaw } = await admin
    .from('sales')
    .select('id, sale_date, total, total_cost, client_id, store_id, clients(name), stores(name), status')
    .eq('user_id', (tx as any).user_id)
    .gte('sale_date', dateFrom)
    .lte('sale_date', dateTo)
    .eq('status', 'completed')
    .order('sale_date', { ascending: true })

  const sales: ComissaoSale[] = (salesRaw ?? []).map((s: any) => ({
    id: s.id,
    sale_date: s.sale_date,
    client_name: s.clients?.name ?? null,
    total: s.total,
    total_cost: s.total_cost ?? 0,
    profit: (s.total ?? 0) - (s.total_cost ?? 0),
    store_name: s.stores?.name ?? null,
  }))

  const total_vendas = sales.reduce((sum, s) => sum + s.total, 0)
  const total_custo  = sales.reduce((sum, s) => sum + s.total_cost, 0)

  return {
    data: {
      transaction_id: tx.id,
      description: (tx as any).description,
      seller_name: (tx as any).users?.full_name ?? 'Vendedora',
      month,
      commission_amount: (tx as any).amount,
      total_vendas,
      total_custo,
      lucro: total_vendas - total_custo,
      sales,
    }
  }
}

export async function deletarComissao(transactionId: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { data: tx } = await admin
    .from('transactions')
    .select('reference_type')
    .eq('id', transactionId)
    .single()

  if (tx?.reference_type !== 'seller_commission') {
    return { success: false, error: 'Só é possível deletar transações de comissão por aqui.' }
  }

  const { error } = await admin.from('transactions').delete().eq('id', transactionId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

// ─── P&L ─────────────────────────────────────────────────────────────────────

export async function buscarPnl(storeId: string | null, month: number, year: number): Promise<{ data: PnlData | null; error?: string }> {
  const admin = createAdminClient()

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay  = new Date(year, month, 0).getDate()
  const dateTo   = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  let txQ = admin
    .from('transactions')
    .select('type, amount, status, category')
    .gte('transaction_date', dateFrom)
    .lte('transaction_date', dateTo)
    .eq('status', 'completed')

  if (storeId) txQ = txQ.eq('store_id', storeId)

  let pendQ = admin
    .from('transactions')
    .select('amount, category, description, due_date, reference_type')
    .eq('type', 'expense')
    .eq('status', 'pending')
    .gte('due_date', dateFrom)
    .lte('due_date', dateTo)
    .order('due_date', { ascending: true })

  if (storeId) pendQ = pendQ.eq('store_id', storeId)

  let salesQ = admin
    .from('sales')
    .select('total_cost')
    .gte('sale_date', dateFrom)
    .lte('sale_date', dateTo)

  if (storeId) salesQ = salesQ.eq('store_id', storeId)

  // Crédito de CMV: custo dos itens devolvidos em trocas no período
  let exchQ = admin
    .from('exchange_items')
    .select('quantity, unit_cost, exchanges!inner(exchange_date, store_id)')
    .eq('direction', 'returned')
    .gte('exchanges.exchange_date', dateFrom)
    .lte('exchanges.exchange_date', dateTo)

  if (storeId) exchQ = exchQ.eq('exchanges.store_id', storeId)

  const [txRes, pendRes, salesRes, exchRes] = await Promise.all([txQ, pendQ, salesQ, exchQ])

  if (txRes.error) return { data: null, error: txRes.error.message }

  const txRows = txRes.data ?? []
  const receitaBruta = txRows.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const despesasOp   = txRows.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const cmvBruto     = (salesRes.data ?? []).reduce((s: number, r: any) => s + (r.total_cost ?? 0), 0)
  const cmvCredito   = (exchRes.data ?? []).reduce((s: number, r: any) => s + Number(r.unit_cost ?? 0) * Number(r.quantity), 0)
  const cmv          = cmvBruto - cmvCredito
  const lucroBruto   = receitaBruta - cmv
  const lucroLiquido = lucroBruto - despesasOp
  const pendRows = (pendRes.data ?? []) as Array<{ amount: number; category: string; description: string; due_date: string | null; reference_type: string }>
  const aPagar   = pendRows.reduce((s, t) => s + t.amount, 0)
  const pendingBreakdown = pendRows.map(p => ({
    category:       p.category,
    description:    p.description,
    amount:         p.amount,
    due_date:       p.due_date,
    reference_type: p.reference_type,
  }))

  // Breakdown de despesas por categoria
  const catMap = new Map<string, number>()
  txRows.filter(t => t.type === 'expense').forEach(t => {
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + t.amount)
  })
  const breakdown = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({
      category,
      amount,
      pct: despesasOp > 0 ? (amount / despesasOp) * 100 : 0,
    }))

  return {
    data: { receitaBruta, cmv, lucroBruto, despesasOp, lucroLiquido, aPagar, breakdown, pendingBreakdown }
  }
}

// ─── Recorrentes ─────────────────────────────────────────────────────────────

export async function buscarRecorrentes(): Promise<{ data: RecurrenteRow[] }> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('recurring_expenses')
    .select('id, store_id, description, amount, category, cost_type, recurrence, day_of_month, is_active, stores(name)')
    .order('description')

  const rows: RecurrenteRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    store_id: r.store_id,
    store_name: r.stores?.name ?? null,
    description: r.description,
    amount: r.amount,
    category: r.category,
    cost_type: r.cost_type,
    recurrence: r.recurrence,
    day_of_month: r.day_of_month,
    is_active: r.is_active,
  }))

  return { data: rows }
}

export async function criarRecorrente(data: RecurrenteData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('recurring_expenses').insert({
    store_id: data.store_id,
    description: data.description,
    amount: data.amount,
    category: data.category,
    cost_type: data.cost_type,
    recurrence: data.recurrence,
    day_of_month: data.day_of_month,
    is_active: data.is_active,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

export async function editarRecorrente(id: string, data: RecurrenteData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('recurring_expenses').update({
    store_id: data.store_id,
    description: data.description,
    amount: data.amount,
    category: data.category,
    cost_type: data.cost_type,
    recurrence: data.recurrence,
    day_of_month: data.day_of_month,
    is_active: data.is_active,
  }).eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

export async function toggleRecorrente(id: string, isActive: boolean): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('recurring_expenses').update({ is_active: isActive }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

export async function deletarRecorrente(id: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  // Deslinkar transações antes de deletar
  await admin.from('transactions').update({ recurring_expense_id: null }).eq('recurring_expense_id', id)
  const { error } = await admin.from('recurring_expenses').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}

export async function gerarRecorrentesManual(): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.rpc('generate_monthly_recurring_expenses' as any)
  if (error) return { success: false, error: error.message }
  revalidatePath('/financeiro')
  return { success: true }
}
