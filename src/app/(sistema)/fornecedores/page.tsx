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

  const [suppliersRes, productCountsRes, purchasesRes] = await Promise.all([
    admin.from('suppliers').select('*').order('name'),
    admin.from('products').select('supplier_id').eq('is_active', true),
    admin.from('purchases').select('id, supplier_id, purchase_date, total_cost'),
  ])

  const suppliers    = suppliersRes.data ?? []
  const products     = productCountsRes.data ?? []
  const purchases    = purchasesRes.data ?? []

  // Pending payments via purchase IDs
  const purchaseIds = purchases.map(p => p.id)
  const pendingRes = purchaseIds.length > 0
    ? await admin.from('purchase_payments').select('purchase_id, amount').eq('status', 'pending').in('purchase_id', purchaseIds)
    : { data: [] }
  const pendingPayments = pendingRes.data ?? []

  // Build lookup maps
  const countMap         = new Map<string, number>()
  const lastPurchaseMap  = new Map<string, string>()
  const totalInvestedMap = new Map<string, number>()

  for (const p of products) {
    countMap.set(p.supplier_id, (countMap.get(p.supplier_id) ?? 0) + 1)
  }

  for (const p of purchases) {
    const existing = lastPurchaseMap.get(p.supplier_id)
    if (!existing || p.purchase_date > existing) lastPurchaseMap.set(p.supplier_id, p.purchase_date)
    totalInvestedMap.set(p.supplier_id, (totalInvestedMap.get(p.supplier_id) ?? 0) + Number(p.total_cost))
  }

  // Map purchase_id → supplier_id for pending aggregation
  const purchaseSupplierMap = new Map<string, string>()
  for (const p of purchases) purchaseSupplierMap.set(p.id, p.supplier_id)

  const pendingMap = new Map<string, number>()
  for (const pp of pendingPayments) {
    const sid = purchaseSupplierMap.get(pp.purchase_id)
    if (sid) pendingMap.set(sid, (pendingMap.get(sid) ?? 0) + Number(pp.amount))
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
