'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
  success: boolean
  error?: string
}

export interface ProductFormData {
  name: string
  category: string
  material: string
  supplier_id: string
  store_id: string
  cost_price: number
  sale_price: number
  promotional_price: number | null
  quantity_in_stock: number
  ownership_type: 'own' | 'consignment'
  purchase_month: number
  purchase_year: number
  photo_url: string | null
}

function generateCode(initials: string, month: number, costPrice: number): string {
  const m = String(month).padStart(2, '0')
  const costCents = Math.round(costPrice * 100)
  return `F${initials.toUpperCase()}${m}${costCents}`
}

async function generateUniqueCode(
  admin: ReturnType<typeof createAdminClient>,
  baseCode: string
): Promise<string> {
  const { data } = await admin
    .from('products')
    .select('code')
    .like('code', `${baseCode}%`)
  const existing = new Set((data ?? []).map((r: { code: string }) => r.code))
  if (!existing.has(baseCode)) return baseCode
  let i = 1
  while (existing.has(`${baseCode}-${i}`)) i++
  return `${baseCode}-${i}`
}

async function verifyAdmin(): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { userId: null, error: 'Acesso negado. Apenas administradores podem gerenciar produtos.' }
  return { userId: user.id, error: null }
}

export async function createProduct(data: ProductFormData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  const { data: supplier, error: supplierErr } = await admin
    .from('suppliers')
    .select('initials')
    .eq('id', data.supplier_id)
    .single()

  if (supplierErr || !supplier) return { success: false, error: 'Fornecedor não encontrado.' }

  const code = await generateUniqueCode(admin, generateCode(supplier.initials, data.purchase_month, data.cost_price))

  const { error } = await admin.from('products').insert({
    code,
    name:              data.name.trim(),
    category:          data.category.trim().toLowerCase(),
    material:          data.material.trim().toLowerCase(),
    supplier_id:       data.supplier_id,
    store_id:          data.store_id,
    cost_price:        data.cost_price,
    sale_price:        data.sale_price,
    promotional_price: data.promotional_price,
    quantity_in_stock: data.quantity_in_stock,
    ownership_type:    data.ownership_type,
    purchase_month:    data.purchase_month,
    purchase_year:     data.purchase_year,
    photo_url:         data.photo_url,
    is_active:         true,
  })

  if (error) return { success: false, error: error.message }

  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true }
}

export async function updateProduct(id: string, data: ProductFormData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  const { data: supplier, error: supplierErr } = await admin
    .from('suppliers')
    .select('initials')
    .eq('id', data.supplier_id)
    .single()

  if (supplierErr || !supplier) return { success: false, error: 'Fornecedor não encontrado.' }

  const code = await generateUniqueCode(admin, generateCode(supplier.initials, data.purchase_month, data.cost_price))

  const { error } = await admin.from('products').update({
    code,
    name:              data.name.trim(),
    category:          data.category.trim().toLowerCase(),
    material:          data.material.trim().toLowerCase(),
    supplier_id:       data.supplier_id,
    store_id:          data.store_id,
    cost_price:        data.cost_price,
    sale_price:        data.sale_price,
    promotional_price: data.promotional_price,
    quantity_in_stock: data.quantity_in_stock,
    ownership_type:    data.ownership_type,
    purchase_month:    data.purchase_month,
    purchase_year:     data.purchase_year,
    photo_url:         data.photo_url,
    updated_at:        new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true }
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  // Deleta o produto — o banco em cascata remove sale_items, purchase_items e stock_transfers
  // se houver FK ON DELETE CASCADE; caso contrário, deleta manualmente na ordem certa
  const { error } = await admin.from('products').delete().eq('id', id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true }
}

export async function toggleProductStatus(id: string, isActive: boolean): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('products').update({
    is_active: isActive,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true }
}

export interface SaleHistoryItem {
  id: string
  quantity: number
  unit_price: number
  sale_date: string
  store_name: string
  customer_name: string | null
  seller_name: string | null
}

export async function buscarHistoricoVendas(productId: string): Promise<SaleHistoryItem[]> {
  const admin = createAdminClient()

  // Passo 1: sale_items do produto — sem nenhum join PostgREST
  const { data: items } = await admin
    .from('sale_items')
    .select('id, quantity, unit_price, sale_id')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (!items?.length) return []

  const saleIds = items.map((i: any) => i.sale_id).filter(Boolean)
  if (!saleIds.length) return []

  // Passo 2: busca os dados das vendas (sem joins)
  const { data: sales } = await admin
    .from('sales')
    .select('id, sale_date, store_id, customer_id, seller_id, user_id')
    .in('id', saleIds)

  const salesMap = new Map((sales ?? []).map((s: any) => [s.id, s]))

  // Passo 3: resolve stores, customers e usuários em paralelo
  const storeIds    = [...new Set((sales ?? []).map((s: any) => s.store_id).filter(Boolean))]
  const customerIds = [...new Set((sales ?? []).map((s: any) => s.customer_id).filter(Boolean))]
  const sellerIds   = [...new Set(
    (sales ?? []).flatMap((s: any) => [s.seller_id, s.user_id]).filter(Boolean)
  )]

  const [storesRes, customersRes, usersRes] = await Promise.all([
    storeIds.length    ? admin.from('stores').select('id, name').in('id', storeIds)       : { data: [] },
    customerIds.length ? admin.from('customers').select('id, name').in('id', customerIds) : { data: [] },
    sellerIds.length   ? admin.from('users').select('id, full_name').in('id', sellerIds)  : { data: [] },
  ])

  const storeMap    = new Map((storesRes.data ?? []).map((s: any) => [s.id, s.name]))
  const customerMap = new Map((customersRes.data ?? []).map((c: any) => [c.id, c.name]))
  const userMap     = new Map((usersRes.data ?? []).map((u: any) => [u.id, u.full_name]))

  return items.map((i: any) => {
    const sale     = salesMap.get(i.sale_id)
    const sellerId = sale?.seller_id ?? sale?.user_id ?? null
    return {
      id:            i.id,
      quantity:      i.quantity,
      unit_price:    i.unit_price,
      sale_date:     sale?.sale_date ?? '',
      store_name:    sale ? (storeMap.get(sale.store_id) ?? '—') : '—',
      customer_name: sale?.customer_id ? (customerMap.get(sale.customer_id) ?? null) : null,
      seller_name:   sellerId ? (userMap.get(sellerId) ?? null) : null,
    }
  })
}
