/**
 * Troca com sobra e crédito da cliente — a conta, uma vez só, para a tela e
 * para o servidor (mesmo motivo de total.ts).
 *
 * SOBRA: a peça devolvida vale mais que o que a cliente leva. Antes o PDV
 * recusava ("o sistema ainda não emite vale"). Combinado com a Eleandra em
 * 23/10/2026, a sobra tem três destinos:
 *
 *   guardado    vira crédito da cliente na loja (fv.customer_credits);
 *   dispensado  a cliente abre mão: nada guardado, nada sai do caixa;
 *   devolvido   sai do caixa em dinheiro ou Pix.
 *
 * CRÉDITO: o saldo guardado paga compras seguintes, como forma de pagamento
 * ('store_credit'), com uso parcial. Quem impede usar mais que o saldo é o
 * banco (CHECK, dentro da transação da venda); aqui é só a conta da tela.
 */

export type DestinoSobra = 'guardado' | 'dispensado' | 'devolvido'
export type MetodoDevolucao = 'cash' | 'pix'

const centavos = (n: number) => Math.round(n * 100) / 100

/** Quanto a peça devolvida passa do total da venda. Zero se não passa. */
export function sobraDaTroca(total: number, creditoTroca: number): number {
  const s = centavos(creditoTroca - total)
  return s > 0.009 ? s : 0
}

/** Quanto do crédito cabe nesta venda: nem mais que o saldo, nem mais que o que falta. */
export function usoMaximoDoCredito(saldo: number, falta: number): number {
  return centavos(Math.max(0, Math.min(saldo, falta)))
}

/**
 * A sobra está resolvida? Devolve a mensagem para a tela, ou null.
 *
 * Com sobra não pode haver outro pagamento: a cliente não paga nada (o que ela
 * levou já está coberto pela peça) — pagamento junto seria cobrar a mais.
 */
export function conferirSobra(e: {
  total: number
  creditoTroca: number
  pagos: number
  temCliente: boolean
  destino: DestinoSobra | null | undefined
  metodo: MetodoDevolucao | null | undefined
}): string | null {
  const sobra = sobraDaTroca(e.total, e.creditoTroca)
  if (sobra === 0) return null
  if (e.pagos > 0.009) {
    return 'As peças devolvidas já cobrem a venda. Tire os pagamentos e escolha o que fazer com a sobra.'
  }
  if (!e.destino) {
    return `Sobram ${formatar(sobra)} da troca. Escolha: guardar como crédito, não guardar ou devolver o dinheiro.`
  }
  if (e.destino === 'guardado' && !e.temCliente) {
    return 'Para guardar o crédito, selecione a cliente.'
  }
  if (e.destino === 'devolvido' && e.metodo !== 'cash' && e.metodo !== 'pix') {
    return 'Escolha como devolver: dinheiro ou Pix.'
  }
  return null
}

function formatar(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
