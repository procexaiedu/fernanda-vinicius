import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import FornecedoresClient from './FornecedoresClient'

export interface SupplierPhone {
  number: string
  is_whatsapp: boolean
}

export interface SupplierWithCount {
  id: string
  name: string
  initials: string
  contact_name: string | null
  phones: SupplierPhone[]
  instagram: string | null
  email: string | null
  cnpj: string | null
  accepts_consignment: boolean
  address: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  product_count: number
  last_purchase_date: string | null
  total_invested: number
  pending_amount: number
}

export default async function FornecedoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  const [suppliersRes, productCountsRes, purchaseItemsRes, purchasesRes] = await Promise.all([
    admin.from('suppliers').select('*').order('name'),
    admin.from('products').select('supplier_id').eq('is_active', true),
    // Join purchase_items → products para obter supplier_id e purchase_date por item
    admin.from('purchase_items').select('purchase_id, unit_cost, quantity, products(supplier_id), purchases(purchase_date)'),
    admin.from('purchases').select('id, purchase_date'),
  ])

  const suppliers     = suppliersRes.data ?? []
  const products      = productCountsRes.data ?? []
  const purchaseItems = (purchaseItemsRes.data ?? []) as unknown as Array<{
    purchase_id: string
    unit_cost: number
    quantity: number
    products: { supplier_id: string } | null
    purchases: { purchase_date: string } | null
  }>
  const purchases     = purchasesRes.data ?? []

  // Pending payments via purchase IDs
  const purchaseIds = purchases.map(p => p.id)
  const pendingRes = purchaseIds.length > 0
    ? await admin
        .from('purchase_payments')
        .select('purchase_id, amount')
        .eq('status', 'pending')
        .in('purchase_id', purchaseIds)
    : { data: [] }
  const pendingPayments = pendingRes.data ?? []

  // Build lookup maps via purchase_items (supplier_id está no produto, não na compra)
  const countMap         = new Map<string, number>()
  const lastPurchaseMap  = new Map<string, string>()
  const totalInvestedMap = new Map<string, number>()

  for (const p of products) {
    if (p.supplier_id) countMap.set(p.supplier_id, (countMap.get(p.supplier_id) ?? 0) + 1)
  }

  // purchase_items → supplier via products
  const purchaseSupplierMap = new Map<string, Set<string>>() // purchase_id → set of supplier_ids
  for (const item of purchaseItems) {
    const sid  = item.products?.supplier_id
    const date = item.purchases?.purchase_date
    if (!sid) continue

    // Last purchase date
    const existing = lastPurchaseMap.get(sid)
    if (date && (!existing || date > existing)) lastPurchaseMap.set(sid, date)

    // Total invested (unit_cost × quantity)
    totalInvestedMap.set(sid, (totalInvestedMap.get(sid) ?? 0) + (item.unit_cost * item.quantity))

    // Map purchase_id → suppliers for pending calc
    if (!purchaseSupplierMap.has(item.purchase_id)) purchaseSupplierMap.set(item.purchase_id, new Set())
    purchaseSupplierMap.get(item.purchase_id)!.add(sid)
  }

  // Pending por fornecedor: distribuir proporcionalmente entre fornecedores da compra
  const pendingMap = new Map<string, number>()
  for (const pp of pendingPayments) {
    const sids = purchaseSupplierMap.get(pp.purchase_id)
    if (!sids || sids.size === 0) continue
    const share = Number(pp.amount) / sids.size
    for (const sid of sids) {
      pendingMap.set(sid, (pendingMap.get(sid) ?? 0) + share)
    }
  }

  const suppliersWithCount: SupplierWithCount[] = suppliers.map((s) => ({
    ...s,
    product_count:      countMap.get(s.id) ?? 0,
    last_purchase_date: lastPurchaseMap.get(s.id) ?? null,
    total_invested:     totalInvestedMap.get(s.id) ?? 0,
    pending_amount:     pendingMap.get(s.id) ?? 0,
  }))

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Fornecedores
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Gerencie os fornecedores cadastrados e acompanhe o investimento por fornecedor.
        </p>
      </div>
      <FornecedoresClient suppliers={suppliersWithCount} />
    </div>
  )
}
