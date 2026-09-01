'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { formatarNomeProprio } from '@/lib/nomeProprio'
import { requireProfile } from '@/lib/auth'
import { normalizarTelefone } from '@/lib/telefone'

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
    name:            formatarNomeProprio(data.name),
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
    name:            formatarNomeProprio(data.name),
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

// ─── Duplicata por telefone ───────────────────────────────────────────────────

export interface ClienteComMesmoTelefone {
  id: string
  name: string
  vendas: number
}

/**
 * Quem mais já usa este telefone.
 *
 * AVISA, não bloqueia — e isso é decisão, não preguiça.
 *
 * No treinamento de 31/08 a ideia levantada foi impedir cadastro com telefone
 * repetido. Medido na base: há 8 telefones repetidos, e eles são DUAS coisas
 * diferentes.
 *
 * Quatro são a mesma pessoa cadastrada duas vezes com sobrenome diferente
 * (Lucia Campos / Lucia Avary). Os outros quatro são pessoas diferentes
 * mesmo — Maria de Lourdes e Shanti Janveja, Isabela Fernandes e Daniele
 * Fonteles. Mãe e filha dividindo telefone é comum no varejo, e um número
 * digitado errado no cadastro de outra cliente também.
 *
 * Um índice único derrubaria os dois casos legítimos junto com os errados.
 * Quem consegue distinguir é quem está atendendo — então o sistema mostra o
 * que sabe e deixa a decisão com ela.
 */
export async function clientesComMesmoTelefone(
  telefone: string,
  ignorarId?: string,
): Promise<ClienteComMesmoTelefone[]> {
  await requireProfile()

  const canonico = normalizarTelefone(telefone)
  // Menos que isso não é telefone ainda — evita consultar a cada tecla.
  if (canonico.replace(/\D/g, '').length < 12) return []

  const admin = createAdminClient()
  const { data } = await admin
    .from('customers')
    .select('id, name')
    .eq('phone', canonico)

  const achados = (data ?? []).filter(c => c.id !== ignorarId)
  if (achados.length === 0) return []

  /*
   * A contagem de vendas é o que ajuda a decidir: entre dois cadastros do
   * mesmo telefone, o que tem histórico é o que deve sobreviver.
   */
  const { data: vendas } = await admin
    .from('sales')
    .select('customer_id')
    .in('customer_id', achados.map(c => c.id))

  const porCliente = new Map<string, number>()
  for (const v of vendas ?? []) {
    const k = v.customer_id as string
    porCliente.set(k, (porCliente.get(k) ?? 0) + 1)
  }

  return achados.map(c => ({
    id: c.id as string,
    name: c.name as string,
    vendas: porCliente.get(c.id as string) ?? 0,
  }))
}
