import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import bwipjs from 'bwip-js/browser'

export type LabelFormat = 'A' | 'B'

export interface LabelData {
  name: string
  supplier_reference: string | null
  sale_price: number
  barcode_number: string
}

export interface LabelItem extends LabelData {
  quantity: number
}

const MM_TO_PT = 2.83465

const DIM = {
  A: { widthMm: 90, heightMm: 13 },
  B: { widthMm: 30, heightMm: 18 },
} as const

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

async function barcodePng(text: string, opts: { scale?: number; height?: number; includetext?: boolean } = {}): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  bwipjs.toCanvas(canvas, {
    bcid: 'code128',
    text,
    scale: opts.scale ?? 3,
    height: opts.height ?? 8,
    includetext: opts.includetext ?? true,
    textxalign: 'center',
    textsize: 8,
    paddingwidth: 0,
    paddingheight: 0,
    backgroundcolor: 'FFFFFF',
  })
  const dataUrl = canvas.toDataURL('image/png')
  const res = await fetch(dataUrl)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

interface DrawCtx {
  page: PDFPage
  font: PDFFont
  fontBold: PDFFont
  widthPt: number
  heightPt: number
}

async function drawLabelA(ctx: DrawCtx, data: LabelData) {
  const { page, font, fontBold, widthPt, heightPt } = ctx
  // 90x13mm landscape. Esquerda: 3 linhas empilhadas. Direita: barcode.
  const padding = 1 * MM_TO_PT
  const textBlockWidth = 35 * MM_TO_PT
  const fontSize = 7
  const priceFontSize = 8

  const lineHeight = (heightPt - padding * 2) / 3
  const yName = heightPt - padding - fontSize
  const yRef = yName - lineHeight
  const yPrice = yRef - lineHeight

  page.drawText(truncate(data.name.toUpperCase(), 24), {
    x: padding, y: yName, size: fontSize, font,
  })
  page.drawText(data.supplier_reference ?? '', {
    x: padding, y: yRef, size: fontSize, font,
  })
  page.drawText(formatBRL(data.sale_price), {
    x: padding, y: yPrice, size: priceFontSize, font: fontBold,
  })

  // Barcode no lado direito
  const png = await barcodePng(data.barcode_number, { scale: 3, height: 8, includetext: true })
  const pdfImg = await page.doc.embedPng(png)
  const barcodeMaxWidth = widthPt - textBlockWidth - padding * 2
  const barcodeMaxHeight = heightPt - padding * 2
  const dims = pdfImg.scaleToFit(barcodeMaxWidth, barcodeMaxHeight)
  page.drawImage(pdfImg, {
    x: widthPt - dims.width - padding,
    y: (heightPt - dims.height) / 2,
    width: dims.width,
    height: dims.height,
  })
}

async function drawLabelB(ctx: DrawCtx, data: LabelData) {
  const { page, font, fontBold, widthPt, heightPt } = ctx
  // 30x18mm: muito apertado. Layout vertical: nome topo, ref, preço, barcode
  const padding = 1 * MM_TO_PT

  const nameSize = 5
  const refSize = 5
  const priceSize = 7

  let cursorY = heightPt - padding - nameSize
  page.drawText(truncate(data.name.toUpperCase(), 14), {
    x: padding,
    y: cursorY,
    size: nameSize,
    font,
  })
  cursorY -= nameSize + 1

  page.drawText(data.supplier_reference ?? '', {
    x: padding,
    y: cursorY,
    size: refSize,
    font,
  })
  cursorY -= refSize + 1

  page.drawText(formatBRL(data.sale_price), {
    x: padding,
    y: cursorY,
    size: priceSize,
    font: fontBold,
  })

  // Barcode embaixo, ocupa o resto do espaço
  const png = await barcodePng(data.barcode_number, { scale: 2, height: 5, includetext: true })
  const pdfImg = await page.doc.embedPng(png)
  const maxW = widthPt - padding * 2
  const maxH = cursorY - padding - priceSize
  const dims = pdfImg.scaleToFit(maxW, maxH)
  page.drawImage(pdfImg, {
    x: (widthPt - dims.width) / 2,
    y: padding,
    width: dims.width,
    height: dims.height,
  })
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text
}

export async function generateLabelsPdf(format: LabelFormat, items: LabelItem[]): Promise<Uint8Array> {
  if (items.length === 0) throw new Error('Nenhum item para imprimir')

  const dim = DIM[format]
  const widthPt = dim.widthMm * MM_TO_PT
  const heightPt = dim.heightMm * MM_TO_PT

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Expandir itens pela quantidade: cada cópia = 1 página
  const expanded = items.flatMap(item =>
    Array.from({ length: item.quantity }, () => item)
  )

  for (const item of expanded) {
    const page = pdf.addPage([widthPt, heightPt])
    const ctx: DrawCtx = { page, font, fontBold, widthPt, heightPt }
    if (format === 'A') await drawLabelA(ctx, item)
    else await drawLabelB(ctx, item)
  }

  return await pdf.save()
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function openPdfInNewTab(bytes: Uint8Array): Promise<Window | null> {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return win
}
