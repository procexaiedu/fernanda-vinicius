'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, ehAdmin, lojaDoEscopo } from '@/lib/auth'
import { chaveMetaLoja, isMesValido, type ConfigMetaLoja } from '@/lib/metas/loja'
import { apurarLoja, lerConfigDaLoja } from '@/lib/metas/lojaServer'
import { monthLabel } from '@/lib/metas/compute'

export interface MetaActionResult {
  success: boolean
  error?: string
}

/*
 * ADMIN, DENTRO DA LOJA DELA.
 *
 * Até 08/10 a meta era por vendedora numa tabela sem loja, e por isso só o
 * admin global mexia (10/09: "pense como 2 sistemas totalmente distintos").
 * Agora a meta é da LOJA e cada uma guarda a sua: a Eleandra ajusta a de
 * Brasília e não alcança a de Campinas, porque a loja vem do escopo da sessão
 * (lojaDoEscopo), nunca de um parâmetro que o navegador manda.
 */
async function lojaDaAdmin(): Promise<{ loja: string } | { erro: string }> {
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active) return { erro: 'Não autenticado.' }
  if (!ehAdmin(perfil)) return { erro: 'Só a administração muda a meta da loja.' }
  const loja = lojaDoEscopo(perfil)
  if (!loja) return { erro: 'Escolha a loja antes de mexer na meta.' }
  return { loja }
}

