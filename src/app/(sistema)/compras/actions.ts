'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { generateCode } from '@/lib/productCode'

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

export interface SupplierPaymentGroup {
  groupKey: string
  payments: PaymentRow[]
  nfNumber?: string
  nfUrl?: string
}

export interface CompraFormData {
  purchaseDate: string        // YYYY-MM-DD
  notes: string
  rows: GridRow[]
  supplierPayments: SupplierPaymentGroup[]
  isConsignment: boolean
  returnDeadline: string      // só se consignação
  minPurchasePct: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  // Mapeia o groupKey de um SupplierPaymentGroup para o id real do fornecedor.
  // O groupKey vem do front como `row.supplierId ?? supplierName.toLowerCase()`.
  function resolveGroupSupplier(groupKey: string): string | null {
    const row = data.rows.find(
      r => (r.supplierId ?? r.supplierName.trim().toLowerCase()) === groupKey
    )
    return row ? resolveSupplier(row) : null
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

  // Concatenar NFs de todos os fornecedores (ex: "CT:001042 | BL:002033")
  const allNfNumbers = data.supplierPayments
    .filter(g => g.nfNumber?.trim())
    .map(g => g.nfNumber!.trim())
    .join(' | ') || null
  const firstNfUrl = data.supplierPayments.find(g => g.nfUrl?.trim())?.nfUrl?.trim() || null

  const { data: purchase, error: purchErr } = await admin
    .from('purchases')
    .insert({
      supplier_id:   null,
      store_id:      null,
      user_id:       userId,
      purchase_date: data.purchaseDate,
      total_cost:    totalCost,
      total_items:   totalItems,
      nf_number:     allNfNumbers,
      nf_url:        firstNfUrl,
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
  for (const group of data.supplierPayments) {
    const nfNum           = group.nfNumber?.trim() || null
    const groupSupplierId = resolveGroupSupplier(group.groupKey)
    for (const payment of group.payments) {
      const isCredit  = payment.method === 'credit'
      const isPending = payment.status === 'pending'
      const status    = (isCredit || !isPending) ? 'completed' : 'pending'
      const paidAt    = status === 'completed' ? new Date().toISOString() : null
      const dueDate   = payment.firstDueDate

      const { error: ppErr } = await admin.from('purchase_payments').insert({
        purchase_id:        purchase.id,
        supplier_id:        groupSupplierId,
        payment_method:     payment.method,
        amount:             payment.totalAmount,
        installment_number: isCredit && payment.installments > 1 ? payment.installments : null,
        due_date:           dueDate,
        status,
        paid_at:            paidAt,
      })
      if (ppErr) return { success: false, error: `Erro ao criar pagamento: ${ppErr.message}` }

      const desc = isCredit && payment.installments > 1
        ? `Compra — Crédito ${payment.installments}x${nfNum ? ` NF ${nfNum}` : ''}`
        : `Compra${nfNum ? ` NF ${nfNum}` : ''}`

      const { error: txErr } = await admin.from('transactions').insert({
        store_id:         null,
        type:             'expense',
        amount:           payment.totalAmount,
        category:         'compra_fornecedor',
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

// ─── Action: detalhe de uma compra ───────────────────────────────────────────

export interface PurchaseDetail {
  id: string
  purchase_date: string
  nf_number: string | null
  nf_url: string | null
  notes: string | null
  total_cost: number
  total_items: number
  items: Array<{
    id: string
    product_name: string
    supplier_name: string
    category: string
    material: string
    unit_cost: number
    sale_price: number
    quantity: number
    subtotal: number
    label_format: string
    store_name: string
    code: string
  }>
  payments: Array<{
    id: string
    payment_method: string
    amount: number
    installment_number: number | null
    due_date: string
    status: string
  }>
}

export async function buscarDetalheCompra(purchaseId: string): Promise<{ data: PurchaseDetail | null; error?: string }> {
  const admin = createAdminClient()

  const { data: purchase, error: purchErr } = await admin
    .from('purchases')
    .select('id, purchase_date, nf_number, nf_url, notes, total_cost, total_items')
    .eq('id', purchaseId)
    .single()

  if (purchErr || !purchase) return { data: null, error: purchErr?.message }

  const { data: rawItems } = await admin
    .from('purchase_items')
    .select('id, quantity, unit_cost, subtotal, label_format, products(name, code, category, material, sale_price, suppliers(name), stores(name))')
    .eq('purchase_id', purchaseId)

  const { data: payments } = await admin
    .from('purchase_payments')
    .select('id, payment_method, amount, installment_number, due_date, status')
    .eq('purchase_id', purchaseId)
    .order('due_date', { ascending: true })

  const items = (rawItems ?? []).map((item: any) => ({
    id: item.id,
    product_name: item.products?.name ?? '—',
    supplier_name: item.products?.suppliers?.name ?? '—',
    category: item.products?.category ?? '—',
    material: item.products?.material ?? '—',
    unit_cost: item.unit_cost,
    sale_price: item.products?.sale_price ?? 0,
    quantity: item.quantity,
    subtotal: item.subtotal,
    label_format: item.label_format ?? 'A',
    store_name: item.products?.stores?.name ?? '—',
    code: item.products?.code ?? '—',
  }))

  return {
    data: {
      ...purchase,
      items,
      payments: payments ?? [],
    }
  }
}

// ─── Action: deletar compra ───────────────────────────────────────────────────

export async function deletarCompra(purchaseId: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  // Reverter estoque dos itens antes de deletar
  const { data: items } = await admin
    .from('purchase_items')
    .select('product_id, quantity')
    .eq('purchase_id', purchaseId)

  if (items) {
    for (const item of items) {
      const { data: prod } = await admin
        .from('products').select('quantity_in_stock').eq('id', item.product_id).single()
      if (prod) {
        const newQty = Math.max(0, (prod.quantity_in_stock ?? 0) - item.quantity)
        await admin.from('products')
          .update({ quantity_in_stock: newQty })
          .eq('id', item.product_id)
      }
    }
  }

  // Nullar purchase_id nos produtos antes de deletar (FK constraint)
  await admin.from('products').update({ purchase_id: null }).eq('purchase_id', purchaseId)

  await admin.from('transactions').delete().eq('reference_id', purchaseId).eq('reference_type', 'purchase')
  await admin.from('purchase_payments').delete().eq('purchase_id', purchaseId)
  await admin.from('purchase_items').delete().eq('purchase_id', purchaseId)
  const { error } = await admin.from('purchases').delete().eq('id', purchaseId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true }
}

// ─── Tipos para edição de compra ─────────────────────────────────────────────

export interface CompraItemParaEdicao {
  purchaseItemId: string
  productId: string
  name: string
  category: string
  material: string
  costPrice: number
  salePrice: number
  promoPrice: number | null
  labelFormat: 'A' | 'B'
  quantity: number
  unitsSold: number
  currentStock: number
  storeId: string
  storeName: string
  supplierId: string
  supplierName: string
}

export interface CompraParaEdicao {
  id: string
  purchaseDate: string
  notes: string
  nfNumber: string
  items: CompraItemParaEdicao[]
  payments: Array<{
    id: string
    paymentMethod: string
    amount: number
    installmentNumber: number | null
    dueDate: string
    status: 'completed' | 'pending'
    supplierId: string | null
  }>
  stores: Array<{ id: string; name: string; city: string }>
  suppliers: Array<{ id: string; name: string; initials: string }>
  hasAnySale: boolean
}

export interface EditItemData {
  purchaseItemId: string
  productId: string
  name: string
  category: string
  material: string
  costPrice: number
  salePrice: number
  promoPrice: number | null
  labelFormat: 'A' | 'B'
  quantity: number
  storeId: string
  supplierId: string
}

export interface EditPaymentData {
  id: string
  paymentMethod: string
  amount: number
  dueDate: string
  installmentNumber: number | null
  status: 'completed' | 'pending'
  supplierId: string | null
}

export interface EditCompraPayload {
  purchaseId: string
  purchaseDate: string
  notes: string
  nfNumber: string
  items: EditItemData[]
  payments: EditPaymentData[]
}

// ─── Action: buscar compra para edição ────────────────────────────────────────

export async function buscarCompraParaEdicao(
  purchaseId: string
): Promise<{ data: CompraParaEdicao | null; error?: string }> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { data: null, error: authErr }

  const admin = createAdminClient()

  const { data: purchase } = await admin
    .from('purchases')
    .select('id, purchase_date, notes, nf_number')
    .eq('id', purchaseId)
    .single()

  if (!purchase) return { data: null, error: 'Compra não encontrada.' }

  const { data: rawItems } = await admin
    .from('purchase_items')
    .select(`
      id, quantity, unit_cost, label_format,
      products!inner (
        id, name, category, material,
        cost_price, sale_price, promotional_price,
        label_format, quantity_in_stock, store_id, supplier_id,
        suppliers!supplier_id(name, initials),
        stores!store_id(name)
      )
    `)
    .eq('purchase_id', purchaseId)

  const items = (rawItems ?? []) as unknown as Array<{
    id: string; quantity: number; unit_cost: number; label_format: string | null
    products: {
      id: string; name: string; category: string; material: string
      cost_price: number; sale_price: number; promotional_price: number | null
      label_format: string; quantity_in_stock: number; store_id: string; supplier_id: string
      suppliers: { name: string; initials: string } | null
      stores: { name: string } | null
    }
  }>

  const productIds = items.map(i => i.products.id)
  const soldCounts = new Map<string, number>()

  if (productIds.length > 0) {
    const { data: soldData } = await admin
      .from('sale_items')
      .select('product_id, quantity')
      .in('product_id', productIds)
    for (const row of (soldData ?? []) as Array<{ product_id: string; quantity: number }>) {
      soldCounts.set(row.product_id, (soldCounts.get(row.product_id) ?? 0) + row.quantity)
    }
  }

  const { data: payments } = await admin
    .from('purchase_payments')
    .select('id, payment_method, amount, installment_number, due_date, status, supplier_id')
    .eq('purchase_id', purchaseId)
    .order('due_date', { ascending: true })

  const [storesRes, suppliersRes] = await Promise.all([
    admin.from('stores').select('id, name, city').eq('is_active', true),
    admin.from('suppliers').select('id, name, initials').eq('is_active', true).order('name'),
  ])

  const hasAnySale = productIds.some(pid => (soldCounts.get(pid) ?? 0) > 0)

  return {
    data: {
      id: purchase.id,
      purchaseDate: purchase.purchase_date,
      notes: purchase.notes ?? '',
      nfNumber: purchase.nf_number ?? '',
      items: items.map(item => {
        const p = item.products
        return {
          purchaseItemId: item.id,
          productId:      p.id,
          name:           p.name,
          category:       p.category,
          material:       p.material,
          costPrice:      p.cost_price,
          salePrice:      p.sale_price,
          promoPrice:     p.promotional_price ?? null,
          labelFormat:    ((item.label_format ?? p.label_format) as 'A' | 'B') || 'B',
          quantity:       item.quantity,
          unitsSold:      soldCounts.get(p.id) ?? 0,
          currentStock:   p.quantity_in_stock,
          storeId:        p.store_id,
          storeName:      p.stores?.name ?? '—',
          supplierId:     p.supplier_id,
          supplierName:   p.suppliers?.name ?? '—',
        }
      }),
      payments: (payments ?? []).map(p => ({
        id:                p.id,
        paymentMethod:     p.payment_method,
        amount:            p.amount,
        installmentNumber: p.installment_number,
        dueDate:           p.due_date ?? '',
        status:            p.status as 'completed' | 'pending',
        supplierId:        (p as { supplier_id: string | null }).supplier_id ?? null,
      })),
      stores:    (storesRes.data    ?? []) as Array<{ id: string; name: string; city: string }>,
      suppliers: (suppliersRes.data ?? []) as Array<{ id: string; name: string; initials: string }>,
      hasAnySale,
    }
  }
}

// ─── Action: salvar edição de compra ─────────────────────────────────────────

export async function editarCompra(payload: EditCompraPayload): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  // Qtds originais (para calcular delta de estoque)
  const { data: originalItems } = await admin
    .from('purchase_items')
    .select('id, quantity')
    .eq('purchase_id', payload.purchaseId)

  const originalQtyMap = new Map<string, number>()
  for (const item of (originalItems ?? []) as Array<{ id: string; quantity: number }>) {
    originalQtyMap.set(item.id, item.quantity)
  }

  // Contagem de vendas para validação
  const productIds = payload.items.map(i => i.productId)
  const soldCounts = new Map<string, number>()
  if (productIds.length > 0) {
    const { data: soldData } = await admin
      .from('sale_items').select('product_id, quantity').in('product_id', productIds)
    for (const row of (soldData ?? []) as Array<{ product_id: string; quantity: number }>) {
      soldCounts.set(row.product_id, (soldCounts.get(row.product_id) ?? 0) + row.quantity)
    }
  }

  // Atualizar cada item
  for (const item of payload.items) {
    const unitsSold = soldCounts.get(item.productId) ?? 0
    if (item.quantity < unitsSold) {
      return {
        success: false,
        error: `"${item.name}": quantidade (${item.quantity}) não pode ser menor que unidades já vendidas (${unitsSold}).`
      }
    }

    const { data: prod } = await admin
      .from('products').select('store_id, quantity_in_stock').eq('id', item.productId).single()

    if (prod && prod.store_id !== item.storeId && unitsSold > 0) {
      return { success: false, error: `"${item.name}": não é possível mudar de loja pois já possui vendas registradas.` }
    }

    const originalQty = originalQtyMap.get(item.purchaseItemId) ?? item.quantity
    const delta       = item.quantity - originalQty
    const newStock    = (prod?.quantity_in_stock ?? 0) + delta

    await admin.from('products').update({
      name:              item.name.trim(),
      category:          item.category.trim().toLowerCase(),
      material:          item.material.trim().toLowerCase(),
      cost_price:        item.costPrice,
      sale_price:        item.salePrice,
      promotional_price: item.promoPrice ?? null,
      label_format:      item.labelFormat,
      supplier_id:       item.supplierId,
      store_id:          item.storeId,
      quantity_in_stock: newStock,
      updated_at:        new Date().toISOString(),
    }).eq('id', item.productId)

    await admin.from('purchase_items').update({
      quantity:     item.quantity,
      unit_cost:    item.costPrice,
      subtotal:     item.costPrice * item.quantity,
      label_format: item.labelFormat,
    }).eq('id', item.purchaseItemId)
  }

  // Atualizar purchase_payments in-place (todos, incluindo pagos)
  for (const pay of payload.payments) {
    await admin.from('purchase_payments')
      .update({
        payment_method: pay.paymentMethod,
        amount:         pay.amount,
        due_date:       pay.dueDate || null,
        supplier_id:    pay.supplierId ?? null,
      })
      .eq('id', pay.id)
  }

  // Recriar todas as transactions (delete + insert para garantir consistência)
  await admin.from('transactions')
    .delete()
    .eq('reference_id', payload.purchaseId)
    .eq('reference_type', 'purchase')

  for (const pay of payload.payments) {
    await admin.from('transactions').insert({
      store_id:         null,
      type:             'expense',
      amount:           pay.amount,
      category:         'compra_fornecedor',
      description:      'Compra',
      reference_type:   'purchase',
      reference_id:     payload.purchaseId,
      user_id:          userId,
      payment_method:   pay.paymentMethod,
      transaction_date: payload.purchaseDate,
      due_date:         pay.dueDate || null,
      status:           pay.status,
      paid_at:          pay.status === 'completed' ? new Date().toISOString() : null,
    })
  }

  // Recalcular totais da compra
  const newTotalCost  = payload.items.reduce((s, i) => s + i.costPrice * i.quantity, 0)
  const newTotalItems = payload.items.reduce((s, i) => s + i.quantity, 0)

  await admin.from('purchases').update({
    purchase_date: payload.purchaseDate,
    notes:         payload.notes || null,
    nf_number:     payload.nfNumber || null,
    total_cost:    newTotalCost,
    total_items:   newTotalItems,
    updated_at:    new Date().toISOString(),
  }).eq('id', payload.purchaseId)

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  return { success: true }
}

// ─── Buscar itens de uma compra para impressão de etiquetas ──────────────────

export interface ItemParaEtiqueta {
  id: string
  name: string
  supplier_reference: string | null
  sale_price: number
  barcode_number: string
  label_format: 'A' | 'B'
  quantity: number
}

export async function getItensCompraParaEtiquetas(purchaseId: string): Promise<ItemParaEtiqueta[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('purchase_items')
    .select(`
      quantity,
      label_format,
      products!inner (
        id,
        name,
        code,
        sale_price,
        promotional_price,
        barcode_number,
        label_format
      )
    `)
    .eq('purchase_id', purchaseId)

  if (error || !data) return []

  return data.map((row) => {
    const p = row.products as unknown as {
      id: string
      name: string
      code: string
      sale_price: number
      promotional_price: number | null
      barcode_number: string
      label_format: 'A' | 'B'
    }
    return {
      id: p.id,
      name: p.name,
      // A 2ª linha da etiqueta (referência interna) usa o code do produto (ex: FGS0545000)
      supplier_reference: p.code,
      sale_price: p.promotional_price ?? p.sale_price,
      barcode_number: p.barcode_number,
      // Preferência: label_format do item da compra; fallback no produto
      label_format: (row.label_format as 'A' | 'B') ?? p.label_format,
      quantity: row.quantity ?? 1,
    }
  })
}
