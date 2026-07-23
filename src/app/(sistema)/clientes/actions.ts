'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
  success: boolean
  error?: string
  id?: string
}

export interface CustomerFormData {
  name: string
  phone: string
  cpf: string
  email: string
  birthday: string
  address: string
  city: string
  state: string
  zip_code: string
  origin_store_id: string
  notes: string
}

export interface CustomerSearchResult {
  id: string; name: string; phone: string; cpf: string | null; birthday: string | null
}

// Busca server-side (unaccent + telefone/CPF), limitada — evita carregar toda a
// base de clientes no front. Termo vazio devolve os primeiros por nome.
export async function searchCustomers(term: string): Promise<CustomerSearchResult[]> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('search_customers', { term: term ?? '', lim: 20 })
  if (error) return []
  return (data ?? []).map((c: any) => ({
    id: c.id, name: c.name, phone: c.phone, cpf: c.cpf, birthday: c.birthday,
  }))
}

export async function createCustomer(data: CustomerFormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: created, error } = await admin.from('customers').insert({
    name:            data.name.trim(),
    phone:           data.phone.trim(),
    cpf:             data.cpf.trim() || null,
    email:           data.email.trim() || null,
    birthday:        data.birthday || null,
    address:         data.address.trim() || null,
    city:            data.city.trim() || null,
    state:           data.state.trim().toUpperCase() || null,
    zip_code:        data.zip_code.trim() || null,
    origin_store_id: data.origin_store_id || null,
    notes:           data.notes.trim() || null,
  }).select('id').single()

  if (error) return { success: false, error: error.message }
  revalidatePath('/clientes')
  return { success: true, id: created.id }
}

export async function updateCustomer(id: string, data: CustomerFormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { error } = await admin.from('customers').update({
    name:            data.name.trim(),
    phone:           data.phone.trim(),
    cpf:             data.cpf.trim() || null,
    email:           data.email.trim() || null,
    birthday:        data.birthday || null,
    address:         data.address.trim() || null,
    city:            data.city.trim() || null,
    state:           data.state.trim().toUpperCase() || null,
    zip_code:        data.zip_code.trim() || null,
    origin_store_id: data.origin_store_id,
    notes:           data.notes.trim() || null,
    updated_at:      new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/clientes')
  return { success: true }
}

export async function deleteCustomer(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { error } = await admin.from('customers').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/clientes')
  return { success: true }
}
