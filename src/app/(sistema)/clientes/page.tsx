import { redirect } from 'next/navigation'
import { requireProfile, ehOperadora, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import ClientesClient from './ClientesClient'
import PageHeader from '@/components/ui/PageHeader'

/** Vendas sem cliente vinculado — parte do faturamento, fora da divisão por cliente. */
export interface VendaAvulsa {
  quantidade: number
  total: number
}

export interface CustomerWithStats {
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

export interface StoreOption {
  id: string
  name: string
}

export default async function ClientesPage() {
  const profile = await requireProfile()
  /* Trava própria: o layout é a rede geral, mas ela depende de um cabeçalho.
   * Aqui não depende de nada. Ver src/app/(sistema)/layout.tsx. */
  if (ehOperadora(profile)) redirect('/pdv')

  const admin = createAdminClient()

  /*
   * Cliente virou coisa da LOJA em 04/09, por decisão do dono.
   *
   * Reverte o que estava documentado em 01/09 ("cliente é da rede, a mesma
   * pessoa compra nas duas"). O custo foi aceito na hora: cliente de Brasília
   * que comprar em Campinas não aparece para a Rosi, que a cadastra de novo.
   * São 2.838 clientes em Brasília e 444 em Campinas.
   *
   * As VENDAS precisam do mesmo corte, senão o painel de faturamento desta tela
   * somaria as vendas da outra loja e ninguém entenderia o total.
   */
  const escopo = lojaDoEscopo(profile)

  const carregarClientes = () => {
    let q = admin.from('customers').select('*, stores(name)')
    if (escopo) q = q.eq('origin_store_id', escopo)
    return q.order('name')
  }

  const carregarVendas = () => {
    // Traz TAMBÉM as vendas sem cliente vinculado: elas fazem parte do
    // faturamento e o painel precisa mostrá-las, senão o total não bate com o
    // financeiro e a diferença parece erro de cálculo.
    let q = admin.from('sales').select('customer_id, sale_date, total').neq('status', 'cancelled')
    if (escopo) q = q.eq('store_id', escopo)
    return q
  }

  const carregarLojas = () => {
    let q = admin.from('stores').select('id, name').eq('is_active', true)
    if (escopo) q = q.eq('id', escopo)
    return q.order('name')
  }

  const [customersRes, storesRes, salesRes, settingRes] = await Promise.all([
    carregarClientes(),
    carregarLojas(),
    carregarVendas(),
    admin.from('settings').select('value').eq('key', 'inactive_customer_days').maybeSingle(),
  ])

  const customers   = customersRes.data ?? []
  const stores: StoreOption[] = storesRes.data ?? []
  const sales       = salesRes.data ?? []
  const inactiveDays = Number(settingRes.data?.value ?? 180)

  // Venda sem cliente vinculado — o que o painel de faturamento precisa somar à
  // parte para chegar ao faturamento real.
  const avulsas = sales.filter(s => !s.customer_id)
  const vendaAvulsa = {
    quantidade: avulsas.length,
    total: avulsas.reduce((soma, s) => soma + Number(s.total ?? 0), 0),
  }

  // Build per-customer sales stats
  const statsMap = new Map<string, { count: number; last: string; total: number }>()
  for (const s of sales) {
    if (!s.customer_id) continue
    const existing = statsMap.get(s.customer_id)
    const dateStr  = s.sale_date as string
    if (!existing) {
      statsMap.set(s.customer_id, { count: 1, last: dateStr, total: Number(s.total) })
    } else {
      existing.count++
      existing.total += Number(s.total)
      if (dateStr > existing.last) existing.last = dateStr
    }
  }

  const customersWithStats: CustomerWithStats[] = customers.map(c => {
    const stats = statsMap.get(c.id)
    return {
      id:                c.id,
      name:              c.name,
      phone:             c.phone,
      cpf:               c.cpf,
      email:             c.email,
      birthday:          c.birthday,
      address:           c.address,
      city:              c.city,
      state:             c.state,
      zip_code:          c.zip_code,
      origin_store_id:   c.origin_store_id,
      origin_store_name: (c.stores as { name: string } | null)?.name ?? '—',
      notes:             c.notes,
      created_at:        c.created_at,
      updated_at:        c.updated_at,
      total_sales:       stats?.count ?? 0,
      last_sale_date:    stats?.last   ?? null,
      total_spent:       stats?.total  ?? 0,
    }
  })

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Gerencie a base de clientes e acompanhe o histórico de compras."
      />
      <ClientesClient
        customers={customersWithStats}
        vendaAvulsa={vendaAvulsa}
        stores={stores}
        inactiveDays={inactiveDays}
        currentUserRole={profile?.role ?? 'operator'}
        currentUserStoreId={profile?.store_id ?? null}
      />
    </div>
  )
}
