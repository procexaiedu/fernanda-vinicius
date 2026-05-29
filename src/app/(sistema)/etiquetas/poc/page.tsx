'use client'

import { useMemo, useState } from 'react'
import { buildJob, type LabelData, type LabelFormat } from '@/lib/etiquetas/ppla'
import { useLocalPrintAgent } from '@/lib/etiquetas/useLocalPrintAgent'
import { printJob } from '@/lib/etiquetas/printAgent'
import styles from './poc.module.css'

/**
 * Amostras EXATAS dos apêndices A e B do IMPRESSAO_ETIQUETAS.md.
 * Ao gerar com os botões abaixo, os bytes devem bater com os hex dumps
 * dos apêndices (Apêndice A = 155 bytes, Apêndice B normalizado = 345 bytes).
 */
const SAMPLE_A: LabelData[] = [
  { name: 'P COLAR MOISSANITE', supplier_reference: 'FSO05429', sale_price: 1072.00, barcode_number: '15519' },
]

const SAMPLE_B: LabelData[] = [
  { name: 'BRINCO CITRINO', supplier_reference: 'FZA05599', sale_price: 188.00, barcode_number: '15521' },
  { name: 'BRINCO STAR',    supplier_reference: 'FZA05595', sale_price: 168.00, barcode_number: '15520' },
  { name: 'BRINCO TORRE',   supplier_reference: 'FSP0560',  sale_price: 422.00, barcode_number: '15522' },
]

function bytesToHex(bytes: Uint8Array, perLine = 16): string {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += perLine) {
    const chunk = bytes.slice(i, i + perLine)
    out.push(Array.from(chunk, b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '))
  }
  return out.join('\n')
}

function downloadPrn(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function EtiquetasPocPage() {
  const agent = useLocalPrintAgent()
  const [generated, setGenerated] = useState<{ format: LabelFormat; bytes: Uint8Array } | null>(null)
  const [printing, setPrinting] = useState(false)
  const [printMsg, setPrintMsg] = useState<string | null>(null)
  const [printErr, setPrintErr] = useState<string | null>(null)

  function handleGenerate(format: LabelFormat) {
    const produtos = format === 'A' ? SAMPLE_A : SAMPLE_B
    const bytes = buildJob(format, produtos)
    setGenerated({ format, bytes })
    setPrintMsg(null)
    setPrintErr(null)
  }

  async function handlePrint() {
    if (!generated || !agent.selectedPrinter) return
    setPrinting(true)
    setPrintMsg(null)
    setPrintErr(null)
    try {
      const r = await printJob(
        agent.selectedPrinter,
        generated.bytes,
        `POC Layout ${generated.format}`,
      )
      setPrintMsg(`Enviado para "${agent.selectedPrinter}" — ${r.bytes} bytes (job ${r.jobId}).`)
    } catch (err) {
      setPrintErr((err as Error).message)
    } finally {
      setPrinting(false)
    }
  }

  const hex = useMemo(() => (generated ? bytesToHex(generated.bytes) : ''), [generated])

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>POC — Gerador PPLA</h1>
        <p className={styles.subtitle}>
          Gera o stream PPLA bruto (idêntico ao Hiper Loja) para validação contra os
          apêndices A e B do <code>IMPRESSAO_ETIQUETAS.md</code>. Use o botão{' '}
          <strong>Imprimir agora</strong> para enviar diretamente à Argox via{' '}
          <code>fv-print-agent</code>, ou baixe o <code>.prn</code> para inspeção.
        </p>
        <AgentBadge agent={agent} />
      </header>

      <section className={styles.cards}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.tag}>A</span>
            <h2>Etiqueta 90 × 13 mm</h2>
          </div>
          <p className={styles.cardDesc}>
            Tag comprida — anel, colar, pulseira, broche, tornozeleira. 1 etiqueta por linha física.
            Saída esperada: <strong>155 bytes</strong>, idêntica ao Apêndice A do doc.
          </p>
          <ul className={styles.sampleList}>
            {SAMPLE_A.map((item) => (
              <li key={item.barcode_number}>
                <span className={styles.sampleName}>{item.name}</span>
                <span className={styles.sampleMeta}>
                  {item.supplier_reference} · R$ {item.sale_price.toFixed(2).replace('.', ',')} · #{item.barcode_number}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.btnPrimary} onClick={() => handleGenerate('A')}>
            Gerar Layout A
          </button>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={`${styles.tag} ${styles.tagB}`}>B</span>
            <h2>Etiqueta 30 × 18 mm</h2>
          </div>
          <p className={styles.cardDesc}>
            Etiqueta pequena — brinco, bolsa, conjunto, piercing. 3 etiquetas lado a lado por linha física.
            Saída esperada: <strong>345 bytes</strong> (versão normalizada do Apêndice B).
          </p>
          <ul className={styles.sampleList}>
            {SAMPLE_B.map((item) => (
              <li key={item.barcode_number}>
                <span className={styles.sampleName}>{item.name}</span>
                <span className={styles.sampleMeta}>
                  {item.supplier_reference} · R$ {item.sale_price.toFixed(2).replace('.', ',')} · #{item.barcode_number}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.btnPrimary} onClick={() => handleGenerate('B')}>
            Gerar Layout B
          </button>
        </article>
      </section>

      {generated && (
        <section className={styles.tip}>
          <h3>
            Stream PPLA — Layout {generated.format} — {generated.bytes.length} bytes
          </h3>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handlePrint}
              disabled={printing || agent.status !== 'online' || !agent.selectedPrinter}
              title={agent.status !== 'online' ? 'Agente offline' : agent.selectedPrinter ?? ''}
            >
              {printing
                ? 'Enviando…'
                : `Imprimir agora${agent.selectedPrinter ? ` em "${agent.selectedPrinter}"` : ''}`}
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => downloadPrn(generated.bytes, `etiqueta-${generated.format}-${Date.now()}.prn`)}
            >
              Baixar .prn
            </button>
          </div>

          {printMsg && <div className={styles.successMsg}>✓ {printMsg}</div>}
          {printErr && <div className={styles.errorMsg}>✗ {printErr}</div>}

          <pre className={styles.hexBlock}>{hex}</pre>
        </section>
      )}
    </div>
  )
}

function AgentBadge({ agent }: { agent: ReturnType<typeof useLocalPrintAgent> }) {
  if (agent.status === 'checking') {
    return <div className={styles.agentBadge}>Procurando agente…</div>
  }
  if (agent.status === 'offline') {
    return (
      <div className={`${styles.agentBadge} ${styles.agentOffline}`}>
        Agente offline — verifique em <code>/configuracoes/impressao</code>
      </div>
    )
  }
  return (
    <div className={`${styles.agentBadge} ${styles.agentOnline}`}>
      Agente online · imprimindo em <strong>{agent.selectedPrinter ?? '—'}</strong>
    </div>
  )
}
