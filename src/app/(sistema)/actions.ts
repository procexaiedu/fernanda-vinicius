'use server'

import { createAdminClient } from '@/lib/supabase/admin'

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface StoreOption {
  id: string
  name: string
}

export interface DashboardSettings {
  purchaseReservePct: number
  staleDays: number
}

export interface DashboardKpis {
  receitaBruta: number
  cmv: number
  lucroBruto: number
  despesasOp: number
  lucroLiquido: number
  disponivelCompra: number
  reservePct: number
}

export interface DashboardStock {
  totalPecas: number
  totalSkus: number
  valorEstoque: number
  pecasParadas: number
  staleDays: number
}

export interface MonthChartData {
  label: string       // "Jan/25"
  year: number
  monthNum: number
  faturamento: number
  custoCompras: number
  lucroBruto: number
  lucroLiquido: number
}

export interface TopProduto {
  id: string
  name: string
  code: string
  category: string
  material: string
  supplier_id: string
  store_id: string
  cost_price: number
  sale_price: number
  promotional_price: number | null
  quantity_in_stock: number
  ownership_type: 'own' | 'consignment'
  last_sale_date: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  suppliers: { id: string; name: string; initials: string } | null
  stores: { id: string; name: string } | null
  qtdVendida: number
  receita: number
}

export interface TopCliente {
  id: string
  name: string
  phone: string
  cpf: string | null
  email: string | null
  birthday: string | null
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  origin_store_id: string
  origin_store_name: string
  notes: string | null
  created_at: string
  updated_at: string
  total_sales: number
  last_sale_date: string | null
  total_spent: number
}

export interface TopVendedora {
  id: string
  name: string
  store_id: string | null
  store_name: string | null
  nrVendas: number
  totalVendido: number
}

export interface AlertPecaParada {
  id: string
  name: string
  code: string
  category: string
  material: string
  supplier_id: string
  store_id: string
  cost_price: number
  sale_price: number
  promotional_price: number | null
  quantity_in_stock: number
  ownership_type: 'own' | 'consignment'
  last_sale_date: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  suppliers: { id: string; name: string; initials: string } | null
  stores: { id: string; name: string } | null
  diasParada: number
}

export interface AlertConta {
  id: string
  description: string
  amount: number
  due_date: string
  category: string
  reference_type: string
  store_name: string | null
}

export interface AlertAniversariante {
  id: string
  name: string
  phone: string
  birthday: string
  last_sale_date: string | null
  origin_store_name: string
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

const MONTHS_PT_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function monthBounds(year: number, month: number) {
  const dateFrom = `${year}-${String(month).padStart(2,'0')}-01`
  const lastDay  = new Date(year, month, 0).getDate()
  const dateTo   = `${year}-${String(month).padStart(2,'0')}-${lastDay}`
  return { dateFrom, dateTo }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function buscarDashboardSettings(): Promise<DashboardSettings> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('settings')
    .select('key, value')
    .in('key', ['purchase_reserve_pct', 'stale_product_days'])

  const map: Record<string, number> = {}
  for (const row of data ?? []) map[row.key] = Number(row.value)

  return {
    purchaseReservePct: map['purchase_reserve_pct'] ?? 30,
    staleDays: map['stale_product_days'] ?? 60,
  }
}

// ─── Stores ───────────────────────────────────────────────────────────────────

export async function buscarLojas(): Promise<StoreOption[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('stores')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  return (data ?? []) as StoreOption[]
}

// ─── KPIs Financeiros ─────────────────────────────────────────────────────────

export async function buscarKpis(
  storeId: string | null,
  month: number,
  year: number,
  reservePct: number,
): Promise<DashboardKpis> {
  const admin = createAdminClient()
  const { dateFrom, dateTo } = monthBounds(year, month)

  let txQ = admin
    .from('transactions')
    .select('type, amount')
    .eq('status', 'completed')
    .gte('transaction_date', dateFrom)
    .lte('transaction_date', dateTo)
  if (storeId) txQ = txQ.eq('store_id', storeId)

  let salesQ = admin
    .from('sales')
    .select('total_cost')
    .neq('status', 'cancelled')
    .gte('sale_date', dateFrom)
    .lte('sale_date', dateTo)
  if (storeId) salesQ = salesQ.eq('store_id', storeId)

  const [txRes, salesRes] = await Promise.all([txQ, salesQ])

  const txRows = txRes.data ?? []
  const receitaBruta = txRows.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const despesasOp   = txRows.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const cmv          = (salesRes.data ?? []).reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0)
  const lucroBruto   = receitaBruta - cmv
  const lucroLiquido = lucroBruto - despesasOp
  const disponivelCompra = lucroLiquido * (1 - reservePct / 100)

