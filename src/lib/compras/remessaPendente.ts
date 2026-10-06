/*
 * Compra com remessa pendente (lote do fornecedor despachado para outra loja,
 * `fv.salvar_compra_com_remessa`, desde 05/10).
 *
 * Enquanto a loja de destino não confere a chegada, as peças daquela loja estão
 * EM TRÂNSITO: saldo 0 no destino e o romaneio guarda quantidade, custo e preço
 * congelados no envio. `fv.editar_compra` mexe no saldo por delta, então editar a
 * quantidade agora poria peça direto no estoque da loja (pulando a conferência),
 * e mudar loja, custo ou preço deixaria o romaneio dizendo outra coisa. Por isso
 * esses campos ficam travados até a conferência; o resto da compra (data, NF,
 * observação, pagamentos, nome, categoria) continua editável.
 */

/** Status de romaneio que já terminou: recebido (com ou sem divergência) ou cancelado. */
const ENCERRADOS = new Set(['recebida', 'divergente', 'cancelada'])

export function remessaEstaPendente(status: string | null | undefined): boolean {
  return !!status && !ENCERRADOS.has(status)
}

export interface ItemTravavel {
  purchaseItemId: string
  name: string
  quantity: number
  storeId: string
  costPrice: number
  salePrice: number
  promoPrice: number | null
}

const centavos = (v: number | null | undefined) => Math.round(Number(v ?? 0) * 100)

/**
 * Primeiro item cuja quantidade, loja, custo ou preço mudou em relação ao
 * gravado (null = nada que afete a remessa mudou).
 */
export function itemQueMexeNaRemessa(
  gravados: ItemTravavel[],
  enviados: ItemTravavel[],
): { nome: string; campo: string } | null {
  const porId = new Map(gravados.map(i => [i.purchaseItemId, i]))
  for (const e of enviados) {
    const g = porId.get(e.purchaseItemId)
    if (!g) return { nome: e.name, campo: 'item' }
    if (Number(e.quantity) !== Number(g.quantity)) return { nome: e.name, campo: 'quantidade' }
    if (e.storeId !== g.storeId) return { nome: e.name, campo: 'loja' }
    if (centavos(e.costPrice) !== centavos(g.costPrice)) return { nome: e.name, campo: 'custo' }
    if (centavos(e.salePrice) !== centavos(g.salePrice)) return { nome: e.name, campo: 'preço de venda' }
    if (centavos(e.promoPrice) !== centavos(g.promoPrice)) return { nome: e.name, campo: 'preço promocional' }
  }
  return null
}

export function mensagemRemessaPendente(lojas: string[], item: { nome: string; campo: string }): string {
  const destino = lojas.length ? lojas.join(' e ') : 'a outra loja'
  return `Esta compra tem remessa para ${destino} ainda não conferida. `
    + `Quantidade, loja, custo e preço das peças ficam travados até a loja conferir a chegada `
    + `(em Estoque > Transferências). "${item.nome}": ${item.campo} foi alterado. `
    + `Data, NF, observação e pagamentos podem ser salvos normalmente.`
}
