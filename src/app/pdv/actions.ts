'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface CaixaLancamento {
  id: string
  time: string              // HH:MM
  customerName: string | null
  itemsCount: number
  paymentSummary: string | null
  total: number
}

export interface CaixaDoDia {
  date: string
  storeId: string
  totals: { cash: number; debit: number; credit: number; pix: number }
  totalSales: number
  salesCount: number
  lancamentos: CaixaLancamento[]
  closed: boolean
  closing: { counted_cash: number | null; cash_difference: number | null; total_sales: number; notes: string | null } | null
}

// Hora real do lançamento no fuso de Brasília. Usamos `created_at` (instante do
// registro) porque `sale_date` guarda só a DATA de negócio (meia-noite) — por isso
// a coluna Hora aparecia como 00:00.
function horaSP(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  } catch { return '—' }
}

// Consolida o movimento do dia (loja + data): totais por método, lançamentos e
// se o caixa já foi fechado.
export async function buscarCaixaDoDia(storeId: string, date: string): Promise<CaixaDoDia> {
  const empty: CaixaDoDia = {
    date, storeId, totals: { cash: 0, debit: 0, credit: 0, pix: 0 },
    totalSales: 0, salesCount: 0, lancamentos: [], closed: false, closing: null,
  }
  if (!storeId) return empty

  const admin = createAdminClient()

  const { data: sales } = await admin
    .from('sales')
    .select('id, sale_date, created_at, total, payment_summary, customers(name)')
    .eq('store_id', storeId)
    .eq('status', 'completed')
    .gte('sale_date', `${date}T00:00:00`)
    .lte('sale_date', `${date}T23:59:59`)
    .order('sale_date', { ascending: true })

  const saleRows = sales ?? []
  const saleIds = saleRows.map((s: any) => s.id)

  // Nº de itens por venda
  const itemsCountBySale = new Map<string, number>()
  if (saleIds.length) {
    const { data: items } = await admin.from('sale_items').select('sale_id').in('sale_id', saleIds)
    for (const it of items ?? []) {
      const sid = (it as any).sale_id
      itemsCountBySale.set(sid, (itemsCountBySale.get(sid) ?? 0) + 1)
    }
  }

  // Totais por método (a partir dos pagamentos — suporta venda mista)
  const totals = { cash: 0, debit: 0, credit: 0, pix: 0 }
  if (saleIds.length) {
    const { data: pays } = await admin.from('sale_payments').select('payment_method, amount').in('sale_id', saleIds)
    for (const p of pays ?? []) {
      const m = (p as any).payment_method as keyof typeof totals
      if (m in totals) totals[m] += Number((p as any).amount) || 0
    }
  }

  const totalSales = totals.cash + totals.debit + totals.credit + totals.pix

  const lancamentos: CaixaLancamento[] = saleRows.map((s: any) => ({
    id:             s.id,
    time:           horaSP(s.created_at),
    customerName:   s.customers?.name ?? null,
    itemsCount:     itemsCountBySale.get(s.id) ?? 0,
    paymentSummary: s.payment_summary ?? null,
    total:          Number(s.total) || 0,
  }))

  const { data: closing } = await admin
    .from('cash_closings')
    .select('counted_cash, cash_difference, total_sales, notes')
    .eq('store_id', storeId)
    .eq('closing_date', date)
    .maybeSingle()

  return {
    date, storeId, totals, totalSales,
    salesCount: saleRows.length, lancamentos,
    closed: !!closing,
    closing: closing
      ? { counted_cash: closing.counted_cash, cash_difference: closing.cash_difference, total_sales: Number(closing.total_sales), notes: closing.notes }
      : null,
  }
}

export interface FinalizarResult { success: boolean; error?: string }

// Fecha o caixa do dia: grava (ou atualiza) o cash_closings com os totais por
// método + conferência do dinheiro (contado x esperado).
export async function finalizarCaixa(storeId: string, date: string, countedCash: number, notes: string): Promise<FinalizarResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }
  if (!storeId) return { success: false, error: 'Loja não definida.' }

  const caixa = await buscarCaixaDoDia(storeId, date)
  if (caixa.salesCount === 0) return { success: false, error: 'Não há vendas para fechar neste dia.' }

  const admin = createAdminClient()
  const diff = parseFloat((countedCash - caixa.totals.cash).toFixed(2))

  const { error } = await admin.from('cash_closings').upsert({
    store_id:        storeId,
    user_id:         user.id,
    closing_date:    date,
    total_credit:    caixa.totals.credit,
    total_debit:     caixa.totals.debit,
    total_pix:       caixa.totals.pix,
    total_cash:      caixa.totals.cash,
    total_sales:     caixa.totalSales,
    sales_count:     caixa.salesCount,
    counted_cash:    countedCash,
    cash_difference: diff,
    notes:           notes || null,
  }, { onConflict: 'store_id,closing_date' })

  if (error) return { success: false, error: error.message }
  revalidatePath('/pdv')
  return { success: true }
}
