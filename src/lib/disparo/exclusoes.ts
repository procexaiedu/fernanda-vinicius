import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneBR } from '@/lib/ycloud'

/**
 * Lista de exclusão de disparo (13/10/2026).
 *
 * Quem entra aqui não recebe campanha da loja. O cadastro em `fv.customers`
 * NÃO é tocado: a exclusão só existe para Disparos. O banco aplica a regra
 * (`fv.disparo_excluido`, usada pelas RPCs de destinatários e pelo lote), então
 * a tela só mostra e deixa incluir/retirar.
 *
 * Por loja, porque as lojas são isoladas. Para virar global, a regra muda num
 * lugar só: `fv.disparo_excluido` (e o filtro por loja de `exclusoesAtivas`).
 */

export type MotivoExclusao = 'invalido' | 'bloqueio' | 'opt_out' | 'manual'
export type OrigemExclusao = 'webhook' | 'resposta' | 'manual' | 'historico'

export const MOTIVO_LABEL: Record<MotivoExclusao, string> = {
  invalido: 'Número inválido / sem WhatsApp',
  bloqueio: 'Bloqueado',
  opt_out:  'Pediu para não receber',
  manual:   'Retirado à mão',
}

/**
 * Falha PERMANENTE do WhatsApp que vira exclusão. Saldo (BALANCE_INSUFFICIENT),
 * taxa (131048, 130429) e 131049 (Meta segurando marketing) são passageiras e
 * não excluem: a pessoa pode receber no próximo.
 */
const FALHA_PERMANENTE: Record<string, MotivoExclusao> = {
  '131026': 'invalido',   // Message Undeliverable: sem WhatsApp / número velho
  '130403': 'bloqueio',   // a loja bloqueou a pessoa
  '131050': 'opt_out',    // a pessoa parou de receber marketing desta empresa
}

export function motivoDaFalha(codigo: string | number | null | undefined): MotivoExclusao | null {
  return codigo == null ? null : FALHA_PERMANENTE[String(codigo)] ?? null
}

/*
 * Palavras de opt-out (regra do dono, 13/10/2026). "quem é" NÃO entra: é
 * pergunta, não recusa. Casa palavra inteira, sem acento e sem caixa, então
 * "parece" não é "pare" e "Não quero mais" é.
 */
const OPT_OUT = [
  'pare', 'parar', 'sair', 'remover', 'remove', 'descadastrar', 'cancelar',
  'nao quero', 'nao mande', 'stop', 'chega', 'denunciar',
]

function semAcento(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function pedeOptOut(texto: string | null | undefined): string | null {
  const t = ' ' + semAcento(texto ?? '').replace(/[^a-z0-9]+/g, ' ') + ' '
  return OPT_OUT.find(p => t.includes(' ' + p + ' ')) ?? null
}

export interface NovaExclusao {
  store_id: string
  telefone: string
  motivo: MotivoExclusao
  origem: OrigemExclusao
  detalhe?: string | null
  customer_id?: string | null
  criado_por?: string | null
}

/** Inclui. Já excluída (índice único da exclusão ativa) conta como sucesso. */
export async function excluirTelefone(
  db: ReturnType<typeof createAdminClient>, e: NovaExclusao,
): Promise<{ ok: boolean; error?: string; jaEstava?: boolean }> {
  const tel = normalizePhoneBR(e.telefone)
  if (!tel) return { ok: false, error: 'Telefone inválido.' }
  const { error } = await db.from('disparo_exclusoes').insert({
    store_id: e.store_id,
    telefone_e164: tel,
    motivo: e.motivo,
    origem: e.origem,
    detalhe: e.detalhe ?? null,
    customer_id: e.customer_id ?? null,
    criado_por: e.criado_por ?? null,
  })
  if (error?.code === '23505') return { ok: true, jaEstava: true }
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export interface ExclusaoAtiva {
  id: string
  telefone_e164: string
  customer_id: string | null
  motivo: MotivoExclusao
  origem: OrigemExclusao
  detalhe: string | null
  criado_em: string
}

/** Exclusões ativas da loja. Erro de leitura sobe: lista vazia por falha mandaria para quem não deve. */
export async function exclusoesAtivas(
  db: ReturnType<typeof createAdminClient>, store_id: string,
): Promise<ExclusaoAtiva[]> {
  const todas: ExclusaoAtiva[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from('disparo_exclusoes')
      .select('id, telefone_e164, customer_id, motivo, origem, detalhe, criado_em')
      .eq('store_id', store_id).is('removido_em', null)
      .order('criado_em', { ascending: false })
      .range(de, de + 999)
    if (error) throw new Error('Não consegui ler a lista de exclusão: ' + error.message)
    todas.push(...(data as ExclusaoAtiva[]))
    if (data.length < 1000) return todas
  }
}
