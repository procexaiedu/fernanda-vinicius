'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getProfile, ehAdmin, lojaDoEscopo } from '@/lib/auth'

/* Disparo manda WhatsApp para a base inteira da loja: só admin (07/10/2026).
   A tela já é só do admin, mas estas actions aceitavam qualquer sessão. */
async function naoEhAdmin(): Promise<boolean> {
  const p = await getProfile()
  return !p || !p.is_active || !ehAdmin(p)
}
import { apiKey, wabaId, listTemplates, modoSeco, normalizePhoneBR } from '@/lib/ycloud'
import { exclusoesAtivas, excluirTelefone, type ExclusaoAtiva, type MotivoExclusao } from '@/lib/disparo/exclusoes'
import { enviarLote } from '@/lib/disparo/enviarLote'
import { emLotes } from '@/lib/supabase/em-lotes'

/* Campanha é da loja (08/10/2026): a ação confere a loja do disparo contra a
 * loja da sessão, não só o papel. Antes a admin de Brasília excluía, enviava
 * ou editava disparo de Campinas pelo id, e criava um em Campinas mandando
 * outro `store_id` pelo navegador. `null` = sem corte (admin global sem loja). */
async function lojaDaSessao(): Promise<string | null> {
  const p = await getProfile()
  return p ? lojaDoEscopo(p) : null
}

async function disparoForaDaLoja(
  admin: ReturnType<typeof createAdminClient>, id: string, loja: string | null,
): Promise<string | null> {
  if (!loja) return null
  const { data, error } = await admin.from('disparos').select('store_id').eq('id', id).maybeSingle()
  if (error) return `Não foi possível conferir o disparo: ${error.message}`
  if (!data || data.store_id !== loja) return 'Disparo não encontrado.'
  return null
}

/* Destinatária escolhida à mão também tem que ser da loja. */
async function soClientesDaLoja(
  admin: ReturnType<typeof createAdminClient>, ids: string[], loja: string,
): Promise<string[]> {
  const achadas = await emLotes(ids, lote =>
    admin.from('customers').select('id').in('id', lote).eq('origin_store_id', loja), 'as clientes do disparo')
  return achadas.map(c => c.id as string)
}

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

export interface Candidato extends ClienteOption {
  birthday: string | null
  compras: number
  gasto: number
  ultima_compra: string | null
  /** Motivo da exclusão ativa; null = pode receber. */
  excluido: MotivoExclusao | null
}

/*
 * Candidatas de uma loja com o histórico de compra NA LOJA (lojas isoladas: a
 * venda de Brasília não conta para Campinas). Quem está na lista de exclusão
 * vem marcado, para a tela mostrar e não deixar marcar; o banco barra de novo
 * no snapshot e no lote.
 *
 * Erro de leitura sobe em vez de virar lista vazia: lista vazia aqui seria
 * "ninguém comprou" e a tela mostraria todo mundo como cliente fria.
 */
export async function listarCandidatos(store_id: string): Promise<{ ok: boolean; error?: string; candidatos?: Candidato[] }> {
  if (await naoEhAdmin()) return { ok: false, error: 'Só a administração faz disparos.' }
  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil, store_id) : null
  if (!loja) return { ok: false, error: 'Selecione a loja.' }

  const admin = createAdminClient()
  try {
    const clientes: (ClienteOption & { birthday: string | null })[] = []
    for (let de = 0; ; de += 1000) {
      const { data, error } = await admin.from('customers')
        .select('id, name, phone, birthday')
        .eq('origin_store_id', loja).eq('whatsapp_opt_out', false).not('phone', 'is', null)
        .order('name').range(de, de + 999)
      if (error) throw new Error('clientes: ' + error.message)
      clientes.push(...(data as typeof clientes))
      if (data.length < 1000) break
    }

    const porCliente = new Map<string, { compras: number; gasto: number; ultima: string }>()
    for (let de = 0; ; de += 1000) {
      const { data, error } = await admin.from('sales')
        .select('customer_id, total, sale_date')
        .eq('store_id', loja).eq('status', 'completed').not('customer_id', 'is', null)
        .order('id').range(de, de + 999)
      if (error) throw new Error('vendas: ' + error.message)
      for (const v of data) {
        const a = porCliente.get(v.customer_id) ?? { compras: 0, gasto: 0, ultima: '' }
        a.compras++
        a.gasto += Number(v.total ?? 0)
        if (v.sale_date > a.ultima) a.ultima = v.sale_date
        porCliente.set(v.customer_id, a)
      }
      if (data.length < 1000) break
    }

    const excl = new Map((await exclusoesAtivas(admin, loja)).map(e => [e.telefone_e164, e.motivo]))

    return {
      ok: true,
      candidatos: clientes.map(c => {
        const h = porCliente.get(c.id)
        const tel = normalizePhoneBR(c.phone)
        return {
          ...c,
          compras: h?.compras ?? 0,
          gasto: Math.round((h?.gasto ?? 0) * 100) / 100,
          ultima_compra: h?.ultima || null,
          excluido: tel ? excl.get(tel) ?? null : null,
        }
      }),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface ListaSalva {
  id: string
  nome: string
  descricao: string | null
  customer_ids: string[]
}

/*
 * Listas salvas da loja (14/10/2026), para o campo "Lista salva" do seletor.
 * Só da loja da sessão (lojas isoladas). A lista não fura a exclusão: a tela
 * só marca quem não está excluída, e o banco barra de novo no envio.
 */
export async function listarListas(store_id: string): Promise<{ ok: boolean; error?: string; listas?: ListaSalva[] }> {
  if (await naoEhAdmin()) return { ok: false, error: 'Só a administração faz disparos.' }
  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil, store_id) : null
  if (!loja) return { ok: false, error: 'Selecione a loja.' }

  const admin = createAdminClient()
  const { data: ls, error } = await admin.from('disparo_listas')
    .select('id, nome, descricao').eq('store_id', loja).eq('ativa', true).order('criado_em', { ascending: false })
  if (error) return { ok: false, error: 'Não consegui ler as listas salvas: ' + error.message }
  if (!ls.length) return { ok: true, listas: [] }

  const itens: { lista_id: string; customer_id: string }[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error: e } = await admin.from('disparo_lista_itens')
      .select('lista_id, customer_id').in('lista_id', ls.map(l => l.id))
      .order('lista_id').order('customer_id').range(de, de + 999)
    if (e) return { ok: false, error: 'Não consegui ler as listas salvas: ' + e.message }
    itens.push(...data)
    if (data.length < 1000) break
  }
  return {
    ok: true,
    listas: ls.map(l => ({ ...l, customer_ids: itens.filter(i => i.lista_id === l.id).map(i => i.customer_id) })),
  }
}

