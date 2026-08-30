/**
 * CSV que o Excel brasileiro abre certo no duplo clique.
 *
 * Três detalhes que decidem se o arquivo abre em colunas ou numa coluna só com
 * tudo grudado — e que não são preferência, são o comportamento do Excel:
 *
 * 1. **Separador `;`.** No Windows em português o separador de lista é o ponto
 *    e vírgula. Um CSV com vírgula abre com a linha inteira na coluna A.
 *
 * 2. **BOM UTF-8.** Sem os três bytes iniciais o Excel lê como ANSI e "Anéis"
 *    vira "AnÃ©is". É o motivo de planilha exportada de sistema vir com acento
 *    quebrado.
 *
 * 3. **Decimal com vírgula.** `1234.56` numa planilha pt-BR entra como TEXTO e
 *    não soma. Com vírgula entra como número.
 *
 * Não usamos .xlsx de propósito: exigiria uma dependência nova (sheetjs) só
 * para uma tela de exportação, e o Excel abre este CSV com as colunas certas.
 * Se um dia precisar de várias abas ou formatação, aí sim vale a biblioteca.
 */

export const BOM_UTF8 = '﻿'

export interface ColunaCsv<T> {
  titulo: string
  /** Devolva número para célula numérica, string para texto. */
  valor: (linha: T) => string | number | null | undefined
}

/**
 * Escapa uma célula. Aspas duplas quando o conteúdo tem `;`, aspas ou quebra de
 * linha — que é o caso de "Anel Solitário; ouro 18k" e de observação com Enter.
 */
function celula(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    // Duas casas para dinheiro, sem separador de milhar: o Excel aplica o dele.
    return (Number.isInteger(v) ? String(v) : v.toFixed(2)).replace('.', ',')
  }

  const s = String(v)

  /*
   * Célula que começa com =, +, - ou @ é fórmula para o Excel. Nome de produto
   * dificilmente começa assim, mas observação digitada na mão começa — e uma
   * célula "=1+1" abre como fórmula, o que além de errado é o vetor clássico de
   * injeção de fórmula em CSV. Prefixo com aspa simples neutraliza.
   */
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s

  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

/** Monta o arquivo inteiro, já com BOM e CRLF. */
export function montarCsv<T>(linhas: T[], colunas: ColunaCsv<T>[]): string {
  const cabecalho = colunas.map(c => celula(c.titulo)).join(';')
  const corpo = linhas.map(l => colunas.map(c => celula(c.valor(l))).join(';'))
  // CRLF: é o que o Excel espera; com LF puro algumas versões juntam as linhas.
  return BOM_UTF8 + [cabecalho, ...corpo].join('\r\n') + '\r\n'
}

/** `estoque-2026-08-30.csv` — data no nome para não sobrescrever o download anterior. */
export function nomeArquivo(base: string, agora: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const dia = `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`
  const hora = `${p(agora.getHours())}${p(agora.getMinutes())}`
  return `${base}-${dia}-${hora}.csv`
}
