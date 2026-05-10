'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
  success: boolean
  error?: string
  purchaseId?: string
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface GridRow {
  productId: string | null              // null = produto novo
  productName: string
  productExistingCostDiffers: boolean   // true = duplicar produto existente
  supplierId: string | null             // null = fornecedor novo
  supplierName: string
  supplierInitials: string
  category: string
  material: string
  costPrice: number
  salePrice: number
  promoPrice: number | null
  labelFormat: 'A' | 'B'
  quantity: number
  storeId: string
}

export interface PaymentRow {
  method: 'cash' | 'pix' | 'transfer' | 'credit'
  totalAmount: number
  installments: number        // 1 para cash/pix/transfer
  firstDueDate: string        // YYYY-MM-DD
  status: 'completed' | 'pending'
}

export interface CompraFormData {
  purchaseDate: string        // YYYY-MM-DD
  nfNumber: string
  nfUrl: string
  notes: string
  rows: GridRow[]
  payments: PaymentRow[]
  isConsignment: boolean
  returnDeadline: string      // só se consignação
  minPurchasePct: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(initials: string, month: number, costPrice: number): string {
  const m = String(month).padStart(2, '0')
  const costCents = Math.round(costPrice * 100)
  return `F${initials.toUpperCase()}${m}${costCents}`
}

function installmentDate(firstDate: string, index: number): string {
  if (index === 0) return firstDate
  const d = new Date(firstDate + 'T12:00:00')
  d.setDate(d.getDate() + 30 * index)
  // Se dia não existe no mês (ex: 31/fev), usa último dia
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  if (d.getDate() > lastDay) d.setDate(lastDay)
  return d.toISOString().slice(0, 10)
}

async function verifyAdmin(): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()

  if (profile?.role !== 'admin') return { userId: null, error: 'Acesso negado.' }
  return { userId: user.id, error: null }
}

// ─── Action: salvar compra ────────────────────────────────────────────────────

