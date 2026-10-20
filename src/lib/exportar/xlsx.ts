/**
 * .xlsx de verdade, sem dependência.
 *
 * O csv.ts resolve "abrir no Excel", mas a gestora pediu Excel (chamado #4) e
 * quer somar a coluna de valor e filtrar por data. No .xlsx o número é número e
 * a data é data em qualquer Excel, sem depender do separador do Windows.
 *
 * Um .xlsx é um zip com meia dúzia de XML. Para uma planilha de uma aba, sem
 * fórmula, o zip pode ser "store" (sem compressão): basta o CRC32 de cada
 * arquivo. São ~120 linhas no lugar de uma biblioteca de 1 MB (sheetjs/exceljs)
 * para uma tela só. Se um dia precisar de várias abas com estilo, aí vale a lib.
 */

export type CelulaXlsx = string | number | Date | null | undefined

export interface ColunaXlsx<T> {
  titulo: string
  /** número → célula numérica; Date → célula de data (dd/mm/aaaa); string → texto. */
  valor: (linha: T) => CelulaXlsx
  /** 'dinheiro' formata como R$ #.##0,00 (continua número). */
  formato?: 'dinheiro'
  largura?: number
}

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Caracteres de controle quebram o XML e o Excel recusa o arquivo inteiro.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function letra(col: number): string {
  let s = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Data do Excel: dias desde 30/12/1899. Usa o dia do calendário, sem fuso. */
function serialExcel(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000
}

/** "AAAA-MM-DD" → Date local, para a coluna de data. Vazio/ inválido → null. */
export function dataXlsx(dia: string | null | undefined): Date | null {
  if (!dia || !/^\d{4}-\d{2}-\d{2}/.test(dia)) return null
  const [y, m, d] = dia.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// estilos: 0 normal, 1 cabeçalho (negrito), 2 data, 3 dinheiro
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;R$&quot; #,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function planilha<T>(linhas: T[], colunas: ColunaXlsx<T>[]): string {
  const cols = colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 16}" customWidth="1"/>`).join('')
  const cab = colunas.map((c, i) => `<c r="${letra(i)}1" t="inlineStr" s="1"><is><t>${xml(c.titulo)}</t></is></c>`).join('')
  const corpo = linhas.map((l, li) => {
    const r = li + 2
    const cels = colunas.map((c, ci) => {
      const v = c.valor(l)
      const ref = `${letra(ci)}${r}`
      if (v === null || v === undefined || v === '') return ''
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `<c r="${ref}" s="2"><v>${serialExcel(v)}</v></c>`
      if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${c.formato === 'dinheiro' ? ' s="3"' : ''}><v>${v}</v></c>` : ''
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`
    }).join('')
    return `<row r="${r}">${cels}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1">${cab}</row>${corpo}</sheetData></worksheet>`
}

// ─── zip "store" ─────────────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(arquivos: { nome: string; conteudo: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const a of arquivos) {
    const nome = enc.encode(a.nome)
    const dados = enc.encode(a.conteudo)
    const crc = crc32(dados)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true)
    local.setUint32(14, crc, true); local.setUint32(18, dados.length, true); local.setUint32(22, dados.length, true)
    local.setUint16(26, nome.length, true)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true)
    cd.setUint32(16, crc, true); cd.setUint32(20, dados.length, true); cd.setUint32(24, dados.length, true)
    cd.setUint16(28, nome.length, true); cd.setUint32(42, offset, true)
    partes.push(new Uint8Array(local.buffer), nome, dados)
    central.push(new Uint8Array(cd.buffer), nome)
    offset += 30 + nome.length + dados.length
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0)
  const fim = new DataView(new ArrayBuffer(22))
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true)
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, offset, true)
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)]
  const out = new Uint8Array(todas.reduce((s, p) => s + p.length, 0))
  let p = 0
  for (const t of todas) { out.set(t, p); p += t.length }
  return out
}

/** Monta o .xlsx (uma aba). Devolve os bytes, prontos para um Blob. */
export function montarXlsx<T>(linhas: T[], colunas: ColunaXlsx<T>[], aba = 'Planilha'): Uint8Array {
  const nomeAba = xml(aba.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  return zip([
    { nome: '[Content_Types].xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { nome: '_rels/.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nome: 'xl/workbook.xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nomeAba}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nome: 'xl/styles.xml', conteudo: ESTILOS },
    { nome: 'xl/worksheets/sheet1.xml', conteudo: planilha(linhas, colunas) },
  ])
}

/** Baixa os bytes no navegador. */
export function baixarXlsx(bytes: Uint8Array, nome: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
