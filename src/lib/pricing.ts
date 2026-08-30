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

/**
 * Preço que a peça realmente sai — promoção só vale se estiver ATIVA e > 0.
 *
 * A armadilha é o fallback ingênuo `promotional_price ?? sale_price`: quando a
 * promoção está zerada mas o registro existe, `0` não é nulo, passa pelo `??` e
 * a peça vira R$ 0,00. Já aconteceu na impressão de etiqueta.
 */
export function precoEfetivo(p: {
  sale_price: number
  promotional_price: number | null
  promotional_active: boolean
}): number {
  return p.promotional_active && p.promotional_price && p.promotional_price > 0
    ? p.promotional_price
    : p.sale_price
}
