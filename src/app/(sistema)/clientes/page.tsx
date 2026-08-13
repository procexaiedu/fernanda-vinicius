import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import ClientesClient from './ClientesClient'

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

  const admin = createAdminClient()

  const [customersRes, storesRes, salesRes, settingRes] = await Promise.all([
    admin.from('customers').select('*, stores(name)').order('name'),
    admin.from('stores').select('id, name').eq('is_active', true).order('name'),
    // Traz TAMBÉM as vendas sem cliente vinculado: elas fazem parte do
    // faturamento e o painel precisa mostrá-las, senão o total não bate com o
    // financeiro e a diferença parece erro de cálculo.
    admin.from('sales').select('customer_id, sale_date, total').neq('status', 'cancelled'),
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
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 'var(--fs-page-title)', letterSpacing: 'var(--tracking-title)', lineHeight: 1.15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Clientes
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Gerencie a base de clientes e acompanhe o histórico de compras.
        </p>
      </div>
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