/*
 * Limite diário e saldo, para o contador da tela. Só leitura na YCloud. Se a
 * leitura falhar, volta null e a tela diz "não consegui ler", sem inventar.
 */
export async function infoEnvio(store_id: string): Promise<{ limiteDia: number | null; saldoUsd: number | null; custoMsgUsd: number }> {
  // Marketing no Brasil, tabela Meta 2026 (estimativa; a cobrança real vem da YCloud).
  const custoMsgUsd = 0.0625
  if (await naoEhAdmin()) return { limiteDia: null, saldoUsd: null, custoMsgUsd }
  if (modoSeco()) return { limiteDia: 250, saldoUsd: 8.49, custoMsgUsd }
  const chave = apiKey()
  if (!chave) return { limiteDia: null, saldoUsd: null, custoMsgUsd }

  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil, store_id) : null
  const admin = createAdminClient()
  const { data: st } = loja
    ? await admin.from('stores').select('whatsapp_phone').eq('id', loja).maybeSingle()
    : { data: null }

  const [saldo, numeros] = await Promise.all([
    fetch('https://api.ycloud.com/v2/balance', { headers: { 'X-API-Key': chave }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('https://api.ycloud.com/v2/whatsapp/phoneNumbers?limit=100', { headers: { 'X-API-Key': chave }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).catch(() => null),
  ])
  const num = (numeros?.items ?? []).find((n: { phoneNumber?: string }) => n.phoneNumber === st?.whatsapp_phone)
  const tier = String(num?.messagingLimit ?? '')
  const m = tier.match(/TIER_(\d+)(K)?/)
  const limiteDia = m ? Number(m[1]) * (m[2] ? 1000 : 1) : null
  return { limiteDia, saldoUsd: typeof saldo?.amount === 'number' ? saldo.amount : null, custoMsgUsd }
}

export interface ExclusaoRow extends ExclusaoAtiva {
  nome: string | null
}

export async function listarExclusoes(store_id: string): Promise<{ ok: boolean; error?: string; itens?: ExclusaoRow[] }> {
  if (await naoEhAdmin()) return { ok: false, error: 'Só a administração faz disparos.' }
  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil, store_id) : null
  if (!loja) return { ok: false, error: 'Selecione a loja.' }
  const admin = createAdminClient()
  try {
    const itens = await exclusoesAtivas(admin, loja)
    const ids = [...new Set(itens.map(i => i.customer_id).filter(Boolean))] as string[]
    const nomes = new Map<string, string>()
    if (ids.length) {
      const cs = await emLotes(ids, lote => admin.from('customers').select('id, name').in('id', lote), 'os nomes das excluídas')
      cs.forEach(c => nomes.set(c.id as string, c.name as string))
    }
    return { ok: true, itens: itens.map(i => ({ ...i, nome: i.customer_id ? nomes.get(i.customer_id) ?? null : null })) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Inclui à mão: pela cliente (da loja) ou por um telefone avulso. */
export async function incluirExclusao(input: { store_id: string; customer_id?: string; telefone?: string; detalhe?: string }): Promise<{ success: boolean; error?: string }> {
  if (await naoEhAdmin()) return { success: false, error: 'Só a administração faz disparos.' }
  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil, input.store_id) : null
  if (!loja) return { success: false, error: 'Selecione a loja.' }
  const admin = createAdminClient()

  let telefone = input.telefone ?? ''
  let customer_id: string | null = null
  if (input.customer_id) {
    const { data, error } = await admin.from('customers').select('id, phone')
      .eq('id', input.customer_id).eq('origin_store_id', loja).maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: 'Cliente não encontrada nesta loja.' }
    telefone = data.phone ?? ''
    customer_id = data.id
  }
  const r = await excluirTelefone(admin, {
    store_id: loja, telefone, customer_id, motivo: 'manual', origem: 'manual',
    detalhe: input.detalhe?.trim() || null, criado_por: perfil?.id ?? null,
  })
  if (!r.ok) return { success: false, error: r.error }
  revalidatePath('/disparos')
  return { success: true }
}

/** Retira da lista (a pessoa volta a poder receber). Soft: o histórico fica. */
export async function retirarExclusao(id: string, motivo: string): Promise<{ success: boolean; error?: string }> {
  if (await naoEhAdmin()) return { success: false, error: 'Só a administração faz disparos.' }
  if (!motivo.trim()) return { success: false, error: 'Diga por que está retirando.' }
  const perfil = await getProfile()
  const loja = perfil ? lojaDoEscopo(perfil) : null
  const admin = createAdminClient()
  let q = admin.from('disparo_exclusoes')
    .update({ removido_em: new Date().toISOString(), removido_por: perfil?.id ?? null, removido_motivo: motivo.trim() })
    .eq('id', id).is('removido_em', null)
  if (loja) q = q.eq('store_id', loja)
  const { data, error } = await q.select('id')
  if (error) return { success: false, error: error.message }
  if (!data?.length) return { success: false, error: 'Exclusão não encontrada.' }
  revalidatePath('/disparos')
  return { success: true }
}

// IDs dos clientes que já estão num disparo (para pré-marcar no seletor ao editar).
export async function listarDestinatarios(disparo_id: string): Promise<string[]> {
  if (!disparo_id) return []
  if (await naoEhAdmin()) return []
  const admin = createAdminClient()
  if (await disparoForaDaLoja(admin, disparo_id, await lojaDaSessao())) return []
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
  if (await naoEhAdmin()) return { success: false, error: 'Só a administração faz disparos.' }

  if (!data.titulo.trim()) return { success: false, error: 'Título é obrigatório.' }
  const sessao = await getProfile()
  const loja = sessao ? lojaDoEscopo(sessao, data.store_id) : null
  if (!loja)                return { success: false, error: 'Selecione a loja.' }
  if (!data.param2.trim())  return { success: false, error: 'O assunto ({{2}}) é obrigatório.' }

  const admin = createAdminClient()
  const escolhidas = data.customer_ids && data.customer_ids.length
    ? await soClientesDaLoja(admin, data.customer_ids, loja)
    : null
  if (escolhidas && escolhidas.length === 0) return { success: false, error: 'Nenhuma das clientes escolhidas é desta loja.' }
  const { data: rows, error } = await admin.rpc('criar_disparo', {
    p_titulo:            data.titulo.trim(),
    p_store_id:          loja,
    p_template_name:     data.template_name,
    p_template_language: data.template_language,
    p_param2:            data.param2.trim(),
    p_param3:            data.param3.trim() || '.',
    p_created_by:        user.id,
    p_image_url:         data.image_url || null,
    p_customer_ids:      escolhidas,
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
  if (await naoEhAdmin()) return { success: false, error: 'Só a administração faz disparos.' }
  const fora = await disparoForaDaLoja(createAdminClient(), disparo_id, await lojaDaSessao())
  if (fora) return { success: false, error: fora }

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
  if (await naoEhAdmin()) return { success: false, error: 'Só a administração faz disparos.' }

  const admin = createAdminClient()
  const fora = await disparoForaDaLoja(admin, id, await lojaDaSessao())
  if (fora) return { success: false, error: fora }
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
  if (await naoEhAdmin()) return { success: false, error: 'Só a administração faz disparos.' }
  if (!data.titulo.trim()) return { success: false, error: 'Título é obrigatório.' }

  const admin = createAdminClient()
  const loja = await lojaDaSessao()
  const fora = await disparoForaDaLoja(admin, id, loja)
  if (fora) return { success: false, error: fora }
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
    const escolhidas = loja ? await soClientesDaLoja(admin, data.customer_ids, loja) : data.customer_ids
    if (escolhidas.length === 0) return { success: false, error: 'Nenhuma das clientes escolhidas é desta loja.' }
    // Re-monta os destinatários com a nova seleção (e aplica os params atualizados)
    const { error: e2 } = await admin.rpc('set_disparo_recipients', {
      p_disparo_id: id, p_param2: p2, p_param3: p3, p_customer_ids: escolhidas,
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
  if (await naoEhAdmin()) return { success: false, error: 'Só a administração faz disparos.' }

  const admin = createAdminClient()
  const { data: src, error: e0 } = await admin.from('disparos')
    .select('titulo, store_id, template_name, template_language, param2_default, param3_default, image_url')
    .eq('id', id).single()
  if (e0 || !src) return { success: false, error: 'Disparo não encontrado.' }
  const loja = await lojaDaSessao()
  if (loja && src.store_id !== loja) return { success: false, error: 'Disparo não encontrado.' }

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
