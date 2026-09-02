/**
 * Motivos de baixa manual de estoque.
 *
 * Fica FORA de `produtos/actions.ts` porque aquele arquivo é `'use server'`, e
 * módulo de server action só pode exportar função async — uma constante ali
 * quebra o build do Next.
 *
 * Os valores têm de bater com o CHECK de `fv.baixar_estoque`; mudar um lado sem
 * o outro faz a baixa falhar em runtime com "motivo inválido".
 */
/*
 * A ORDEM é a frequência de uso na loja, não o alfabeto: os dois primeiros são
 * o que a dona mais dá baixa, e o primeiro já vem selecionado.
 *
 * "Troca por defeito", não "Peça com defeito": a peça não some, volta ao
 * fornecedor e vira outra. O VALOR continua `defeito` — renomear obrigaria a
 * migrar as linhas já gravadas no ledger para mudar um texto de tela.
 */
export const MOTIVOS_BAIXA = [
  { valor: 'defeito',               rotulo: 'Troca por defeito' },
  { valor: 'devolucao_fornecedor',  rotulo: 'Devolvida ao fornecedor' },
  { valor: 'presente_blogueira',    rotulo: 'Presente para blogueira' },
  { valor: 'retirada_proprietaria', rotulo: 'Retirada pela proprietária' },
  { valor: 'perda',                 rotulo: 'Perda ou roubo' },
  { valor: 'uso_interno',           rotulo: 'Uso interno / mostruário' },
] as const

export type MotivoBaixa = typeof MOTIVOS_BAIXA[number]['valor']
