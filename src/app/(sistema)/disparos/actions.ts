'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getProfile, lojaDoEscopo } from '@/lib/auth'
import { apiKey, wabaId, listTemplates } from '@/lib/ycloud'
import { enviarLote } from '@/lib/disparo/enviarLote'

export interface CriarDisparoData {
  titulo: string
  store_id: string
  template_name: string
  template_language: string
  param2: string
  param3: string
  image_url?: string | null
  customer_ids?: string[] | null
}

export interface ClienteOption {
  id: string
  name: string
  phone: string
}

/*
 * Clientes elegíveis de uma loja, para o seletor de destinatários.
 *
 * O `store_id` que chega é SUGESTÃO, não ordem. Quem tem loja própria recebe a
 * dela, venha o que vier do navegador: a leitura roda com `createAdminClient()`
 * (service_role, ignora RLS), então confiar no parâmetro seria deixar a base de
 * clientes da outra loja a um F12 de distância.
 */
export async function listarClientes(store_id: string): Promise<ClienteOption[]> {
  const perfil = await getProfile()
  if (!perfil) return []

  const loja = lojaDoEscopo(perfil, store_id)
  if (!loja) return []

  const admin = createAdminClient()
  const { data } = await admin
    .from('customers')
    .select('id, name, phone')
    .eq('origin_store_id', loja)
    .eq('whatsapp_opt_out', false)
    .not('phone', 'is', null)
    .order('name')
  return (data ?? []) as ClienteOption[]
}

// IDs dos clientes que já estão num disparo (para pré-marcar no seletor ao editar).
export async function listarDestinatarios(disparo_id: string): Promise<string[]> {
  if (!disparo_id) return []
  const admin = createAdminClient()
  const { data } = await admin
    .from('disparo_destinatarios')
    .select('customer_id')
    .eq('disparo_id', disparo_id)
  return (data ?? []).map(r => r.customer_id).filter(Boolean) as string[]
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

/**
 * Templates APPROVED da WABA da Fernanda.
 *
 * Era uma Edge Function (`disparo-templates`). O self-hosted da ProceX não tem
 * runtime de Edge Functions, então a chamada à YCloud passou a ser feita aqui —
 * a função nunca dependeu de Deno, só de `fetch`. Ver src/lib/ycloud.ts.
 */
export async function listarTemplates(): Promise<{ success: boolean; templates?: TemplateMeta[]; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const chave = apiKey()
  if (!chave) return { success: false, error: 'YCLOUD_API_KEY não configurada no servidor.' }

  try {
    const todos = await listTemplates(chave, wabaId())
    const templates = todos
      .filter(t => t.status === 'APPROVED')
      .sort((a, b) => a.name.localeCompare(b.name)) as TemplateMeta[]
    return { success: true, templates }
  } catch (e) {
    return { success: false, error: String(e) }
  }
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
    p_customer_ids:      (data.customer_ids && data.customer_ids.length) ? data.customer_ids : null,
  })

  if (error) return { success: false, error: error.message }
  const row = Array.isArray(rows) ? rows[0] : rows
  revalidatePath('/disparos')
  return { success: true, disparo_id: row?.disparo_id, total: row?.total ?? 0 }
}

/**
 * Dispara de fato, em lotes, até concluir. Idempotente e resumível.
 *
 * Era a Edge Function `disparo-send`; agora roda no próprio servidor (ver
 * src/lib/disparo/enviarLote.ts). O laço de lotes ficou: quem reserva cada
 * lote é `fv.claim_disparo_batch` com FOR UPDATE SKIP LOCKED, então uma queda
 * no meio não duplica mensagem nem perde a fila — e isso continua valendo
 * mesmo sem o limite de tempo que a Edge Function impunha.
 */
export async function enviarDisparo(disparo_id: string): Promise<EnviarResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  let enviados = 0, falhas = 0, restantes = 0
  for (let i = 0; i < 30; i++) {
    const r = await enviarLote(disparo_id)
    if (!r.ok) return { success: false, error: r.error, enviados, falhas }
    enviados += r.enviados
    falhas   += r.falhas
    restantes = r.restantes
    if (r.done) break
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
  // Mesma regra de `listarClientes`: a loja sai do perfil.
  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil, store_id) : null
  if (!loja) return 0
  store_id = loja
  const admin = createAdminClient()
  const { count } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('origin_store_id', store_id)
    .eq('whatsapp_opt_out', false)
  return count ?? 0
}

// Edita um rascunho (título, template, params, imagem) + atualiza os params dos destinatários pendentes.
// Não muda a loja (pra trocar de loja, use duplicar ou crie um novo).
export async function atualizarDisparo(id: string, data: CriarDisparoData): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }
  if (!data.titulo.trim()) return { success: false, error: 'Título é obrigatório.' }

  const admin = createAdminClient()
  const p2 = data.param2.trim()
  const p3 = data.param3.trim() || '.'

  const { error: e1 } = await admin.from('disparos').update({
    titulo:            data.titulo.trim(),
    template_name:     data.template_name,
    template_language: data.template_language,
    param2_default:    p2,
    param3_default:    p3,
    image_url:         data.image_url || null,
  }).eq('id', id).eq('status', 'rascunho')
  if (e1) return { success: false, error: e1.message }

  if (data.customer_ids && data.customer_ids.length) {
    // Re-monta os destinatários com a nova seleção (e aplica os params atualizados)
    const { error: e2 } = await admin.rpc('set_disparo_recipients', {
      p_disparo_id: id, p_param2: p2, p_param3: p3, p_customer_ids: data.customer_ids,
    })
    if (e2) return { success: false, error: e2.message }
  } else {
    // Sem seleção nova: só atualiza os params dos destinatários pendentes
    const { error: e2 } = await admin.from('disparo_destinatarios')
      .update({ param2: p2, param3: p3 })
      .eq('disparo_id', id).eq('status', 'pendente')
    if (e2) return { success: false, error: e2.message }
  }

  revalidatePath('/disparos')
  return { success: true }
}

// Duplica um disparo: cria um novo rascunho com os mesmos dados + re-snapshota os clientes atuais da loja.
export async function duplicarDisparo(id: string): Promise<CriarDisparoResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: src, error: e0 } = await admin.from('disparos')
    .select('titulo, store_id, template_name, template_language, param2_default, param3_default, image_url')
    .eq('id', id).single()
  if (e0 || !src) return { success: false, error: 'Disparo não encontrado.' }

  const { data: rows, error } = await admin.rpc('criar_disparo', {
    p_titulo:            (src.titulo + ' (cópia)').slice(0, 120),
    p_store_id:          src.store_id,
    p_template_name:     src.template_name,
    p_template_language: src.template_language,
    p_param2:            src.param2_default,
    p_param3:            src.param3_default,
    p_created_by:        user.id,
    p_image_url:         src.image_url,
  })
  if (error) return { success: false, error: error.message }
  const row = Array.isArray(rows) ? rows[0] : rows
  revalidatePath('/disparos')
  return { success: true, disparo_id: row?.disparo_id, total: row?.total ?? 0 }
}
