import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ClientesClient from './ClientesClient'

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const [profileRes, customersRes, storesRes, salesRes, settingRes] = await Promise.all([
    supabase.from('users').select('role, store_id').eq('id', user.id).single(),
    admin.from('customers').select('*, stores(name)').order('name'),
    admin.from('stores').select('id, name').eq('is_active', true).order('name'),
    admin.from('sales').select('customer_id, sale_date, total').not('customer_id', 'is', null),
    admin.from('settings').select('value').eq('key', 'inactive_customer_days').maybeSingle(),
  ])

  const profile     = profileRes.data
  const customers   = customersRes.data ?? []
  const stores: StoreOption[] = storesRes.data ?? []
  const sales       = salesRes.data ?? []
  const inactiveDays = Number(settingRes.data?.value ?? 180)

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
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Clientes
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Gerencie a base de clientes e acompanhe o histórico de compras.
        </p>
      </div>
      <ClientesClient
        customers={customersWithStats}
        stores={stores}
        inactiveDays={inactiveDays}
        currentUserRole={profile?.role ?? 'operator'}
        currentUserStoreId={profile?.store_id ?? null}
      />
    </div>
  )
}
