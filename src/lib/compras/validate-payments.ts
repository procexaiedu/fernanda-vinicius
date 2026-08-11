/**
 * Validação dos pagamentos de uma compra — fonte única para o formulário e para
 * a server action.
 *
 * Por que existe: o formulário exigia que houvesse ao menos uma linha de
 * pagamento por fornecedor, mas não que ela tivesse valor. Como cada linha
 * nascia com R$ 0,00 e situação "Pago", uma compra de vários fornecedores
 * (uma mala de SP tem ~10) obrigava a criar ~10 linhas vazias só para o botão
 * de salvar liberar — e elas entravam no banco como pagamentos de R$ 0,00 já
 * quitados. O ledger financeiro é gerado dessas linhas, então a despesa da
 * compra simplesmente não aparecia. Foi assim que R$ 34.207,98 em 4 compras
 * ficaram fora do resultado.
 */

export interface PaymentToValidate {
  /** Valor do pagamento em R$. */
  amount: number
  /** `''`/ausente = não declarado. */
  status: 'completed' | 'pending' | '' | null | undefined
}

export interface PaymentGroupToValidate {
  /** Nome do fornecedor, usado na mensagem de erro. */
  label: string
  payments: PaymentToValidate[]
}

/**
 * Retorna a primeira mensagem de erro encontrada, ou `null` se estiver tudo ok.
 * A ordem importa: reclama do valor antes da situação, para a usuária resolver
 * um campo por vez em vez de receber duas reclamações da mesma linha.
 */
export function validatePaymentGroups(groups: PaymentGroupToValidate[]): string | null {
  for (const group of groups) {
    if (!group.payments.length) {
      return `"${group.label}": adicione ao menos um pagamento.`
    }

    for (const [i, p] of group.payments.entries()) {
      const n = group.payments.length > 1 ? ` ${i + 1}` : ''

      if (!Number.isFinite(Number(p.amount)) || Number(p.amount) <= 0) {
        return `"${group.label}": informe o valor do pagamento${n}.`
      }

      if (p.status !== 'completed' && p.status !== 'pending') {
        return `"${group.label}": declare se o pagamento${n} está Pago ou Pendente.`
      }
    }
  }

  return null
}
