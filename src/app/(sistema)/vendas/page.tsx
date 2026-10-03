import { ehAdminGlobal, podeFiltrarPorLoja, requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { emLotes } from '@/lib/supabase/em-lotes'
import { faltaPagar, resumirVendas } from '@/lib/vendas/lista'
import VendasClient from './VendasClient'
import MinhaMetaCard from './MinhaMetaCard'
import { getUserProgress } from '@/lib/metas/server'
import { currentMonthKey, monthLabel, type MetaProgress } from '@/lib/metas/compute'

/** Fechamento de caixa — usado como filtro na tela de Vendas. */
export interface ClosingOption {
  id: string
  closing_date: string
  created_at: string
  period_start: string | null
  store_id: string
  store_name: string
  user_name: string
  sales_count: number
  total_sales: number
  counted_cash: number | null
  cash_difference: number | null
}

export interface SaleRow {
  id: string
  sale_date: string
  created_at: string
  customer_name: string | null
  customer_id: string | null
  store_name: string
  store_id: string
  seller_name: string | null
  seller_id: string | null
  items_count: number
  subtotal: number
  discount_pct: number
  discount_amount: number
  total: number
  payment_summary: string | null
  status: string
  has_exchange: boolean
  /*
   * Saldo em aberto: total menos o que entrou em `sale_payments`.
   *
   * DERIVADO, nunca guardado. `sale_payments` é quem sabe quanto foi pago; uma
   * coluna espelho em `sales` seria um segundo número contando a mesma coisa,
   * e um dia os dois discordariam.
   */
  valor_pago: number
  falta_pagar: number
  previsao_pagamento: string | null
}

export default async function VendasPage() {
  const profile = await requireProfile()

  const admin = createAdminClient()

  // Buscar vendas com joins
  let salesQuery = admin
    .from('sales')
    .select(`
      id, sale_date, created_at, subtotal, discount_pct, discount_amount, total,
      payment_summary, status, store_id, seller_id, previsao_pagamento,
      customers(name, id),
      stores(name)
    `)
    .order('sale_date', { ascending: false })
    .limit(200)

  /* Quem tem loja está preso a ela — admin de loja inclusive, não só operadora. */
  if (profile.store_id) {
    salesQuery = salesQuery.eq('store_id', profile.store_id)
  }

  /*
   * Operadora vê só as vendas de HOJE.
   *
   * Não é sigilo — é o que ela precisa. O papel dela é atender e fechar o
   * caixa do dia; histórico de meses é conversa de gestão. E limitar aqui, no
   * servidor, é o que impede que mudar o filtro na tela revele o resto.
   */
  if (profile.role === 'operator') {
    const hoje = new Date().toISOString().slice(0, 10)
    salesQuery = salesQuery.gte('sale_date', hoje).lte('sale_date', hoje)
  }

  // Fechamentos de caixa (para o filtro) — operadora vê os da própria loja
  let closingsQuery = admin
    .from('cash_closings')
    .select('id, closing_date, created_at, period_start, store_id, user_id, sales_count, total_sales, counted_cash, cash_difference')
    .order('created_at', { ascending: false })
    .limit(60)
  if (profile.store_id) {
    closingsQuery = closingsQuery.eq('store_id', profile.store_id)
  }

  // Lote 1 — vendas + listas de filtro (lojas/vendedoras/fechamentos não dependem das vendas)
  const [salesRes, storesRes, usersRes, closingsRes] = await Promise.all([
    salesQuery,
    /* Os filtros seguem o mesmo corte das vendas logo acima. Sem isto a tela
       oferece "vendedora: Rayane" para quem só tem venda de Campinas — filtro
       que nunca devolve nada e parece defeito. */
    (() => {
      let q = admin.from('stores').select('id, name').eq('is_active', true)
      if (profile.store_id) q = q.eq('id', profile.store_id)
      return q.order('name')
    })(),
    (() => {
      let q = admin.from('users').select('id, full_name').eq('is_active', true)
      if (profile.store_id) q = q.eq('store_id', profile.store_id)
      return q.order('full_name')
    })(),
    closingsQuery,
  ])

  /*
   * Falha aqui LANÇA (cai na tela de erro de (sistema)). Era `data ?? []`: a
   * busca de trocas levava 414 e a lista seguia mostrando "Falta R$324,00"
   * numa venda paga, sem nenhum erro na tela.
   */
  for (const [rotulo, res] of [
    ['as vendas', salesRes], ['as lojas', storesRes], ['as vendedoras', usersRes], ['os fechamentos de caixa', closingsRes],
  ] as const) {
    if (res.error) {
      console.error(`[vendas] falha ao carregar ${rotulo}:`, res.error)
      throw new Error(`Não foi possível carregar ${rotulo}: ${res.error.message}`)
    }
  }

  const rawSales = salesRes.data ?? []
  const saleIds: string[] = rawSales.map((s: any) => s.id)
  const sellerIds = [...new Set(rawSales.map((s: any) => s.seller_id).filter(Boolean))] as string[]

  /*
   * Lote 2 — tudo que depende dos ids das vendas, também em paralelo.
   *
   * Sempre em lotes de 100 ids (emLotes): a lista inteira num `.in()` passa de
   * ~8 KB de URL perto de 200 vendas e o Kong responde 414. As trocas saem em
   * duas consultas (venda nova e venda original) em vez de um `.or()` que
   * repetia a lista de ids duas vezes na mesma URL.
   */
  const [itens, trocasDaVendaNova, trocasDaOriginal, vendedoras, pagamentos] = await Promise.all([
    emLotes(saleIds, lote => admin.from('sale_items').select('sale_id').in('sale_id', lote), 'os itens das vendas'),
    emLotes(saleIds, lote => admin.from('exchanges').select('id, sale_id, original_sale_id').in('sale_id', lote), 'as trocas'),
    emLotes(saleIds, lote => admin.from('exchanges').select('id, sale_id, original_sale_id').in('original_sale_id', lote), 'as trocas'),
    emLotes(sellerIds, lote => admin.from('users').select('id, full_name').in('id', lote), 'as vendedoras'),
    emLotes(saleIds, lote => admin.from('sale_payments').select('sale_id, amount').in('sale_id', lote), 'os pagamentos'),
  ])

  const trocas = [...new Map([...trocasDaVendaNova, ...trocasDaOriginal].map(t => [t.id, t])).values()]
  const devolvidos = await emLotes(
    trocas.map(t => t.id),
    lote => admin.from('exchange_items').select('exchange_id, quantity, unit_price').in('exchange_id', lote).eq('direction', 'returned'),
    'as peças devolvidas nas trocas',
  )

  /* Quanto entrou por venda: `sale_payments` + peça devolvida na troca. Nunca de uma coluna em `sales`. */
  const resumo = resumirVendas({ itens, pagamentos, trocas, devolvidos })

  const sellersMap = new Map<string, string>()
  for (const u of vendedoras) sellersMap.set(u.id, u.full_name)

  const sales: SaleRow[] = rawSales.map((s: any) => ({
    id:              s.id,
    sale_date:       s.sale_date,
    created_at:      s.created_at,
    customer_name:   s.customers?.name ?? null,
    customer_id:     s.customers?.id ?? null,
    store_name:      s.stores?.name ?? '—',
    store_id:        s.store_id,
    seller_name:     s.seller_id ? (sellersMap.get(s.seller_id) ?? null) : null,
    seller_id:       s.seller_id ?? null,
    items_count:     resumo.get(s.id)?.itens ?? 0,
    subtotal:        Number(s.subtotal),
    discount_pct:    Number(s.discount_pct),
    discount_amount: Number(s.discount_amount),
    total:           Number(s.total),
    payment_summary: s.payment_summary,
    status:          s.status,
    has_exchange:    resumo.get(s.id)?.temTroca ?? false,
    valor_pago:      (resumo.get(s.id)?.pago ?? 0) + (resumo.get(s.id)?.creditoTroca ?? 0),
    falta_pagar:     faltaPagar(Number(s.total), resumo.get(s.id)),
    previsao_pagamento: s.previsao_pagamento ?? null,
  }))

  const stores = storesRes.data ?? []
  const sellers = usersRes.data ?? []

  const storeNameById = new Map((stores as any[]).map(s => [s.id, s.name]))
  const userNameById  = new Map((sellers as any[]).map(u => [u.id, u.full_name]))

  const closings: ClosingOption[] = ((closingsRes.data ?? []) as any[]).map(c => ({
    id:              c.id,
    closing_date:    c.closing_date,
    created_at:      c.created_at,
    period_start:    c.period_start,
    store_id:        c.store_id,
    store_name:      storeNameById.get(c.store_id) ?? '—',
    user_name:       userNameById.get(c.user_id) ?? '—',
    sales_count:     c.sales_count ?? 0,
    total_sales:     Number(c.total_sales) || 0,
    counted_cash:    c.counted_cash != null ? Number(c.counted_cash) : null,
    cash_difference: c.cash_difference != null ? Number(c.cash_difference) : null,
  }))

  // Operadora vê a própria meta do mês
  const monthKey = currentMonthKey(new Date())
  let minhaMeta: MetaProgress | null = null
  if (profile.role === 'operator') {
    minhaMeta = await getUserProgress(profile.id, monthKey)
  }

  return (
    <div>
      {minhaMeta && <MinhaMetaCard progress={minhaMeta} monthLabel={monthLabel(monthKey)} />}
      <VendasClient sales={sales} stores={stores} sellers={sellers} closings={closings} userRole={profile.role} podeTrocarLoja={podeFiltrarPorLoja(profile)} />
    </div>
  )
}
