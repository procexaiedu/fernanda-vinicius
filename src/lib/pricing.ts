/**
 * Precificação — cálculo do preço de venda sugerido a partir do custo + markup.
 *
 * Fonte única usada tanto na Compra (NovaCompraForm) quanto no cadastro de Produto,
 * para que os dois módulos nunca divirjam. O markup vem do setting `default_markup_pct`.
 *
 * Ex.: custo 100, markup 100% → 200,00 ; markup 280% → 380,00.
 */
export function computeSalePrice(cost: number, markupPct: number): number {
  if (!cost || cost <= 0) return 0
  return parseFloat((cost * (1 + markupPct / 100)).toFixed(2))
}

/**
 * true se o preço de venda atual ainda é o "automático" (nunca foi mexido à mão):
 * está zerado, ou bate exatamente com o auto calculado para o custo anterior.
 * Permite recalcular ao mudar o custo SEM sobrescrever um valor digitado manualmente.
 */
export function salePriceIsAuto(currentSale: number, prevCost: number, markupPct: number): boolean {
  return currentSale === 0 || currentSale === computeSalePrice(prevCost, markupPct)
}
