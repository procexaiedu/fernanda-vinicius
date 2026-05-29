'use client'

import { useEffect, useMemo, useState } from 'react'
import { Printer, AlertCircle, CheckCircle2, Loader2, Download, RotateCw } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { buildJob, type LabelFormat, type LabelData } from '@/lib/etiquetas/ppla'
import { useLocalPrintAgent } from '@/lib/etiquetas/useLocalPrintAgent'
import { printJob } from '@/lib/etiquetas/printAgent'
import styles from './EtiquetasPrinter.module.css'

export interface EtiquetasPrinterItem {
  id: string
  name: string
  supplier_reference: string | null
  sale_price: number
  barcode_number: string
  label_format: LabelFormat
  quantity: number
}

interface EtiquetasPrinterProps {
  isOpen: boolean
  onClose: () => void
  initialItems: EtiquetasPrinterItem[]
  title?: string
}

/** Estado de impressão de um formato (A ou B), independente do outro. */
interface FormatState {
  printing: boolean
  printedOnce: boolean
  lastJobId: number | null
  error: string | null
}

const INITIAL_FORMAT_STATE: FormatState = {
  printing: false,
  printedOnce: false,
  lastJobId: null,
  error: null,
}

export default function EtiquetasPrinter({ isOpen, onClose, initialItems, title }: EtiquetasPrinterProps) {
  const agent = useLocalPrintAgent()
  const [items, setItems] = useState<EtiquetasPrinterItem[]>(initialItems)
  const [stateA, setStateA] = useState<FormatState>(INITIAL_FORMAT_STATE)
  const [stateB, setStateB] = useState<FormatState>(INITIAL_FORMAT_STATE)

  useEffect(() => {
    if (isOpen) {
      setItems(initialItems)
      setStateA(INITIAL_FORMAT_STATE)
      setStateB(INITIAL_FORMAT_STATE)
    }
  }, [isOpen, initialItems])

  const expanded = useMemo(() => expandItems(items), [items])
  const totalA = expanded.A.length
  const totalB = expanded.B.length

  function updateQty(id: string, qty: number) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, quantity: Math.max(0, qty) } : it)))
  }

  function toggleFormat(id: string) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, label_format: it.label_format === 'A' ? 'B' : 'A' } : it)))
  }

  async function imprimir(format: LabelFormat) {
    const produtos = format === 'A' ? expanded.A : expanded.B
    const setState = format === 'A' ? setStateA : setStateB
    if (produtos.length === 0 || !agent.selectedPrinter) return

    setState(s => ({ ...s, printing: true, error: null }))
    try {
      const bytes = buildJob(format, produtos)
      const result = await printJob(
        agent.selectedPrinter,
        bytes,
        `Etiquetas ${format} — ${produtos.length} unidades`,
      )
      setState({ printing: false, printedOnce: true, lastJobId: result.jobId, error: null })
    } catch (err) {
      setState(s => ({ ...s, printing: false, error: (err as Error).message }))
    }
  }

  function baixarPrn(format: LabelFormat) {
    const produtos = format === 'A' ? expanded.A : expanded.B
    if (produtos.length === 0) return
    const bytes = buildJob(format, produtos)
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `etiquetas-${format}-${Date.now()}.prn`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const agentReady = agent.status === 'online' && !!agent.selectedPrinter

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title ?? 'Imprimir etiquetas'} size="xl">
      <div className={styles.container}>
        <AgentStatusBar agent={agent} />

        {items.length === 0 ? (
          <p className={styles.emptyMsg}>Nenhum produto para imprimir.</p>
        ) : (
          <>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Ref.</th>
                    <th className={styles.numCol}>Preço</th>
                    <th className={styles.numCol}>Formato</th>
                    <th className={styles.numCol}>Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.id}>
                      <td className={styles.nameCell}>{it.name}</td>
                      <td className={styles.refCell}>{it.supplier_reference ?? '—'}</td>
                      <td className={styles.numCol}>{formatBRL(it.sale_price)}</td>
                      <td className={styles.numCol}>
                        <button
                          type="button"
                          className={`${styles.formatBtn} ${it.label_format === 'A' ? styles.formatA : styles.formatB}`}
                          onClick={() => toggleFormat(it.id)}
                          title="Clique para alternar entre A (90×13) e B (30×18)"
                        >
                          {it.label_format}
                        </button>
                      </td>
                      <td className={styles.numCol}>
                        <input
                          type="number"
                          min={0}
                          value={it.quantity}
                          onChange={e => updateQty(it.id, parseInt(e.target.value || '0', 10))}
                          className={styles.qtyInput}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.hint}>
              Ajuste a quantidade (zere o que não quer imprimir) e o formato de cada produto.
              Imprima A e B separadamente — você escolhe qual rolo está na impressora.
            </p>
          </>
        )}

        <div className={styles.formatCards}>
          <FormatCard
            format="A"
            label="90 × 13 mm"
            total={totalA}
            state={stateA}
            agentReady={agentReady}
            onPrint={() => imprimir('A')}
            onDownload={() => baixarPrn('A')}
          />
          <FormatCard
            format="B"
            label="30 × 18 mm"
            total={totalB}
            state={stateB}
            agentReady={agentReady}
            onPrint={() => imprimir('B')}
            onDownload={() => baixarPrn('B')}
          />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* --------------------- Subcomponentes --------------------- */

