'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
  success: boolean
  error?: string
}

export interface SupplierPhone {
  number: string
  is_whatsapp: boolean
}

export interface SupplierFormData {
  name: string
  initials: string
  contact_name: string
  phones: SupplierPhone[]
  instagram: string
  email: string
  cnpj: string
  accepts_consignment: boolean
  address: string
  neighborhood: string
  city: string
  state: string
  zip_code: string
  notes: string
}

async function verifyAdmin(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { error: 'Acesso negado.' }
  return { error: null }
}

export async function createSupplier(data: SupplierFormData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers').insert({
    name:                data.name.trim(),
    initials:            data.initials.trim().toUpperCase(),
    contact_name:        data.contact_name.trim() || null,
    phones:              data.phones.filter(p => p.number.trim()),
    instagram:           data.instagram.trim() || null,
    email:               data.email.trim() || null,
    cnpj:                data.cnpj.trim() || null,
    accepts_consignment: data.accepts_consignment,
    address:             data.address.trim() || null,
    neighborhood:        data.neighborhood.trim() || null,
    city:                data.city.trim() || null,
    state:               data.state.trim().toUpperCase() || null,
    zip_code:            data.zip_code.trim() || null,
    notes:               data.notes.trim() || null,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath('/configuracoes/fornecedores')
  return { success: true }
}

export async function updateSupplier(id: string, data: SupplierFormData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers').update({
    name:                data.name.trim(),
    initials:            data.initials.trim().toUpperCase(),
    contact_name:        data.contact_name.trim() || null,
    phones:              data.phones.filter(p => p.number.trim()),
    instagram:           data.instagram.trim() || null,
    email:               data.email.trim() || null,
    cnpj:                data.cnpj.trim() || null,
    accepts_consignment: data.accepts_consignment,
    address:             data.address.trim() || null,
    neighborhood:        data.neighborhood.trim() || null,
    city:                data.city.trim() || null,
    state:               data.state.trim().toUpperCase() || null,
    zip_code:            data.zip_code.trim() || null,
    notes:               data.notes.trim() || null,
    updated_at:          new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/configuracoes/fornecedores')
  return { success: true }
}

export async function deletarFornecedor(id: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  // Bloquear se tiver produtos vinculados
  const { count } = await admin
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', id)

  if (count && count > 0)
    return { success: false, error: `Este fornecedor possui ${count} produto${count > 1 ? 's' : ''} cadastrado${count > 1 ? 's' : ''}. Remova ou reatribua os produtos antes de excluir.` }

  const { error } = await admin.from('suppliers').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/fornecedores')
  return { success: true }
}

export async function toggleSupplierStatus(id: string, isActive: boolean): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/configuracoes/fornecedores')
  return { success: true }
}
