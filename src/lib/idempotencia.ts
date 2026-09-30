/**
 * Idempotência dos salvamentos (venda, compra, bipe da conferência).
 *
 * O problema: salvar faz várias escritas sem transação. Se o servidor grava e
 * a resposta se perde (rede, timeout, deploy), a tela não sabe que deu certo —
 * ela clica de novo e tudo entra duas vezes. A saída é a TELA gerar um id por
 * operação e mandá-lo em todo reenvio; o servidor reconhece o id e devolve o
 * que já gravou em vez de gravar outra vez.
 *
 * Este arquivo é usado dos dois lados (tela e server actions), por isso não
 * importa nada de servidor.
 */

/**
 * Um uuid v4 novo para identificar a operação.
 *
 * `crypto.randomUUID` só existe em contexto seguro (https/localhost). Aberto
 * por IP da rede local, sem https, ele some — e aí monta o mesmo formato com
 * `getRandomValues`, que existe em qualquer contexto.
 */
export function novoIdDeRequisicao(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40   // versão 4
  b[8] = (b[8] & 0x3f) | 0x80   // variante RFC 4122
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * O id que veio da tela, se for um uuid de verdade; senão `null`.
 *
 * Lixo aqui não pode derrubar o salvamento: o insert falharia com 22P02 e ela
 * leria "não foi possível gravar". Id inválido = salva sem idempotência, como
 * antes.
 */
export function idDeRequisicaoValido(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null
}

type ErroPg = { code?: string; message?: string } | null | undefined

/**
 * A coluna `client_request_id` ainda não existe (migration não aplicada) ou o
 * PostgREST ainda não a enxerga (cache de schema velho)?
 *
 * 42703 = coluna inexistente (Postgres); PGRST204 = coluna fora do cache de
 * schema do PostgREST. Os dois querem dizer "segue sem idempotência" — o
 * deploy do código não pode quebrar o salvamento só porque a migration
 * atrasou.
 */
export function colunaDeIdempotenciaAusente(err: ErroPg): boolean {
  if (!err) return false
  if (err.code === '42703' || err.code === 'PGRST204') return true
  return /client_request_id/i.test(err.message ?? '') && /does not exist|schema cache/i.test(err.message ?? '')
}

/** Violação de único (23505) — o outro envio da mesma operação chegou antes. */
export function violouUnico(err: ErroPg): boolean {
  return err?.code === '23505'
}

/* Um aviso por tabela por processo: o log não pode virar uma linha por venda. */
const avisadas = new Set<string>()

export function avisarIdempotenciaDesligada(tabela: string, err: ErroPg) {
  if (avisadas.has(tabela)) return
  avisadas.add(tabela)
  console.warn(
    `[idempotencia] ${tabela}.client_request_id indisponível — salvando SEM proteção contra reenvio. `
    + 'Aplique supabase/migrations/20260930_idempotencia_salvamentos.sql (e recarregue o schema do PostgREST).',
    err,
  )
}
