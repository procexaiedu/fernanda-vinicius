/**
 * Formatação de dinheiro — uma só, para o sistema inteiro.
 *
 * Existiam 26 cópias de `function fmt(v)` espalhadas pelos componentes, e foi
 * exatamente por isso que duas delas divergiram e passaram a jogar os centavos
 * fora (`maximumFractionDigits: 0`), enquanto as outras 24 mostravam o valor
 * cheio. Num sistema de controle financeiro, a mesma venda aparecendo como
 * R$ 1.062 numa tela e R$ 1.062,40 na outra não é detalhe de estilo — é a tela
 * dizendo duas coisas diferentes sobre o mesmo fato.
 *
 * Regra da casa: **valor de dinheiro sempre com dois decimais, sempre**. Nada de
 * arredondar para caber, nada de esconder centavos porque "fica mais limpo".
 * R$ 32,90 é R$ 32,90; R$ 33 é outro número.
 */

/** Sempre com 2 casas: `1062.4` → `"R$ 1.062,40"`. */
export function formatarDinheiro(valor: number | null | undefined): string {
  return (Number(valor) || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Só os dígitos, sem o "R$": `1062.4` → `"1.062,40"`.
 *
 * Para onde o símbolo já está em outro lugar — cabeçalho de coluna, rótulo ao
 * lado, prefixo dentro do campo — e repeti-lo em cada linha só engrossa a tabela.
 */
export function formatarValor(valor: number | null | undefined): string {
  return (Number(valor) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Rótulo curto de EIXO de gráfico: `16000` → `"16 mil"`.
 *
 * É a única função daqui que abrevia, e existe porque marca de escala não é
 * valor: ninguém lê o traço do eixo para saber quanto entrou, lê para saber onde
 * está o ponto. Escrever "R$ 16.000,00" a cada marca rouba metade da largura do
 * gráfico do que interessa, que é a série.
 *
 * NÃO use isto para rotular um dado. Ponto de série, total, célula de tabela e
 * cartão usam `formatarDinheiro`.
 */
export function formatarEixo(valor: number): string {
  const abs = Math.abs(valor)
  if (abs >= 1_000_000) return `${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000)     return `${(valor / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return String(valor)
}
