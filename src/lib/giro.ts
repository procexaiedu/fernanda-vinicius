/**
 * Tempo de giro — há quanto tempo a peça está parada, e quanto demorou para sair.
 *
 * Duas perguntas diferentes, que a loja costuma misturar:
 *
 *   PERMANÊNCIA  — peça que ESTÁ no estoque: hoje − entrada.
 *                  Responde "o que está encalhado?".
 *   GIRO         — peça que SAIU: data da venda − entrada.
 *                  Responde "quanto tempo essa categoria leva para vender?".
 *
 * A primeira sobe todo dia sozinha; a segunda congela no dia da venda. Somar as
 * duas numa média só dá um número que não quer dizer nada.
 *
 *
 * QUAL É A DATA DE ENTRADA
 *
 * `purchases.purchase_date`, e não `products.created_at`. O `created_at` é o dia
 * em que ALGUÉM DIGITOU a peça no sistema — em 206 dos 536 produtos com compra
 * vinculada as duas datas são dias diferentes, e num cadastro atrasado a peça
 * apareceria mais nova do que é. `created_at` fica só de reserva, para as 5 peças
 * sem compra vinculada.
 *
 *
 * A FAIXA VEM DA CONFIGURAÇÃO
 *
 * `stale_product_days` (Configurações → Negócio) manda no corte. Hoje está em
 * **30**, e as duas cópias de `getStatusVenda` que existiam em /produtos e
 * /estoque tinham 60 e 90 escritos na mão — o painel dizia uma coisa e a
 * configuração, outra. Aqui o "crítico" é uma vez e meia o "parado", então com
 * 30 dá 30/45 e com 60 dá 60/90, que era o comportamento antigo.
 */

/** Milissegundos num dia. */
const DIA = 86_400_000

export type FaixaGiro = 'novo' | 'ok' | 'parado' | 'critico'

export interface Giro {
  /** Dias desde a entrada, se ainda está em estoque. */
  diasParado: number
  /** Dias entre a entrada e a última venda, se já vendeu. `null` se nunca vendeu. */
  diasAteVender: number | null
  /** Dias desde a última venda — ou desde a entrada, se nunca vendeu. */
  diasSemVender: number
  faixa: FaixaGiro
  /** Data usada como entrada, para a tela poder mostrar de onde veio o número. */
  entrada: Date
}

function dias(de: Date, ate: Date): number {
  return Math.max(0, Math.floor((ate.getTime() - de.getTime()) / DIA))
}

export interface EntradaGiro {
  created_at: string
  last_sale_date: string | null
  /** `purchases.purchase_date` da compra que trouxe a peça, quando houver. */
  purchase_date?: string | null
}

export function calcularGiro(p: EntradaGiro, staleDays: number, agora = new Date()): Giro {
  // purchase_date manda; created_at é reserva.
  const entrada = new Date(p.purchase_date ?? p.created_at)
  const venda   = p.last_sale_date ? new Date(p.last_sale_date) : null

  const diasParado    = dias(entrada, agora)
  const diasAteVender = venda ? dias(entrada, venda) : null
  const diasSemVender = dias(venda ?? entrada, agora)

  const parado  = Math.max(1, staleDays)
  const critico = Math.round(parado * 1.5)

  /*
   * Peça recém-chegada que ainda não vendeu não é "parada" — é nova. Sem essa
   * faixa, toda compra nasce com selo de problema no dia seguinte e a tela vira
   * um mar de alerta que ninguém mais lê.
   */
  let faixa: FaixaGiro
  if (!venda && diasParado < parado)      faixa = 'novo'
  else if (diasSemVender >= critico)      faixa = 'critico'
  else if (diasSemVender >= parado)       faixa = 'parado'
  else                                     faixa = 'ok'

  return { diasParado, diasAteVender, diasSemVender, faixa, entrada }
}

export const ROTULO_FAIXA: Record<FaixaGiro, string> = {
  novo:    'Novo',
  ok:      'Girando',
  parado:  'Parado',
  critico: 'Encalhado',
}

/** "12 dias", "1 dia", "hoje" — o mesmo texto em toda tela. */
export function textoDias(n: number): string {
  if (n <= 0) return 'hoje'
  return n === 1 ? '1 dia' : `${n} dias`
}
