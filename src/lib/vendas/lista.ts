/**
 * O que a lista de Vendas soma por venda: peças, quanto entrou e se teve troca.
 *
 * Função pura: recebe as linhas já buscadas e só faz a conta, para dar para
 * testar sem banco (o caso da Cris, abaixo, está no teste).
 */

export interface TrocaDaLista {
  id: string
  sale_id: string | null
  original_sale_id: string | null
}

export interface ResumoDaVenda {
  itens: number
  /* Soma de `sale_payments`. */
  pago: number
  /* Valor das peças devolvidas nas trocas que entraram nesta venda. */
  creditoTroca: number
  temTroca: boolean
}

export function resumirVendas(dados: {
  itens: { sale_id: string }[]
  pagamentos: { sale_id: string; amount: number | string }[]
  trocas: TrocaDaLista[]
  devolvidos: { exchange_id: string; quantity: number | string; unit_price: number | string }[]
}): Map<string, ResumoDaVenda> {
  const resumo = new Map<string, ResumoDaVenda>()
  const de = (id: string) => {
    let r = resumo.get(id)
    if (!r) resumo.set(id, (r = { itens: 0, pago: 0, creditoTroca: 0, temTroca: false }))
    return r
  }

  for (const it of dados.itens) de(it.sale_id).itens += 1
  for (const p of dados.pagamentos) de(p.sale_id).pago += Number(p.amount)

  /*
   * Troca é marcada pelas DUAS pontas. O PDV grava a troca com `sale_id` (a
   * venda nova) e deixa `original_sale_id` NULL: olhar só o original deixava o
   * selo e o card "Trocas" sempre em zero.
   */
  const vendaPorTroca = new Map<string, string>()
  for (const t of dados.trocas) {
    if (t.sale_id) {
      de(t.sale_id).temTroca = true
      vendaPorTroca.set(t.id, t.sale_id)
    }
    if (t.original_sale_id) de(t.original_sale_id).temTroca = true
  }

  /*
   * Peça devolvida na troca também PAGA a venda (a nova, `sale_id`).
   *
   * Sem isto a venda da Madalena — colar de R$498 pago com R$70 em Pix e um
   * colar de R$428 devolvido — aparecia como "FALTA R$428,00". Ela não devia
   * nada: a mercadoria cobriu a diferença.
   */
  for (const it of dados.devolvidos) {
    const vendaId = vendaPorTroca.get(it.exchange_id)
    if (!vendaId) continue
    de(vendaId).creditoTroca += Number(it.unit_price) * Number(it.quantity)
  }

  return resumo
}

/* Arredondado para não gerar "falta R$0,00" por resto de ponto flutuante. */
export function faltaPagar(total: number, r: ResumoDaVenda | undefined): number {
  return parseFloat((total - (r?.pago ?? 0) - (r?.creditoTroca ?? 0)).toFixed(2))
}
