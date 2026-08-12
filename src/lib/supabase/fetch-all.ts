/**
 * Busca TODAS as linhas de uma consulta, em páginas.
 *
 * O Supabase corta a resposta em **1000 linhas** por requisição, do lado do
 * servidor. Isso não é contornável por `limit` nem por header `Range` — testado:
 * `limit=2000` e `Range: 0-4999` devolvem 1000 do mesmo jeito.
 *
 * O efeito disso era silencioso e grave: as telas de venda e de PDV carregam o
 * catálogo inteiro para o leitor de código de barras encontrar a peça. Com 1.031
 * produtos ativos, **31 ficavam invisíveis** — bipar uma delas respondia "código
 * não encontrado" e a peça não podia ser vendida. Como a consulta é ordenada por
 * nome, os cortados eram os do fim do alfabeto (TIARA, VELVET, ZIRCONIA...), e o
 * problema piora a cada mala de SP, que traz ~150 produtos novos.
 *
 * Uso:
 *   const produtos = await fetchAll((de, ate) =>
 *     admin.from('products').select('id, name').eq('is_active', true).order('name').range(de, ate)
 *   )
 */
const TAMANHO_PAGINA = 1000

export async function fetchAll<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanhoPagina = TAMANHO_PAGINA,
): Promise<T[]> {
  const todas: T[] = []

  for (let de = 0; ; de += tamanhoPagina) {
    const { data, error } = await consulta(de, de + tamanhoPagina - 1)
    if (error) break
    const lote = data ?? []
    todas.push(...lote)
    // Lote menor que a página = chegou ao fim. Evita uma requisição extra vazia.
    if (lote.length < tamanhoPagina) break
  }

  return todas
}