function FormatCard({
  format, label, total, state, agentReady, onPrint, onDownload,
}: {
  format: LabelFormat
  label: string
  total: number
  state: FormatState
  agentReady: boolean
  onPrint: () => void
  onDownload: () => void
}) {
  const disabled = total === 0 || !agentReady || state.printing
  const tagClass = format === 'A' ? styles.formatA : styles.formatB

  return (
    <div className={`${styles.formatCard} ${total === 0 ? styles.formatCardEmpty : ''}`}>
      <div className={styles.formatCardHeader}>
        <span className={`${styles.formatTag} ${tagClass}`}>{format}</span>
        <div className={styles.formatCardInfo}>
          <strong>Layout {format}</strong>
          <span>{label}</span>
        </div>
        <span className={styles.formatCount}>{total}</span>
      </div>

      <div className={styles.formatCardActions}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onPrint}
          disabled={disabled}
        >
          {state.printing ? (
            <><Loader2 size={15} className={styles.spin} /> Enviando…</>
          ) : state.printedOnce ? (
            <><RotateCw size={15} /> Reimprimir {format} ({total})</>
          ) : (
            <><Printer size={15} /> Imprimir {format} ({total})</>
          )}
        </button>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={onDownload}
          disabled={total === 0}
          title="Baixar .prn para inspeção"
        >
          <Download size={14} />
        </button>
      </div>

      {state.printedOnce && !state.error && (
        <div className={styles.formatStatusOk}>
          <CheckCircle2 size={13} /> Enviado{state.lastJobId !== null ? ` (${state.lastJobId} bytes)` : ''}
        </div>
      )}
      {state.error && (
        <div className={styles.formatStatusErr}>
          <AlertCircle size={13} /> {state.error}
        </div>
      )}
    </div>
  )
}

function AgentStatusBar({ agent }: { agent: ReturnType<typeof useLocalPrintAgent> }) {
  if (agent.status === 'checking') {
    return (
      <div className={`${styles.statusBar} ${styles.statusChecking}`}>
        <Loader2 size={14} className={styles.spin} />
        <span>Procurando agente de impressão…</span>
      </div>
    )
  }

  if (agent.status === 'offline') {
    return (
      <div className={`${styles.statusBar} ${styles.statusOffline}`}>
        <AlertCircle size={14} />
        <div className={styles.statusContent}>
          <strong>Agente de impressão não encontrado.</strong>
          <p>
            Instale e execute o <code>fv-print-agent</code> nesta máquina para imprimir.{' '}
            <a href="/configuracoes/impressao" className={styles.statusLink}>Configurar agora →</a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.statusBar} ${styles.statusOnline}`}>
      <CheckCircle2 size={14} />
      <div className={styles.statusContent}>
        <strong>Agente conectado</strong>
        <p>
          Impressora:{' '}
          <select
            value={agent.selectedPrinter ?? ''}
            onChange={e => agent.setSelectedPrinter(e.target.value || null)}
            className={styles.printerSelect}
          >
            {agent.printers.map(p => (
              <option key={p.name} value={p.name}>
                {p.name}{p.isDefault ? ' (padrão)' : ''}
              </option>
            ))}
          </select>
        </p>
      </div>
    </div>
  )
}

/* --------------------- Helpers --------------------- */

function expandItems(items: EtiquetasPrinterItem[]): { A: LabelData[]; B: LabelData[] } {
  const A: LabelData[] = []
  const B: LabelData[] = []
  for (const it of items) {
    for (let i = 0; i < it.quantity; i++) {
      const data: LabelData = {
        name: it.name,
        supplier_reference: it.supplier_reference,
        sale_price: it.sale_price,
        barcode_number: it.barcode_number,
      }
      if (it.label_format === 'A') A.push(data)
      else B.push(data)
    }
  }
  return { A, B }
}

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}
