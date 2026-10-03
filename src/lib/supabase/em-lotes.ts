/**
 * Consulta por lista de ids, em lotes que cabem na URL.
 *
 * O PostgREST leva o filtro `.in('x', ids)` na query string. Com uuid, cada id
 * custa ~39 bytes já codificado (a vírgula vira %2C), e o Kong do self-hosted
 * devolve **414** a partir de ~8 KB: uns 200 ids, bem menos do que parece.
 *
 * Foi assim que a lista de Vendas passou a mostrar "FALTA R$324,00" numa venda
 * paga com troca (02/10/2026): 132 vendas, o `.or()` das trocas repetia os ids
 * duas vezes, a busca levou 414 e o `(data ?? [])` seguiu como se não houvesse
 * troca nenhuma.
 *
 * Aqui os lotes saem em paralelo e qualquer falha LANÇA: resultado pela metade
 * com cara de completo é pior do que a tela de erro.
 *
 * Uso:
 *   const itens = await emLotes(saleIds, lote =>
 *     admin.from('sale_items').select('sale_id').in('sale_id', lote), 'itens das vendas')
 */
export const TAMANHO_LOTE_IDS = 100

export async function emLotes<T>(
  ids: readonly string[],
  consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  rotulo: string,
  tamanhoLote = TAMANHO_LOTE_IDS,
): Promise<T[]> {
  const unicos = [...new Set(ids)]
  if (!unicos.length) return []

  const lotes: string[][] = []
  for (let i = 0; i < unicos.length; i += tamanhoLote) lotes.push(unicos.slice(i, i + tamanhoLote))

  const respostas = await Promise.all(lotes.map(lote => consulta(lote)))

  const todas: T[] = []
  for (const { data, error } of respostas) {
    if (error) {
      const msg = (error as { message?: string }).message ?? String(error)
      console.error(`[emLotes] falha ao carregar ${rotulo}:`, error)
      throw new Error(`Não foi possível carregar ${rotulo}: ${msg}`)
    }
    todas.push(...(data ?? []))
  }
  return todas
}
