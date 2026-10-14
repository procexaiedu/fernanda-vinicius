/**
 * Tempo médio de conserto, em dias corridos.
 *
 * Duas medidas, porque respondem a perguntas diferentes:
 *   recebido → pronto    quanto o ourives demora (o que ela promete à cliente)
 *   recebido → entregue  quanto a peça fica sob a guarda da loja
 *
 * Fica de fora da segunda o conserto cobrado e levado na hora no PDV: nasce
 * entregue no mesmo dia, sem passar pelo ourives, e puxaria a média para zero.
 * O critério: entra se passou por "pronta" OU se saiu num dia depois de entrar.
 *
 * O período conta pela data de chegada ao fim (pronto ou entregue), não pela
 * de recebimento: "nos últimos 30 dias, quanto levaram as peças que voltaram".
 */
export interface DatasConserto {
  recebidoEm: string
  prontoEm: string | null
  entregueEm: string | null
}

export interface Media { dias: number | null; amostra: number }

function diasEntre(de: string, ate: string): number {
  const ms = Date.parse(ate.slice(0, 10) + 'T00:00:00Z') - Date.parse(de.slice(0, 10) + 'T00:00:00Z')
  return Math.round(ms / 86_400_000)
}

function media(valores: number[]): Media {
  if (valores.length === 0) return { dias: null, amostra: 0 }
  const soma = valores.reduce((a, b) => a + b, 0)
  return { dias: Math.round((soma / valores.length) * 10) / 10, amostra: valores.length }
}

/** `desde` é YYYY-MM-DD inclusive; nulo = sem corte. */
export function tempoMedioConserto(lista: DatasConserto[], desde: string | null) {
  const noPeriodo = (d: string) => !desde || d >= desde

  const ateProntos = lista
    .filter(c => c.prontoEm && noPeriodo(c.prontoEm))
    .map(c => diasEntre(c.recebidoEm, c.prontoEm!))
    .filter(d => d >= 0)

  const ateEntregue = lista
    .filter(c => c.entregueEm && noPeriodo(c.entregueEm))
    .filter(c => c.prontoEm || c.entregueEm! > c.recebidoEm)
    .map(c => diasEntre(c.recebidoEm, c.entregueEm!))
    .filter(d => d >= 0)

  return { ateProntos: media(ateProntos), ateEntregue: media(ateEntregue) }
}
