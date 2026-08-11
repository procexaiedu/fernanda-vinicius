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
  /**
   * Custo total dos itens deste fornecedor. A soma dos pagamentos precisa
   * fechar com ele. Omitir desliga essa checagem (usado onde o subtotal por
   * fornecedor não está disponível).
   */
  subtotal?: number
}

/**
 * Diferença tolerada, em centavos. Comparamos centavos INTEIROS de propósito:
 * em ponto flutuante `100.01 - 100` dá 0.010000000000005, que estouraria uma
 * tolerância escrita como 0.01. 1 centavo é ruído de arredondamento; 2 já é
 * valor digitado errado.
 */
const TOLERANCIA_CENTAVOS = 1

const emCentavos = (v: number) => Math.round(Number(v) * 100)

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

    // A soma tem de fechar com o custo dos itens do fornecedor. Sem isto, um
    // valor digitado errado (R$ 5,00 num subtotal de R$ 11,00) passa: os
    // pagamentos têm valor e situação, mas a despesa lançada fica menor que a
    // compra e o ledger volta a divergir — o mesmo problema, em escala menor.
    if (typeof group.subtotal === 'number' && Number.isFinite(group.subtotal)) {
      const somaCent = group.payments.reduce((s, p) => s + emCentavos(p.amount || 0), 0)
      const diffCent = somaCent - emCentavos(group.subtotal)

      if (Math.abs(diffCent) > TOLERANCIA_CENTAVOS) {
        const falta = (Math.abs(diffCent) / 100).toFixed(2).replace('.', ',')
        const total = group.subtotal.toFixed(2).replace('.', ',')
        return `"${group.label}": os pagamentos somam R$ ${falta} ${diffCent > 0 ? 'a mais' : 'a menos'} que o subtotal de R$ ${total}.`
      }
    }
  }

  return null
}
