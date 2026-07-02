'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface StoreFormData {
  name: string
  city: string
  state: string
  address: string
  phone: string
  cnpj: string
  whatsapp_phone: string
}

// Normaliza o número de envio para E.164 (+55DDDNXXXXXXXX). Vazio -> null.
function normalizeWhatsapp(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return null
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`
  return `+${withCountry}`
}

export interface ActionResult {
  success: boolean
  error?: string
}

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase: null, error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { supabase: null, error: 'Acesso negado.' }
  return { supabase, error: null }
}

export async function createStore(data: StoreFormData): Promise<ActionResult> {
  const { supabase, error } = await verifyAdmin()
  if (error || !supabase) return { success: false, error: error ?? 'Erro desconhecido.' }

  const { error: dbError } = await supabase.from('stores').insert({
    name: data.name.trim(),
    city: data.city.trim(),
    state: data.state.trim().toUpperCase(),
    address: data.address.trim() || null,
    phone: data.phone.trim() || null,
    cnpj: data.cnpj.trim() || null,
    whatsapp_phone: normalizeWhatsapp(data.whatsapp_phone),
  })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/configuracoes/lojas')
  return { success: true }
}

export async function updateStore(id: string, data: StoreFormData): Promise<ActionResult> {
  const { supabase, error } = await verifyAdmin()
  if (error || !supabase) return { success: false, error: error ?? 'Erro desconhecido.' }

  const { error: dbError } = await supabase
    .from('stores')
    .update({
      name: data.name.trim(),
      city: data.city.trim(),
      state: data.state.trim().toUpperCase(),
      address: data.address.trim() || null,
      phone: data.phone.trim() || null,
      cnpj: data.cnpj.trim() || null,
      whatsapp_phone: normalizeWhatsapp(data.whatsapp_phone),
    })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/configuracoes/lojas')
  return { success: true }
}

export async function toggleStoreStatus(id: string, isActive: boolean): Promise<ActionResult> {
  const { supabase, error } = await verifyAdmin()
  if (error || !supabase) return { success: false, error: error ?? 'Erro desconhecido.' }

  const { error: dbError } = await supabase
    .from('stores')
    .update({ is_active: isActive })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/configuracoes/lojas')
  return { success: true }
}
