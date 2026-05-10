import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ComprasClient from './ComprasClient'

export default async function ComprasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  const [purchasesRes, paymentsRes, consignmentsRes, storesRes] = await Promise.all([
    admin.from('purchases')
      .select('id, purchase_date, total_cost, total_items, nf_number, nf_url, notes, created_at')
      .order('purchase_date', { ascending: false }),
    admin.from('purchase_payments')
      .select('purchase_id, status, amount'),
    admin.from('consignments')
      .select('id, received_date, return_deadline, total_pieces, total_cost_value, status, supplier_id, store_id')
      .order('received_date', { ascending: false }),
    admin.from('stores').select('id, name, city'),
  ])

  const purchases    = purchasesRes.data ?? []
  const payments     = paymentsRes.data ?? []
  const consignments = consignmentsRes.data ?? []
  const stores       = storesRes.data ?? []

  // Fornecedores e lojas dos produtos de cada compra via purchase_items
  const purchaseItemsRes = await admin
    .from('purchase_items')
    .select('purchase_id, products(supplier_id, store_id, suppliers(name), stores(name))')
    .in('purchase_id', purchases.map(p => p.id).concat(['_']))

  const purchaseItems = (purchaseItemsRes.data ?? []) as unknown as Array<{
    purchase_id: string
    products: { suppliers: { name: string } | null; stores: { name: string } | null } | null
  }>

  const suppliersByPurchase = new Map<string, Set<string>>()
  const storesByPurchase    = new Map<string, Set<string>>()

  for (const item of purchaseItems) {
    const pid = item.purchase_id
    if (!suppliersByPurchase.has(pid)) suppliersByPurchase.set(pid, new Set())
    if (!storesByPurchase.has(pid))    storesByPurchase.set(pid, new Set())
    const sup   = item.products?.suppliers?.name
    const store = item.products?.stores?.name
    if (sup)   suppliersByPurchase.get(pid)!.add(sup)
    if (store) storesByPurchase.get(pid)!.add(store)
  }

  const paymentsByPurchase = new Map<string, typeof payments>()
  for (const pay of payments) {
    if (!paymentsByPurchase.has(pay.purchase_id)) paymentsByPurchase.set(pay.purchase_id, [])
    paymentsByPurchase.get(pay.purchase_id)!.push(pay)
  }

  const purchasesWithMeta = purchases.map(p => ({
    ...p,
    suppliers:     [...(suppliersByPurchase.get(p.id) ?? [])],
    storeNames:    [...(storesByPurchase.get(p.id) ?? [])],
    paymentStatus: (paymentsByPurchase.has(p.id)
      ? paymentsByPurchase.get(p.id)!.every(x => x.status === 'completed') ? 'paid' : 'pending'
      : 'pending') as 'paid' | 'pending',
    type: 'purchase' as const,
  }))

  const storeMap = new Map(stores.map(s => [s.id, s.name]))

  const consignmentsWithMeta = consignments.map(c => ({
    ...c,
    storeName: storeMap.get(c.store_id ?? '') ?? '—',
    type: 'consignment' as const,
  }))

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Compras</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Registro de entradas de estoque — compras próprias e consignações.
        </p>
      </div>
      <ComprasClient purchases={purchasesWithMeta} consignments={consignmentsWithMeta} />
    </div>
  )
}
