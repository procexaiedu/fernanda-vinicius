import { normalizarNomeFornecedor } from '@/lib/nomeFornecedor'

/*
 * Mora em lib porque a tela (NovaCompraForm) e o servidor (compras/actions.ts)
 * dão a MESMA mensagem — e num arquivo 'use server' só se exporta função async.
 */

/** Mais que isso vira parágrafo; o "e mais N" basta para ela achar o resto. */
const MAX_COMBINACOES = 4

/**
 * "Consignação é por fornecedor e loja: esta tem Santa Prata (Campinas) e Sta
 * Prata (Brasília). Separe…"
 *
 * A regra não muda (um lote = um fornecedor + uma loja); só a mensagem passa a
 * dizer QUAIS se misturaram. Antes era só "separe em lançamentos diferentes", e
 * numa consignação de 47 linhas ela ficava caçando a linha diferente.
 *
 * O fornecedor aparece como foi DIGITADO na primeira linha de cada grafia
 * normalizada — "Santa Prata" e "Sta Prata" são nomes diferentes e aparecem os
 * dois, que é justamente o que ela precisa ver.
 */
export function mensagemConsignacaoMisturada(
  linhas: Array<{ supplierName: string; storeId: string }>,
  nomeDaLoja: (storeId: string) => string | undefined,
): string {
  const vistas = new Map<string, string>()
  for (const l of linhas) {
    const chave = `${normalizarNomeFornecedor(l.supplierName)}|${l.storeId}`
    if (vistas.has(chave)) continue
    const loja = nomeDaLoja(l.storeId)
    const nome = l.supplierName.trim() || 'sem fornecedor'
    vistas.set(chave, loja ? `${nome} (${loja})` : nome)
  }
  const todas = [...vistas.values()]
  const mostradas = todas.slice(0, MAX_COMBINACOES)
  const resto = todas.length - mostradas.length
  const lista = resto > 0
    ? `${mostradas.join(', ')} e mais ${resto}`
    : mostradas.length > 1
      ? `${mostradas.slice(0, -1).join(', ')} e ${mostradas[mostradas.length - 1]}`
      : mostradas.join('')
  return `Consignação é por fornecedor e loja: esta tem ${lista}. Separe em lançamentos diferentes.`
}