export async function salvarCompra(data: CompraFormData): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()
  const purchaseMonth = parseInt(data.purchaseDate.slice(5, 7))
  const purchaseYear  = parseInt(data.purchaseDate.slice(0, 4))

  // ── 1. Criar fornecedores novos ───────────────────────────────────────────
  // supplierKey = supplierId existente OU supplierName (novo)
  const supplierCache = new Map<string, string>() // key → id final

  for (const row of data.rows) {
    if (row.supplierId) {
      supplierCache.set(row.supplierId, row.supplierId)
      continue
    }
    const key = row.supplierName.trim().toLowerCase()
    if (supplierCache.has(key)) continue

    const { data: created, error } = await admin
      .from('suppliers')
      .insert({ name: row.supplierName.trim(), initials: row.supplierInitials.trim().toUpperCase() })
      .select('id, initials')
      .single()

    if (error || !created) return { success: false, error: `Erro ao criar fornecedor "${row.supplierName}": ${error?.message}` }
    supplierCache.set(key, created.id)
  }

  function resolveSupplier(row: GridRow): string {
    if (row.supplierId) return row.supplierId
    return supplierCache.get(row.supplierName.trim().toLowerCase())!
  }

  // ── 2. Resolver iniciais para geração do código ───────────────────────────
  const initialsCache = new Map<string, string>() // supplierId → initials

  for (const row of data.rows) {
    const supId = resolveSupplier(row)
    if (initialsCache.has(supId)) continue
    if (row.supplierInitials.trim()) {
      initialsCache.set(supId, row.supplierInitials.trim().toUpperCase())
    } else {
      const { data: sup } = await admin.from('suppliers').select('initials').eq('id', supId).single()
      initialsCache.set(supId, sup?.initials?.toUpperCase() ?? 'FV')
    }
  }

  // ── 3. Criar / reusar / duplicar produtos ─────────────────────────────────
  const resolvedProductIds: string[] = []
  const ownership = data.isConsignment ? 'consignment' : 'own'

  for (const row of data.rows) {
    const supId    = resolveSupplier(row)
    const initials = initialsCache.get(supId) ?? 'FV'
    const code     = generateCode(initials, purchaseMonth, row.costPrice)

    if (row.productId && !row.productExistingCostDiffers) {
      // Reusar produto — só incrementa estoque
      const { data: existing } = await admin
        .from('products').select('quantity_in_stock').eq('id', row.productId).single()
      const newQty = (existing?.quantity_in_stock ?? 0) + row.quantity
      await admin.from('products')
        .update({ quantity_in_stock: newQty, updated_at: new Date().toISOString() })
        .eq('id', row.productId)
      resolvedProductIds.push(row.productId)
    } else {
      // Criar produto novo (ou duplicata com novo custo)
      const { data: newProd, error } = await admin
        .from('products')
        .insert({
          code,
          name:              row.productName.trim(),
          category:          row.category.trim().toLowerCase(),
          material:          row.material.trim().toLowerCase(),
          supplier_id:       supId,
          store_id:          row.storeId,
          cost_price:        row.costPrice,
          sale_price:        row.salePrice,
          promotional_price: row.promoPrice ?? null,
          quantity_in_stock: row.quantity,
          ownership_type:    ownership,
          purchase_month:    purchaseMonth,
          purchase_year:     purchaseYear,
          is_active:         true,
        })
        .select('id')
        .single()

      if (error || !newProd) return { success: false, error: `Erro ao criar produto "${row.productName}": ${error?.message}` }
      resolvedProductIds.push(newProd.id)
    }
  }

  // ── 4. Consignação ────────────────────────────────────────────────────────
  if (data.isConsignment) {
    const totalPieces = data.rows.reduce((s, r) => s + r.quantity, 0)
    const totalCost   = data.rows.reduce((s, r) => s + r.costPrice * r.quantity, 0)
    const firstSupId  = resolveSupplier(data.rows[0])

    const { data: consignment, error } = await admin
      .from('consignments')
      .insert({
        supplier_id:      firstSupId,
        store_id:         data.rows[0]?.storeId ?? null,
        user_id:          userId,
        received_date:    data.purchaseDate,
        return_deadline:  data.returnDeadline || null,
        min_purchase_pct: data.minPurchasePct ?? null,
        total_pieces:     totalPieces,
        total_cost_value: totalCost,
        status:           'active',
      })
      .select('id')
      .single()

    if (error || !consignment) return { success: false, error: `Erro ao criar consignação: ${error?.message}` }

    for (const productId of resolvedProductIds) {
      await admin.from('products')
        .update({ consignment_id: consignment.id })
        .eq('id', productId)
    }

    revalidatePath('/compras')
    revalidatePath('/produtos')
    revalidatePath('/estoque')
    return { success: true }
  }

  // ── 5. Criar purchase ─────────────────────────────────────────────────────
  const totalCost  = data.rows.reduce((s, r) => s + r.costPrice * r.quantity, 0)
  const totalItems = data.rows.reduce((s, r) => s + r.quantity, 0)

  const { data: purchase, error: purchErr } = await admin
    .from('purchases')
    .insert({
      supplier_id:   null,
      store_id:      null,
      user_id:       userId,
      purchase_date: data.purchaseDate,
      total_cost:    totalCost,
      total_items:   totalItems,
      nf_number:     data.nfNumber || null,
      nf_url:        data.nfUrl || null,
      notes:         data.notes || null,
    })
    .select('id')
    .single()

  if (purchErr || !purchase) return { success: false, error: `Erro ao criar compra: ${purchErr?.message}` }

  // ── 6. Criar purchase_items ───────────────────────────────────────────────
  const purchaseItems = data.rows.map((row, i) => ({
    purchase_id:  purchase.id,
    product_id:   resolvedProductIds[i],
    quantity:     row.quantity,
    unit_cost:    row.costPrice,
    subtotal:     row.costPrice * row.quantity,
    label_format: row.labelFormat,
  }))

  const { error: itemsErr } = await admin.from('purchase_items').insert(purchaseItems)
  if (itemsErr) return { success: false, error: `Erro ao criar itens: ${itemsErr.message}` }

  // Linkar purchase_id nos produtos novos
  for (let i = 0; i < resolvedProductIds.length; i++) {
    const row = data.rows[i]
    if (!row.productId || row.productExistingCostDiffers) {
      await admin.from('products')
        .update({ purchase_id: purchase.id })
        .eq('id', resolvedProductIds[i])
    }
  }

  // ── 7. Criar purchase_payments + transactions ─────────────────────────────
  for (const payment of data.payments) {
    const n      = payment.method === 'credit' ? payment.installments : 1
    const amount = parseFloat((payment.totalAmount / n).toFixed(2))

    for (let i = 0; i < n; i++) {
      const dueDate = installmentDate(payment.firstDueDate, i)
      const status  = n === 1 ? payment.status : (i === 0 && payment.status === 'completed' ? 'completed' : 'pending')
      const paidAt  = status === 'completed' ? new Date().toISOString() : null

      const { error: ppErr } = await admin.from('purchase_payments').insert({
        purchase_id:        purchase.id,
        payment_method:     payment.method,
        amount,
        installment_number: n > 1 ? i + 1 : null,
        due_date:           dueDate,
        status,
        paid_at:            paidAt,
      })
      if (ppErr) return { success: false, error: `Erro ao criar pagamento: ${ppErr.message}` }

      const desc = n > 1
        ? `Compra — parcela ${i + 1}/${n}`
        : `Compra${data.nfNumber ? ` NF ${data.nfNumber}` : ''}`

      const { error: txErr } = await admin.from('transactions').insert({
        store_id:         null,
        type:             'expense',
        amount,
        category:         'compra',
        description:      desc,
        reference_type:   'purchase',
        reference_id:     purchase.id,
        user_id:          userId,
        payment_method:   payment.method,
        transaction_date: data.purchaseDate,
        due_date:         dueDate,
        status,
        paid_at:          paidAt,
      })
      if (txErr) return { success: false, error: `Erro ao criar transação: ${txErr.message}` }
    }
  }

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true, purchaseId: purchase.id }
}

// ─── Action: deletar compra ───────────────────────────────────────────────────

export async function deletarCompra(purchaseId: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  await admin.from('transactions').delete().eq('reference_id', purchaseId).eq('reference_type', 'purchase')
  await admin.from('purchase_payments').delete().eq('purchase_id', purchaseId)
  await admin.from('purchase_items').delete().eq('purchase_id', purchaseId)
  const { error } = await admin.from('purchases').delete().eq('id', purchaseId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/compras')
  return { success: true }
}