  return { receitaBruta, cmv, lucroBruto, despesasOp, lucroLiquido, disponivelCompra, reservePct }
}

// ─── Estoque ──────────────────────────────────────────────────────────────────

export async function buscarEstoque(
  storeId: string | null,
  staleDays: number,
): Promise<DashboardStock> {
  const admin = createAdminClient()
  const staleDate = new Date()
  staleDate.setDate(staleDate.getDate() - staleDays)
  const staleDateStr = staleDate.toISOString().slice(0, 10)

  let q = admin
    .from('products')
    .select('id, quantity_in_stock, cost_price, last_sale_date, created_at')
    .eq('is_active', true)
    .gt('quantity_in_stock', 0)
  if (storeId) q = q.eq('store_id', storeId)

  const { data } = await q
  const rows = data ?? []

  const totalPecas    = rows.reduce((s, r) => s + Number(r.quantity_in_stock), 0)
  const totalSkus     = rows.length
  const valorEstoque  = rows.reduce((s, r) => s + Number(r.cost_price) * Number(r.quantity_in_stock), 0)
  const pecasParadas  = rows.filter(r => {
    const ref = r.last_sale_date
      ? r.last_sale_date.slice(0, 10)
      : r.created_at.slice(0, 10)
    return ref < staleDateStr
  }).length

  return { totalPecas, totalSkus, valorEstoque, pecasParadas, staleDays }
}

// ─── Gráfico mensal ───────────────────────────────────────────────────────────

