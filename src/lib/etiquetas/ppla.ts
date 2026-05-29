/**
 * Gerador de jobs PPLA (Argox OS-214 plus) — equivalente bit-a-bit ao que o
 * sistema antigo (Hiper Loja) enviava pra impressora.
 *
 * Referência completa: IMPRESSAO_ETIQUETAS.md (apêndices A e B contêm hex dump
 * do stream capturado do Hiper). Os testes em ppla.test.ts validam que a saída
 * bate com o doc.
 *
 * Regras inegociáveis:
 *   - Encoding: Windows-1252 (não UTF-8)
 *   - Line endings: LF (0x0A), nunca CRLF
 *   - Prefixo de barcode: 16 chars fixos antes dos dados
 *   - Layout A: tipo "B" (código interno); Layout B: tipo "C" (EAN/código)
 */

const STX = '\x02'
const SOH = '\x01'
const LF = '\n'

export type LabelFormat = 'A' | 'B'

export interface LabelData {
  /** Nome do produto, linha 1 da etiqueta. */
  name: string
  /** Referência do fornecedor (ex: FSO05429). NULL/'' deixa a linha vazia. */
  supplier_reference: string | null
  /** Preço de venda. Formatado internamente como pt-BR sem "R$" no template. */
  sale_price: number
  /** Conteúdo do barcode. Usado em ambos os layouts (A=tipo B, B=tipo C). */
  barcode_number: string
}

export interface LabelItem extends LabelData {
  quantity: number
}

/**
 * Formata número como preço pt-BR sem símbolo da moeda.
 *   1072      → "1.072,00"
 *   188       → "188,00"
 *   89.9      → "89,90"
 *   1234567.5 → "1.234.567,50"
 *
 * Implementação manual (não depende de Intl/ICU) — garante mesmo resultado
 * em qualquer runtime Node/browser.
 */