async function gravarConfig(loja: string, cfg: ConfigMetaLoja): Promise<MetaActionResult> {
  const admin = createAdminClient()
  const { error } = await admin.from('settings').upsert({
    key: chaveMetaLoja(loja),
    value: cfg,
    description: 'Meta mensal da loja e faixas de comissão (bateu / não bateu)',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  if (error) return { success: false, error: `Não foi possível salvar a meta: ${error.message}` }
  revalidatePath('/configuracoes/metas')
  revalidatePath('/pdv')
  revalidatePath('/')
  return { success: true }
}

function valorOk(n: number, max: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= max
}

/** Meta padrão do mês e as duas faixas de comissão da loja. */
export async function salvarMetaDaLoja(meta: number, pctBateu: number, pctNaoBateu: number): Promise<MetaActionResult> {
  const r = await lojaDaAdmin()
  if ('erro' in r) return { success: false, error: r.erro }
  if (!valorOk(meta, 1e9)) return { success: false, error: 'Meta inválida.' }
  if (!valorOk(pctBateu, 100) || !valorOk(pctNaoBateu, 100)) return { success: false, error: 'Percentual inválido (0 a 100).' }
  try {
    const atual = await lerConfigDaLoja(createAdminClient(), r.loja)
    return await gravarConfig(r.loja, { ...atual, meta, pctBateu, pctNaoBateu })
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/** Meta própria de um mês (ex.: dezembro). `null` volta a valer a padrão. */
export async function salvarMetaDoMes(mes: string, valor: number | null): Promise<MetaActionResult> {
  const r = await lojaDaAdmin()
  if ('erro' in r) return { success: false, error: r.erro }
  if (!isMesValido(mes)) return { success: false, error: 'Mês inválido.' }
  if (valor !== null && !valorOk(valor, 1e9)) return { success: false, error: 'Meta inválida.' }
  try {
    const atual = await lerConfigDaLoja(createAdminClient(), r.loja)
    const porMes = { ...atual.porMes }
    if (valor === null) delete porMes[mes]
    else porMes[mes] = valor
    return await gravarConfig(r.loja, { ...atual, porMes })
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export interface GerarComissoesResult extends MetaActionResult {
  created?: number
  updated?: number
  removed?: number
  /** Já pagas: ficaram como estavam. */
  jaPagas?: number
  total?: number
}

function ultimoDia(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

function primeiroDiaSeguinte(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/**
 * Lança (ou reconcilia) a comissão do mês no Financeiro, uma despesa por
 * vendedora, DA LOJA DA SESSÃO. Idempotente: rodar de novo atualiza o valor.
 *
 * Regra de 06/10: a loja bateu a meta → 4% para todas; não bateu → 3%; sobre
 * a base de cada uma (sem conserto, troca pela diferença). A regra antiga
 * exigia meta individual e somava conserto e troca cheios: o valor no
 * Financeiro não batia com o da tela.
 *
 * Por loja porque a mesma pessoa pode vender nas duas: cada loja paga a parte
 * dela, numa transação com `store_id` próprio.
 */
export async function gerarComissoesDoMes(mes: string): Promise<GerarComissoesResult> {
  const r = await lojaDaAdmin()
  if ('erro' in r) return { success: false, error: r.erro }
  if (!isMesValido(mes)) return { success: false, error: 'Mês inválido.' }

  const admin = createAdminClient()
  const txDate = ultimoDia(mes)
  const dueDate = primeiroDiaSeguinte(mes)

  let apuracao: Awaited<ReturnType<typeof apurarLoja>>
  try {
    apuracao = await apurarLoja(r.loja, mes)
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  const [usersRes, existingRes] = await Promise.all([
    admin.from('users').select('id, full_name'),
    admin.from('transactions').select('id, user_id, status')
      .eq('reference_type', 'seller_commission').eq('transaction_date', txDate).eq('store_id', r.loja),
  ])
  if (usersRes.error) return { success: false, error: `Não foi possível ler as vendedoras: ${usersRes.error.message}` }
  if (existingRes.error) return { success: false, error: `Não foi possível ler as comissões já lançadas: ${existingRes.error.message}` }

  const nomes = new Map((usersRes.data ?? []).map(u => [u.id as string, u.full_name as string]))
  const existentes = new Map((existingRes.data ?? []).map(t => [t.user_id as string | null, t.id as string]))
  /* Comissão já PAGA (status completed) não muda nem some: o dinheiro saiu.
     Se a conta mudou depois, quem acerta é a admin, à mão, no Financeiro. */
  const pagas = new Set((existingRes.data ?? []).filter(t => t.status === 'completed').map(t => t.id as string))
  let jaPagas = 0

  const devidas = apuracao.porVendedora.filter(c => c.comissao > 0)
  let created = 0, updated = 0, removed = 0

  for (const c of devidas) {
    const desc = `Comissão ${nomes.get(c.sellerId) ?? 'vendedora'} (${String(c.pct).replace('.', ',')}%) · ${monthLabel(mes)}`
    const idExistente = existentes.get(c.sellerId)
    if (idExistente && pagas.has(idExistente)) { jaPagas++; continue }
    if (idExistente) {
      const { error } = await admin.from('transactions').update({ amount: c.comissao, description: desc }).eq('id', idExistente)
      if (error) return { success: false, error: `Erro ao atualizar comissão: ${error.message}` }
      updated++
    } else {
      const { error } = await admin.from('transactions').insert({
        type: 'expense', cost_type: 'variable', category: 'Comissão', amount: c.comissao,
        description: desc, reference_type: 'seller_commission', reference_id: null,
        user_id: c.sellerId, store_id: r.loja,
        transaction_date: txDate, due_date: dueDate, status: 'pending',
      })
      if (error) return { success: false, error: `Erro ao criar comissão: ${error.message}` }
      created++
    }
  }

  const devidasIds = new Set(devidas.map(c => c.sellerId))
  for (const [uid, txId] of existentes) {
    if (uid && devidasIds.has(uid)) continue
    if (pagas.has(txId)) { jaPagas++; continue }
    const { error } = await admin.from('transactions').delete().eq('id', txId)
    if (error) return { success: false, error: `Erro ao remover comissão: ${error.message}` }
    removed++
  }

  revalidatePath('/configuracoes/metas')
  revalidatePath('/financeiro')
  return { success: true, created, updated, removed, jaPagas, total: devidas.length }
}
