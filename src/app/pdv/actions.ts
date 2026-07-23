'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface CaixaLancamento {
  id: string
  time: string              // HH:MM (fuso de Brasília)
  customerName: string | null
  itemsCount: number
  paymentSummary: string | null
  total: number
}

/** Resumo de um fechamento já realizado (snapshot de conferência de uma janela). */
export interface CaixaFechamento {
  at: string                // ISO do momento do fechamento (corte)
  atLabel: string           // HH:MM
  totalSales: number
  salesCount: number
  countedCash: number | null
  cashDifference: number | null
  notes: string | null
}

export interface CaixaDoDia {
  date: string
  storeId: string
  /** Totais da JANELA ATUAL (após o último fechamento). É isso que "zera" ao fechar. */
  totals: { cash: number; debit: number; credit: number; pix: number }
  totalSales: number
  salesCount: number
  lancamentos: CaixaLancamento[]
  /** Último fechamento do dia, se houver — só informativo. */
  lastClosing: CaixaFechamento | null
}

// Hora real no fuso de Brasília. Usamos `created_at` (instante do registro) porque
// `sale_date` guarda só a DATA de negócio (meia-noite).
function horaSP(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  } catch { return '—' }
}

/**
 * Movimento da JANELA atual (loja + dia, a partir do último fechamento).
 * Não existe caixa "aberto/fechado": fechar apenas consolida e zera a visão dali.
 */
export async function buscarCaixaDoDia(storeId: string, date: string): Promise<CaixaDoDia> {
  const empty: CaixaDoDia = {
    date, storeId, totals: { cash: 0, debit: 0, credit: 0, pix: 0 },
    totalSales: 0, salesCount: 0, lancamentos: [], lastClosing: null,
  }
  if (!storeId) return empty

  const admin = createAdminClient()

  // Último fechamento do dia = corte da janela atual
  const { data: closings } = await admin
    .from('cash_closings')
    .select('created_at, total_sales, sales_count, counted_cash, cash_difference, notes')
    .eq('store_id', storeId)
    .eq('closing_date', date)
    .order('created_at', { ascending: false })
    .limit(1)

  const last: any = (closings ?? [])[0]
  const lastClosing: CaixaFechamento | null = last ? {
    at:             last.created_at,
    atLabel:        horaSP(last.created_at),
    totalSales:     Number(last.total_sales) || 0,
    salesCount:     last.sales_count ?? 0,
    countedCash:    last.counted_cash != null ? Number(last.counted_cash) : null,
    cashDifference: last.cash_difference != null ? Number(last.cash_difference) : null,
    notes:          last.notes ?? null,
  } : null

  let salesQuery = admin
    .from('sales')
    .select('id, sale_date, created_at, total, payment_summary, customers(name)')
    .eq('store_id', storeId)
    .eq('status', 'completed')
    .gte('sale_date', `${date}T00:00:00`)
    .lte('sale_date', `${date}T23:59:59`)

  // É isto que "zera" a visão: só conta o que veio depois do último fechamento.
  if (lastClosing) salesQuery = salesQuery.gt('created_at', lastClosing.at)

  const { data: sales } = await salesQuery.order('created_at', { ascending: true })

  const saleRows = sales ?? []
  const saleIds = saleRows.map((s: any) => s.id)

  const itemsCountBySale = new Map<string, number>()
  if (saleIds.length) {
    const { data: items } = await admin.from('sale_items').select('sale_id').in('sale_id', saleIds)
    for (const it of items ?? []) {
      const sid = (it as any).sale_id
      itemsCountBySale.set(sid, (itemsCountBySale.get(sid) ?? 0) + 1)
    }
  }

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

  return { date, storeId, totals, totalSales, salesCount: saleRows.length, lancamentos, lastClosing }
}

export interface FinalizarResult { success: boolean; error?: string }

/**
 * Fecha o caixa: grava um NOVO fechamento com os totais da janela atual + a
 * conferência da gaveta. Depois disso a visão zera (a próxima consulta usa este
 * fechamento como corte). Pode ser feito várias vezes no mesmo dia (turnos).
 */
export async function finalizarCaixa(storeId: string, date: string, countedCash: number, notes: string): Promise<FinalizarResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }
  if (!storeId) return { success: false, error: 'Loja não definida.' }

  const caixa = await buscarCaixaDoDia(storeId, date)
  if (caixa.salesCount === 0) return { success: false, error: 'Não há vendas novas para fechar.' }

  const admin = createAdminClient()
  const diff = parseFloat((countedCash - caixa.totals.cash).toFixed(2))

  const { error } = await admin.from('cash_closings').insert({
    store_id:        storeId,
    user_id:         user.id,
    closing_date:    date,
    period_start:    caixa.lastClosing?.at ?? null,
    total_credit:    caixa.totals.credit,
    total_debit:     caixa.totals.debit,
    total_pix:       caixa.totals.pix,
    total_cash:      caixa.totals.cash,
    total_sales:     caixa.totalSales,
    sales_count:     caixa.salesCount,
    counted_cash:    countedCash,
    cash_difference: diff,
    notes:           notes || null,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath('/pdv')
  return { success: true }
}
