'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface CriarDisparoData {
  titulo: string
  store_id: string
  template_name: string
  template_language: string
  param2: string
  param3: string
  image_url?: string | null
}

export interface TemplateMeta {
  name: string
  language: string
  category: string
  status: string
  headerFormat: 'IMAGE' | 'TEXT' | 'VIDEO' | 'DOCUMENT' | 'NONE'
  bodyText: string
  bodyVarCount: number
  bodyExample: string[]
  footer: string | null
}

// Lista os templates APPROVED da WABA da Fernanda (via edge function que fala com a YCloud)
export async function listarTemplates(): Promise<{ success: boolean; templates?: TemplateMeta[]; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data, error } = await admin.functions.invoke('disparo-templates', { body: {} })
  if (error) return { success: false, error: error.message }
  if (data?.error) return { success: false, error: data.error }
  return { success: true, templates: (data?.templates ?? []) as TemplateMeta[] }
}

export interface CriarDisparoResult {
  success: boolean
  error?: string
  disparo_id?: string
  total?: number
}

export interface EnviarResult {
  success: boolean
  error?: string
  enviados?: number
  falhas?: number
  restantes?: number
}

// Cria o disparo (rascunho) e já snapshota os destinatários da loja (via RPC fv.criar_disparo)
export async function criarDisparo(data: CriarDisparoData): Promise<CriarDisparoResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  if (!data.titulo.trim()) return { success: false, error: 'Título é obrigatório.' }
  if (!data.store_id)       return { success: false, error: 'Selecione a loja.' }
  if (!data.param2.trim())  return { success: false, error: 'O assunto ({{2}}) é obrigatório.' }

  const admin = createAdminClient()
  const { data: rows, error } = await admin.rpc('criar_disparo', {
    p_titulo:            data.titulo.trim(),
    p_store_id:          data.store_id,
    p_template_name:     data.template_name,
    p_template_language: data.template_language,
    p_param2:            data.param2.trim(),
    p_param3:            data.param3.trim() || '.',
    p_created_by:        user.id,
    p_image_url:         data.image_url || null,
  })

  if (error) return { success: false, error: error.message }
  const row = Array.isArray(rows) ? rows[0] : rows
  revalidatePath('/disparos')
  return { success: true, disparo_id: row?.disparo_id, total: row?.total ?? 0 }
}

// Dispara de fato: invoca a Edge Function em lotes até concluir (idempotente/resumível)
export async function enviarDisparo(disparo_id: string): Promise<EnviarResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  let enviados = 0, falhas = 0, restantes = 0
  for (let i = 0; i < 30; i++) {
    const { data, error } = await admin.functions.invoke('disparo-send', { body: { disparo_id } })
    if (error) return { success: false, error: error.message, enviados, falhas }
    enviados += data?.enviados ?? 0
    falhas   += data?.falhas ?? 0
    restantes = data?.restantes ?? 0
    if (data?.done) break
  }
  revalidatePath('/disparos')
  return { success: true, enviados, falhas, restantes }
}

export async function excluirDisparo(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { error } = await admin.from('disparos').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/disparos')
  return { success: true }
}

// Conta quantos clientes elegíveis a loja tem (para mostrar no formulário)
export async function contarDestinatarios(store_id: string): Promise<number> {
  if (!store_id) return 0
  const admin = createAdminClient()
  const { count } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('origin_store_id', store_id)
    .eq('whatsapp_opt_out', false)
  return count ?? 0
}
