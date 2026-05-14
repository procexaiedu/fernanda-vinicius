'use client'

import { useState } from 'react'
import { generateLabelsPdf, openPdfInNewTab, downloadPdf, type LabelItem } from '@/lib/etiquetas/generator'
import styles from './poc.module.css'

const SAMPLE_A: LabelItem[] = [
  { name: 'BROCHE FLOR', supplier_reference: 'FWG04329', sale_price: 129.00, barcode_number: '15112', quantity: 1 },
  { name: 'COLAR PEROLA', supplier_reference: 'FCP00821', sale_price: 89.90, barcode_number: '15113', quantity: 1 },
  { name: 'ANEL ZIRCONIA', supplier_reference: 'FAZ12044', sale_price: 65.00, barcode_number: '15114', quantity: 1 },
]

const SAMPLE_B: LabelItem[] = [
  { name: 'BRINCO FLOR', supplier_reference: 'FZA09245', sale_price: 98.00, barcode_number: '12519', quantity: 1 },
  { name: 'BRINCO PEROLA', supplier_reference: 'FZB00731', sale_price: 75.00, barcode_number: '12520', quantity: 1 },
  { name: 'CONJUNTO LUA', supplier_reference: 'FZC44120', sale_price: 145.00, barcode_number: '12521', quantity: 1 },
]

export default function EtiquetasPocPage() {
  const [busy, setBusy] = useState<'A' | 'B' | null>(null)
  const [mode, setMode] = useState<'open' | 'download'>('open')

  async function handleGenerate(format: 'A' | 'B') {
    try {
      setBusy(format)
      const items = format === 'A' ? SAMPLE_A : SAMPLE_B
      const bytes = await generateLabelsPdf(format, items)
      const filename = `etiqueta-${format}-poc-${Date.now()}.pdf`
      if (mode === 'open') await openPdfInNewTab(bytes)
      else downloadPdf(bytes, filename)
    } catch (err) {
      console.error(err)
      alert('Erro ao gerar PDF: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>POC — Impressão de Etiquetas</h1>
        <p className={styles.subtitle}>
          Validação visual da geração PDF + Code128 antes de construir a feature completa.
          Gere as etiquetas de teste, imprima na Argox OS-214 Plus e compare com as etiquetas originais.
        </p>
      </header>

      <section className={styles.modeRow}>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="mode"
            value="open"
            checked={mode === 'open'}
            onChange={() => setMode('open')}
          />
          Abrir em nova aba (recomendado — imprime direto)
        </label>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="mode"
            value="download"
            checked={mode === 'download'}
            onChange={() => setMode('download')}
          />
          Baixar PDF
        </label>
      </section>

      <section className={styles.cards}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.tag}>A</span>
            <h2>Etiqueta 90 × 13 mm</h2>
          </div>
          <p className={styles.cardDesc}>
            Tag comprida — usada em anel, colar, pulseira, broche, tornozeleira.
            Layout: nome + referência + preço à esquerda, código de barras à direita.
          </p>
          <ul className={styles.sampleList}>
            {SAMPLE_A.map((item) => (
              <li key={item.barcode_number}>
                <span className={styles.sampleName}>{item.name}</span>
                <span className={styles.sampleMeta}>{item.supplier_reference} · R$ {item.sale_price.toFixed(2).replace('.', ',')} · #{item.barcode_number}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={busy !== null}
            onClick={() => handleGenerate('A')}
          >
            {busy === 'A' ? 'Gerando…' : 'Gerar Etiqueta A de teste'}
          </button>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={`${styles.tag} ${styles.tagB}`}>B</span>
            <h2>Etiqueta 30 × 18 mm</h2>
          </div>
          <p className={styles.cardDesc}>
            Etiqueta pequena — usada em brinco, bolsa, conjunto, piercing.
            Layout vertical: nome no topo, referência, preço, barcode embaixo.
          </p>
          <ul className={styles.sampleList}>
            {SAMPLE_B.map((item) => (
              <li key={item.barcode_number}>
                <span className={styles.sampleName}>{item.name}</span>
                <span className={styles.sampleMeta}>{item.supplier_reference} · R$ {item.sale_price.toFixed(2).replace('.', ',')} · #{item.barcode_number}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={busy !== null}
            onClick={() => handleGenerate('B')}
          >
            {busy === 'B' ? 'Gerando…' : 'Gerar Etiqueta B de teste'}
          </button>
        </article>
      </section>

      <section className={styles.tip}>
        <h3>Antes de imprimir — configuração one-time do driver Argox</h3>
        <ol>
          <li>Painel de Controle do Windows → Dispositivos e Impressoras → Argox OS-214 Plus → <strong>Preferências de Impressão</strong>.</li>
          <li>Aba <strong>Página</strong>: crie 2 tamanhos personalizados:
            <ul>
              <li><strong>Etiqueta A</strong>: 90 × 13 mm, 1 coluna</li>
              <li><strong>Etiqueta B</strong>: 30 × 18 mm, 3 colunas (gutter ~3 mm)</li>
            </ul>
          </li>
          <li>Aba <strong>Opções</strong>: Velocidade 2-3 ips, Densidade 10, Sensor: Gap</li>
          <li>Margens: 0 (zero) em todos os lados</li>
          <li>Salve e use ao escolher a impressora no diálogo de impressão.</li>
        </ol>
      </section>
    </div>
  )
}