export async function buscarGrafico(
  storeId: string | null,
  meses: number,
): Promise<MonthChartData[]> {
  const admin = createAdminClient()

  // Calcula intervalo: de (hoje - meses + 1) até fim do mês atual
  const now = new Date()
  const endYear  = now.getFullYear()
  const endMonth = now.getMonth() + 1 // 1-12
  const startDate = new Date(endYear, endMonth - meses, 1)
  const dateFrom  = startDate.toISOString().slice(0, 10)
  const lastDay   = new Date(endYear, endMonth, 0).getDate()
  const dateTo    = `${endYear}-${String(endMonth).padStart(2,'0')}-${lastDay}`

  let txQ = admin
    .from('transactions')
    .select('type, amount, category, transaction_date')
    .eq('status', 'completed')
    .gte('transaction_date', dateFrom)
    .lte('transaction_date', dateTo)
  if (storeId) txQ = txQ.eq('store_id', storeId)

  let salesQ = admin
    .from('sales')
    .select('total_cost, sale_date')
    .neq('status', 'cancelled')
    .gte('sale_date', dateFrom)
    .lte('sale_date', dateTo)
  if (storeId) salesQ = salesQ.eq('store_id', storeId)

  const [txRes, salesRes] = await Promise.all([txQ, salesQ])

  // Monta mapa por "YYYY-MM"
  type MonthMap = { income: number; expenseAll: number; custoCompras: number; cmv: number }
  const map = new Map<string, MonthMap>()

  for (let i = 0; i < meses; i++) {
    const d = new Date(endYear, endMonth - 1 - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`
    map.set(key, { income: 0, expenseAll: 0, custoCompras: 0, cmv: 0 })
  }

  for (const t of txRes.data ?? []) {
    const key = (t.transaction_date as string).slice(0, 7)
    const entry = map.get(key)
    if (!entry) continue
    if (t.type === 'income') entry.income += Number(t.amount)
    if (t.type === 'expense') {
      entry.expenseAll += Number(t.amount)
      if (t.category === 'compra_fornecedor') entry.custoCompras += Number(t.amount)
    }
  }

  for (const s of salesRes.data ?? []) {
    const key = (s.sale_date as string).slice(0, 7)
    const entry = map.get(key)
    if (!entry) continue
    entry.cmv += Number(s.total_cost ?? 0)
  }

  // Gera array cronológico
  const result: MonthChartData[] = []
  const keys = Array.from(map.keys()).sort()
  for (const key of keys) {
    const [y, m] = key.split('-').map(Number)
    const e = map.get(key)!
    const lucroBruto   = e.income - e.cmv
    const lucroLiquido = lucroBruto - e.expenseAll
    result.push({
      label:       `${MONTHS_PT_SHORT[m - 1]}/${String(y).slice(2)}`,
      year:        y,
      monthNum:    m,
      faturamento: e.income,
      custoCompras: e.custoCompras,
      lucroBruto,
      lucroLiquido,
    })
  }

  return result
}

// ─── Rankings ─────────────────────────────────────────────────────────────────

export async function buscarTopProdutos(
  storeId: string | null,
  month: number,
  year: number,
): Promise<TopProduto[]> {
  const admin = createAdminClient()
  const { dateFrom, dateTo } = monthBounds(year, month)

  // sale_items no período → agrupa por product_id
  let siQ = admin
    .from('sale_items')
    .select('product_id, quantity, subtotal, sales!inner(sale_date, store_id, status)')
    .gte('sales.sale_date', dateFrom)
    .lte('sales.sale_date', dateTo)
    .neq('sales.status', 'cancelled')
  if (storeId) siQ = siQ.eq('sales.store_id', storeId)

  const { data: siRows } = await siQ

  if (!siRows?.length) return []

  // Agrega
  const agg = new Map<string, { qtd: number; receita: number }>()
  for (const r of siRows) {
    const pid = r.product_id as string
    const cur = agg.get(pid) ?? { qtd: 0, receita: 0 }
    cur.qtd     += Number(r.quantity)
    cur.receita += Number(r.subtotal)
    agg.set(pid, cur)
  }

  const top10 = Array.from(agg.entries())
    .sort((a, b) => b[1].qtd - a[1].qtd)
    .slice(0, 10)
    .map(([id]) => id)

  const { data: produtos } = await admin
    .from('products')
    .select('id, code, name, category, material, supplier_id, store_id, cost_price, sale_price, promotional_price, quantity_in_stock, ownership_type, last_sale_date, photo_url, is_active, created_at, suppliers(id, name, initials), stores(id, name)')
    .in('id', top10)

  return (produtos ?? []).map((p: any) => ({
    ...p,
    suppliers: p.suppliers ?? null,
    stores:    p.stores ?? null,
    qtdVendida: agg.get(p.id)?.qtd     ?? 0,
    receita:    agg.get(p.id)?.receita ?? 0,
  })).sort((a: TopProduto, b: TopProduto) => b.qtdVendida - a.qtdVendida)
}

export async function buscarTopClientes(storeId: string | null): Promise<TopCliente[]> {
  const admin = createAdminClient()

  let salesQ = admin
    .from('sales')
    .select('customer_id, total, sale_date')
    .neq('status', 'cancelled')
    .not('customer_id', 'is', null)
  if (storeId) salesQ = salesQ.eq('store_id', storeId)

  const { data: salesRows } = await salesQ
  if (!salesRows?.length) return []

  const statsMap = new Map<string, { count: number; total: number; last: string }>()
  for (const s of salesRows) {
    const cid = s.customer_id as string
    const cur = statsMap.get(cid) ?? { count: 0, total: 0, last: '' }
    cur.count++
    cur.total += Number(s.total)
    const d = (s.sale_date as string).slice(0, 10)
    if (!cur.last || d > cur.last) cur.last = d
    statsMap.set(cid, cur)
  }

  const top10ids = Array.from(statsMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([id]) => id)

  const { data: clientes } = await admin
    .from('customers')
    .select('id, name, phone, cpf, email, birthday, address, city, state, zip_code, origin_store_id, notes, created_at, updated_at, stores(name)')
    .in('id', top10ids)

  return (clientes ?? []).map((c: any) => {
    const stats = statsMap.get(c.id)!
    return {
      id:               c.id,
      name:             c.name,
      phone:            c.phone,
      cpf:              c.cpf,
      email:            c.email,
      birthday:         c.birthday,
      address:          c.address,
      city:             c.city,
      state:            c.state,
      zip_code:         c.zip_code,
      origin_store_id:  c.origin_store_id,
      origin_store_name:(c.stores as { name: string } | null)?.name ?? '—',
      notes:            c.notes,
      created_at:       c.created_at,
      updated_at:       c.updated_at,
      total_sales:      stats.count,
      last_sale_date:   stats.last || null,
      total_spent:      stats.total,
    }
  }).sort((a, b) => b.total_sales - a.total_sales)
}

export async function buscarTopVendedoras(
  storeId: string | null,
  month: number,
  year: number,
): Promise<TopVendedora[]> {
  const admin = createAdminClient()
  const { dateFrom, dateTo } = monthBounds(year, month)

  let q = admin
    .from('sales')
    .select('user_id, total, users(full_name, store_id, stores(name))')
    .neq('status', 'cancelled')
    .gte('sale_date', dateFrom)
    .lte('sale_date', dateTo)
  if (storeId) q = q.eq('store_id', storeId)

  const { data } = await q
  if (!data?.length) return []

  const map = new Map<string, { name: string; store_id: string | null; store_name: string | null; count: number; total: number }>()
  for (const s of data) {
    const uid  = s.user_id as string
    const user = s.users as any
    const cur  = map.get(uid) ?? {
      name:       user?.full_name ?? uid,
      store_id:   user?.store_id  ?? null,
      store_name: (user?.stores as { name: string } | null)?.name ?? null,
      count: 0, total: 0,
    }
    cur.count++
    cur.total += Number(s.total)
    map.set(uid, cur)
  }

  return Array.from(map.entries())
    .map(([id, v]) => ({ id, name: v.name, store_id: v.store_id, store_name: v.store_name, nrVendas: v.count, totalVendido: v.total }))
    .sort((a, b) => b.totalVendido - a.totalVendido)
}

// ─── Alertas ──────────────────────────────────────────────────────────────────

export async function buscarPecasParadas(
  storeId: string | null,
  staleDays: number,
): Promise<AlertPecaParada[]> {
  const admin = createAdminClient()
  const staleDate = new Date()
  staleDate.setDate(staleDate.getDate() - staleDays)
  const staleDateStr = staleDate.toISOString().slice(0, 10)

  let q = admin
    .from('products')
    .select('id, code, name, category, material, supplier_id, store_id, cost_price, sale_price, promotional_price, quantity_in_stock, ownership_type, last_sale_date, photo_url, is_active, created_at, suppliers(id, name, initials), stores(id, name)')
    .eq('is_active', true)
    .gt('quantity_in_stock', 0)
  if (storeId) q = q.eq('store_id', storeId)

  const { data } = await q
  const today = new Date().toISOString().slice(0, 10)

  return (data ?? [])
    .filter((r: any) => {
      const ref = r.last_sale_date ? r.last_sale_date.slice(0, 10) : r.created_at.slice(0, 10)
      return ref < staleDateStr
    })
    .map((r: any) => {
      const ref = r.last_sale_date ? r.last_sale_date.slice(0, 10) : r.created_at.slice(0, 10)
      const diasParada = Math.floor((new Date(today).getTime() - new Date(ref).getTime()) / 86400000)
      return { ...r, suppliers: r.suppliers ?? null, stores: r.stores ?? null, diasParada }
    })
    .sort((a: AlertPecaParada, b: AlertPecaParada) => b.diasParada - a.diasParada)
    .slice(0, 8)
}

export async function buscarContasVencer(storeId: string | null): Promise<AlertConta[]> {
  const admin = createAdminClient()
  const today   = new Date().toISOString().slice(0, 10)
  const in15    = new Date(); in15.setDate(in15.getDate() + 15)
  const dateTo  = in15.toISOString().slice(0, 10)

  let q = admin
    .from('transactions')
    .select('id, description, amount, due_date, category, reference_type, store_id, stores(name)')
    .eq('type', 'expense')
    .eq('status', 'pending')
    .gte('due_date', today)
    .lte('due_date', dateTo)
    .order('due_date', { ascending: true })
  if (storeId) q = q.eq('store_id', storeId)

  const { data } = await q
  return (data ?? []).map((t: any) => ({
    id:             t.id,
    description:    t.description,
    amount:         Number(t.amount),
    due_date:       t.due_date,
    category:       t.category,
    reference_type: t.reference_type,
    store_name:     (t.stores as { name: string } | null)?.name ?? null,
  }))
}

export async function buscarAniversariantes(storeId: string | null): Promise<AlertAniversariante[]> {
  const admin = createAdminClient()
  const currentMonth = new Date().getMonth() + 1

  // Supabase não tem EXTRACT direto em .filter, então buscamos todos e filtramos
  let q = admin
    .from('customers')
    .select('id, name, phone, birthday, stores!customers_origin_store_id_fkey(name)')
    .not('birthday', 'is', null)
  if (storeId) q = q.eq('origin_store_id', storeId)

  const { data } = await q

  // Filtrar pelo mês do aniversário
  const aniversariantes = (data ?? []).filter((c: any) => {
    const b = c.birthday as string
    return parseInt(b.split('-')[1]) === currentMonth
  })

  // Busca última venda de cada
  const ids = aniversariantes.map((c: any) => c.id)
  let lastSaleMap: Map<string, string> = new Map()
  if (ids.length > 0) {
    const { data: sales } = await admin
      .from('sales')
      .select('customer_id, sale_date')
      .in('customer_id', ids)
      .neq('status', 'cancelled')
      .order('sale_date', { ascending: false })
    for (const s of sales ?? []) {
      if (!lastSaleMap.has(s.customer_id as string)) {
        lastSaleMap.set(s.customer_id as string, (s.sale_date as string).slice(0, 10))
      }
    }
  }

  return aniversariantes.map((c: any) => ({
    id:               c.id,
    name:             c.name,
    phone:            c.phone,
    birthday:         c.birthday,
    last_sale_date:   lastSaleMap.get(c.id) ?? null,
    origin_store_name:(c.stores as { name: string } | null)?.name ?? '—',
  }))
}
