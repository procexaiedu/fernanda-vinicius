'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getProfile, podeConfigurarRede } from '@/lib/auth'

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

/*
 * SÓ O ADMIN GLOBAL.
 *
 * Conferia `role === 'admin'`, e admin de loja TAMBÉM é admin — a Eleandra, de
 * Brasília, passava. Cadastrar e editar LOJA é o topo da configuração da rede:
 * quem mexe aqui define as duas.
 *
 * A tela já redirecionava quem não é global, mas redirecionar não é trava:
 * server action é chamável direto, e estas leem com service_role. Pedido do
 * dono em 10/09 — "pense como 2 sistemas totalmente distintos".
 */
async function verifyAdmin() {
  const supabase = await createClient()
  const perfil = await getProfile()
  if (!perfil) return { supabase: null, error: 'Não autenticado.' }
  if (!podeConfigurarRede(perfil)) {
    return { supabase: null, error: 'Só a administradora geral muda esta configuração.' }
  }
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
