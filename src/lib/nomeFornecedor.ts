/**
 * Chave de comparação para nome de fornecedor.
 *
 * "  Santa   Prata ", "SANTA PRATA" e "Santa-Prata" caem todas na mesma chave. É o
 * que permite detectar o mesmo fornecedor cadastrado duas vezes.
 *
 * Mora aqui, e não em actions.ts, porque num arquivo 'use server' TODO export
 * precisa ser async — e o cliente precisa desta função de forma síncrona, para
 * avisar enquanto a pessoa digita.
 */
export function normalizarNomeFornecedor(nome: string): string {
  return (nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // tira acento
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')                        // pontuação vira espaço
    .replace(/s+/g, ' ')
    .trim()
}
