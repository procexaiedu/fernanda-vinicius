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

/**
 * Sempre com 2 casas: `1062.4` → `"R$ 1.062,40"`.
 *
 * O negativo sai com o menos TIPOGRÁFICO (U+2212), não com o hífen que o
 * `toLocaleString` devolve. Nas fontes com `tabular-nums` o U+2212 tem a
 * largura de um dígito e o hífen não — numa coluna alinhada à direita, o hífen
 * empurra a primeira casa e o valor negativo desalinha dos vizinhos.
 *
 * É também o que faz `-R$ 1.779,00` do card bater com o `−R$ 95,00` da tabela:
 * eram dois desenhos do mesmo fato na mesma tela.
 *
 * Só troca o caractere de exibição — o número não muda.
 */
export function formatarDinheiro(valor: number | null | undefined): string {
  return (Number(valor) || 0)
    .toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace('-', '−')
}

/**
 * Dinheiro com sinal explícito, para lançamento de ledger.
 *
 * Existe pelo mesmo motivo de `formatarDinheiro`: o sinal era decidido em cada
 * chamada e divergiu. Numa mesma tela do Financeiro conviviam `− R$ 95,00` na
 * tabela (menos tipográfico U+2212, com espaço) e `-R$ 1.779,00` no card
 * (hífen, sem espaço) — dois desenhos para o mesmo fato.
 *
 * A escolha: **menos tipográfico, colado no valor**. O U+2212 tem a largura de
 * um dígito nas fontes com `tabular-nums`, então a coluna continua empilhando
 * alinhada; o hífen é mais estreito e desalinha a primeira casa. Sem espaço
 * porque com `text-align: right` o sinal precisa acompanhar o número, não
 * flutuar longe dele.
 *
 * `entrada` = crédito (mostra `+`), `saida` = débito (mostra `−`).
 */
export function formatarDinheiroComSinal(
  valor: number | null | undefined,
  tipo: 'entrada' | 'saida',
): string {
  const sinal = tipo === 'entrada' ? '+' : '−'
  return sinal + formatarDinheiro(Math.abs(Number(valor) || 0))
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
