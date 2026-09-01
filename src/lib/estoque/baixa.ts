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
export const MOTIVOS_BAIXA = [
  { valor: 'defeito',              rotulo: 'Peça com defeito' },
  { valor: 'devolucao_fornecedor', rotulo: 'Devolvida ao fornecedor' },
  { valor: 'perda',                rotulo: 'Perda ou roubo' },
  { valor: 'uso_interno',          rotulo: 'Uso interno / mostruário' },
] as const

export type MotivoBaixa = typeof MOTIVOS_BAIXA[number]['valor']
