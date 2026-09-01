/**
 * O total da venda — um cálculo só, para a tela e para o banco.
 *
 * Esta função existe por causa de um bug que eu mesmo criei em 01/09.
 *
 * A regra de arredondamento estava escrita em TRÊS lugares: no formulário
 * (`NovaVendaForm`), em `createSale` e em `editarVenda`. Ao trocar
 * `Math.round` por `Math.ceil` mexi só no formulário — a tela passou a exibir
 * R$1.304,00 e o banco continuou gravando R$1.303,00, porque quem calcula de
 * verdade é o servidor. O conserto não consertou nada, e ficou pior que antes:
 * antes os três erravam juntos, depois passaram a discordar.
 *
 * Enquanto o cálculo estiver aqui, isso não volta a acontecer.
 *
 *
 * A REGRA
 *
 * Havendo desconto, o total sobe para o inteiro seguinte — sempre para cima,
 * nunca para o mais próximo. Confirmado pela dona em 01/09.
 *
 * Foi `Math.round` até então, e por isso a venda da Juliana Benatti em 29/08
 * cobrou R$1.304,00 no Pix e o sistema registrou R$1.303,00: um real de
 * diferença entre o caixa e o cadastro, calado.
 *
 * Só arredonda quando HÁ desconto. Sem ele o subtotal já é o preço de etiqueta,
 * e 1 de 561 produtos ativos tem centavos — subir esse não seria arredondar,
 * seria cobrar a mais sem motivo.
 *
 * O desconto é reconciliado a partir do total (`subtotal − total`), de modo que
 * o que fica gravado sempre fecha: subtotal − desconto = total.
 */

export interface EntradaTotal {
  subtotal: number
  /** Soma dos percentuais automáticos (PIX + aniversário). */
  discountPct: number
  /** Desconto em reais digitado pela operadora. */
  manualDiscount: number
}

export interface TotalDaVenda {
  total: number
  /** Desconto efetivo, já reconciliado com o arredondamento. */
  discountAmt: number
}

export function calcularTotalDaVenda({ subtotal, discountPct, manualDiscount }: EntradaTotal): TotalDaVenda {
  const rawDiscount = subtotal * discountPct / 100 + manualDiscount
  const rawTotal    = Math.max(0, subtotal - rawDiscount)

  const total = rawDiscount > 0
    ? Math.ceil(rawTotal)
    : parseFloat(rawTotal.toFixed(2))

  return {
    total,
    discountAmt: parseFloat((subtotal - total).toFixed(2)),
  }
}
