/**
 * Geração do código interno de referência do produto.
 *
 * Formato: `F` + iniciais do fornecedor + mês (2 dígitos) + preço de custo.
 * O preço é escrito SEM os zeros à direita dos centavos:
 *   160,00 → "160"   9,00 → "9"   8,20 → "82"   7,74 → "774"   79,90 → "799"
 *
 * O código NÃO é único — peças diferentes (nomes diferentes) podem compartilhar
 * o mesmo código. A cliente distingue os itens pelo nome, não por sufixo.
 */
export function generateCode(initials: string, month: number, costPrice: number): string {
  const m = String(month).padStart(2, '0')
  const costCents = Math.round(costPrice * 100)
  const reais = Math.floor(costCents / 100)
  const cents = costCents % 100
  let priceStr = String(reais)
  if (cents > 0) priceStr += String(cents).padStart(2, '0').replace(/0+$/, '')
  return `F${initials.toUpperCase()}${m}${priceStr}`
}