export function formatPrecoBR(value: number): string {
  const fixed = value.toFixed(2)
  const [intPart, decPart] = fixed.split('.')
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${withSep},${decPart}`
}

function buildFormat(campos: string[]): string {
  let s = ''
  s += 'n' + LF
  s += STX + 'M0500' + LF
  s += STX + 'O0220' + LF
  s += STX + 'V0' + LF
  s += STX + 'f220' + LF
  s += SOH + 'D' + LF
  s += STX + 'L' + LF
  s += 'D11' + LF
  s += 'A2' + LF
  for (const c of campos) s += c + LF
  s += LF // linha em branco antes do Q (Apêndice A tem; B tolera)
  s += 'Q0001' + LF
  s += 'E' + LF
  return s
}

/** Layout A — 90x13mm, 1 etiqueta por linha física (anel/colar/pulseira). */
/** Texto da etiqueta sempre em MAIÚSCULO (Unicode-aware: á→Á, ç→Ç). */
function up(s: string | null | undefined): string {
  return (s ?? '').toUpperCase()
}

function layoutA(p: LabelData): string {
  return buildFormat([
    `1E4202700100013B${p.barcode_number}`,
    `1911A0800350110${up(p.name)}`,
    `1911A0800230110${up(p.supplier_reference)}`,
    `1911A1000070110R$ ${formatPrecoBR(p.sale_price)}`,
  ])
}

/** Posições X dos textos/barcodes nas 3 colunas do Layout B (extraídas do doc). */
const X_TEXT_B = ['0015', '0142', '0270'] as const
const X_BARCODE_B = ['0033', '0160', '0288'] as const

/** Layout B — 30x18mm, 3 etiquetas lado a lado (brinco/bolsa/conjunto). */
function layoutB(tres: ReadonlyArray<LabelData | null>): string {
  const campos: string[] = []
  for (let c = 0; c < 3; c++) {
    const p = tres[c]
    if (!p) continue // coluna vazia: omitir as 4 linhas dela
    campos.push(`1911A060058${X_TEXT_B[c]}${up(p.name)}`)
    campos.push(`1911A060043${X_TEXT_B[c]}${up(p.supplier_reference)}`)
    campos.push(`1911A080027${X_TEXT_B[c]}R$ ${formatPrecoBR(p.sale_price)}`)
    campos.push(`1E420090004${X_BARCODE_B[c]}C${p.barcode_number}`)
  }
  return buildFormat(campos)
}

/** Quebra lista em grupos de 3, completando com null. */
export function chunksOf3<T>(arr: ReadonlyArray<T>): Array<Array<T | null>> {
  const out: Array<Array<T | null>> = []
  for (let i = 0; i < arr.length; i += 3) {
    const slice: Array<T | null> = arr.slice(i, i + 3) as Array<T | null>
    while (slice.length < 3) slice.push(null)
    out.push(slice)
  }
  return out
}

/**
 * Codepage usado para gerar os bytes enviados à impressora.
 *  - 'cp850'   : a Argox OS-214 plus opera por padrão em codepage DOS;
 *                CP850 (Latin-1 DOS) tem todos os acentos do pt-BR. PADRÃO.
 *  - 'ascii'   : transliteração (remove acentos). Plano B 100% à prova de falha
 *                se a impressora estiver em CP437 (que não tem ã/õ).
 *  - 'cp1252'  : Windows-1252. Só funciona se a impressora estiver configurada
 *                em CP1252 (não é o caso da nossa por padrão — acento sai como β).
 */
export type LabelEncoding = 'cp850' | 'ascii' | 'cp1252'

/**
 * Encoding padrão. Se o teste físico mostrar que a impressora está em CP437
 * (ã/õ falham), troque para 'ascii' aqui.
 */
export const DEFAULT_ENCODING: LabelEncoding = 'cp850'

/**
 * Gera o stream PPLA para uma lista de produtos no formato escolhido.
 * Retorna bytes prontos pra enviar via WritePrinter RAW.
 */
export function buildJob(
  format: LabelFormat,
  produtos: ReadonlyArray<LabelData>,
  encoding: LabelEncoding = DEFAULT_ENCODING,
): Uint8Array {
  if (produtos.length === 0) {
    throw new Error('Nenhum produto para imprimir')
  }
  let text = ''
  if (format === 'A') {
    for (const p of produtos) text += layoutA(p)
  } else {
    for (const linha of chunksOf3(produtos)) text += layoutB(linha)
  }
  return encodeFor(text, encoding)
}

function encodeFor(text: string, encoding: LabelEncoding): Uint8Array {
  switch (encoding) {
    case 'cp850': return cp850Encode(text)
    case 'ascii': return cp1252Encode(transliterate(text))
    case 'cp1252': return cp1252Encode(text)
  }
}

/** Expande itens conforme `quantity` e gera o job. */
export function buildJobFromItems(
  format: LabelFormat,
  items: ReadonlyArray<LabelItem>,
  encoding: LabelEncoding = DEFAULT_ENCODING,
): Uint8Array {
  const expanded: LabelData[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      expanded.push({
        name: item.name,
        supplier_reference: item.supplier_reference,
        sale_price: item.sale_price,
        barcode_number: item.barcode_number,
      })
    }
  }
  return buildJob(format, expanded, encoding)
}

/* ------------------------------------------------------------------ */
/* Windows-1252 encoder (browser-safe, sem dependência externa)        */
/* ------------------------------------------------------------------ */

/**
 * Mapping dos pontos Unicode que ocupam a faixa 0x80-0x9F do CP1252.
 * Fora dessa faixa, CP1252 = ISO-8859-1 (Unicode 0x00-0x7F e 0xA0-0xFF).
 */
const CP1252_HIGH: Readonly<Record<number, number>> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201c: 0x93, // "
  0x201d: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
}

/** Codifica string para bytes Windows-1252. Caracteres não-mapeáveis viram '?'. */
export function cp1252Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i)
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) {
      out[i] = cp
    } else {
      out[i] = CP1252_HIGH[cp] ?? 0x3f // '?'
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* CP850 (Latin-1 DOS) encoder — codepage padrão da Argox OS-214       */
/* ------------------------------------------------------------------ */

/**
 * Mapeia os caracteres acentuados do pt-BR (Unicode) para os bytes
 * correspondentes em CP850. ASCII (< 0x80) passa direto.
 * Cobre maiúsculas e minúsculas porque a etiqueta vai em maiúsculo mas
 * deixamos o conjunto completo por robustez.
 */
const CP850_MAP: Readonly<Record<number, number>> = {
  // Minúsculas
  0x00e7: 0x87, // ç
  0x00fc: 0x81, // ü
  0x00e9: 0x82, // é
  0x00e2: 0x83, // â
  0x00e4: 0x84, // ä
  0x00e0: 0x85, // à
  0x00e5: 0x86, // å
  0x00ea: 0x88, // ê
  0x00eb: 0x89, // ë
  0x00e8: 0x8a, // è
  0x00ef: 0x8b, // ï
  0x00ee: 0x8c, // î
  0x00ec: 0x8d, // ì
  0x00e1: 0xa0, // á
  0x00ed: 0xa1, // í
  0x00f3: 0xa2, // ó
  0x00fa: 0xa3, // ú
  0x00f1: 0xa4, // ñ
  0x00f4: 0x93, // ô
  0x00f6: 0x94, // ö
  0x00f2: 0x95, // ò
  0x00e3: 0xc6, // ã
  0x00f5: 0xe4, // õ
  // Maiúsculas (o que a etiqueta realmente usa)
  0x00c7: 0x80, // Ç
  0x00c9: 0x90, // É
  0x00c2: 0xb6, // Â
  0x00c4: 0x8e, // Ä
  0x00c0: 0xb7, // À
  0x00c5: 0x8f, // Å
  0x00ca: 0xd2, // Ê
  0x00cb: 0xd3, // Ë
  0x00c8: 0xd4, // È
  0x00cf: 0xd8, // Ï
  0x00ce: 0xd7, // Î
  0x00cc: 0xde, // Ì
  0x00c1: 0xb5, // Á
  0x00cd: 0xd6, // Í
  0x00d3: 0xe0, // Ó
  0x00da: 0xe9, // Ú
  0x00d1: 0xa5, // Ñ
  0x00d4: 0xe2, // Ô
  0x00d6: 0x99, // Ö
  0x00d2: 0xe3, // Ò
  0x00c3: 0xc7, // Ã
  0x00d5: 0xe5, // Õ
  0x00dc: 0x9a, // Ü
}

/** Codifica string para bytes CP850. ASCII passa direto; acentos via mapa; resto vira '?'. */
export function cp850Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i)
    if (cp < 0x80) {
      out[i] = cp
    } else {
      out[i] = CP850_MAP[cp] ?? 0x3f // '?'
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Transliteração para ASCII (plano B)                                  */
/* ------------------------------------------------------------------ */

/** Remove acentos: 'Coração' → 'Coracao'. Usa normalização Unicode NFD. */
export function transliterate(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos combinantes
    .replace(/[^\x00-\x7f]/g, '?')   // qualquer não-ASCII restante vira ?
}
