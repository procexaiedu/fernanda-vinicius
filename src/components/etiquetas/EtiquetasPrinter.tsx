'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Printer, AlertCircle, CheckCircle2, Loader2, Download, RotateCw, Search } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
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
  category?: string
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
  const [displayQty, setDisplayQty] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  useEffect(() => {
    if (isOpen) {
      setItems(initialItems)
      setStateA(INITIAL_FORMAT_STATE)
      setStateB(INITIAL_FORMAT_STATE)
      setDisplayQty({})
      setSelectedIds(new Set(initialItems.map(it => it.id))) // abre tudo marcado
      setSearch('')
      setCategoryFilter('')
    }
  }, [isOpen, initialItems])

  // Categorias distintas para o filtro (ordenadas)
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) if (it.category) set.add(it.category)
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [items])

  // Itens visíveis após busca (nome ou ref) + filtro de categoria
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(it => {
      if (categoryFilter && it.category !== categoryFilter) return false
      if (q) {
        const hit = it.name.toLowerCase().includes(q) ||
          (it.supplier_reference ?? '').toLowerCase().includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [items, search, categoryFilter])

  // Impressão considera apenas itens SELECIONADOS (independe do filtro visível)
  const expanded = useMemo(() => expandItems(items, selectedIds), [items, selectedIds])
  const totalA = expanded.A.length
  const totalB = expanded.B.length

  // Contador: itens selecionados com quantidade > 0
  const selectedCount = useMemo(
    () => items.filter(it => selectedIds.has(it.id) && it.quantity > 0).length,
    [items, selectedIds],
  )

  function updateQty(id: string, qty: number) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, quantity: Math.max(0, qty) } : it)))
  }

  function toggleFormat(id: string) {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, label_format: it.label_format === 'A' ? 'B' : 'A' } : it)))
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Marca/desmarca todos os itens VISÍVEIS no filtro atual
  function toggleAllVisible() {
    const allSelected = visibleItems.length > 0 && visibleItems.every(it => selectedIds.has(it.id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const it of visibleItems) {
        if (allSelected) next.delete(it.id)
        else next.add(it.id)
      }
      return next
    })
  }

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every(it => selectedIds.has(it.id))
  const someVisibleSelected = visibleItems.some(it => selectedIds.has(it.id))
  const headerRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someVisibleSelected && !allVisibleSelected
  }, [someVisibleSelected, allVisibleSelected])

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
            <div className={styles.toolbar}>
              <div className={styles.searchWrapper}>
                <Search size={15} className={styles.searchIcon} />
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Buscar por nome ou ref…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              {categories.length > 0 && (
                <SearchableSelect
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={categories.map(c => ({ value: c, label: c }))}
                  placeholder="Todas as categorias"
                  className={styles.categorySelect}
                />
              )}
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.checkCol}>
                      <input
                        ref={headerRef}
                        type="checkbox"
                        className={styles.checkbox}
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        disabled={visibleItems.length === 0}
                        title="Selecionar/desmarcar todos os itens visíveis"
                      />
                    </th>
                    <th>Produto</th>
                    <th>Ref.</th>
                    <th className={styles.numCol}>Preço</th>
                    <th className={styles.numCol}>Formato</th>
                    <th className={styles.numCol}>Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={styles.tableEmpty}>Nenhum produto encontrado.</td>
                    </tr>
                  ) : visibleItems.map(it => {
                    const selected = selectedIds.has(it.id)
                    return (
                      <tr key={it.id} className={selected ? '' : styles.rowUnselected}>
                        <td className={styles.checkCol}>
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={selected}
                            onChange={() => toggleSelect(it.id)}
                          />
                        </td>
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
                            disabled={!selected}
                            value={displayQty[it.id] ?? String(it.quantity)}
                            onChange={e => {
                              setDisplayQty(prev => ({ ...prev, [it.id]: e.target.value }))
                              const n = parseInt(e.target.value, 10)
                              if (!isNaN(n)) updateQty(it.id, Math.max(0, n))
                            }}
                            onBlur={e => {
                              setDisplayQty(prev => { const next = { ...prev }; delete next[it.id]; return next })
                              if (e.target.value === '' || isNaN(parseInt(e.target.value, 10))) updateQty(it.id, 0)
                            }}
                            onFocus={e => e.target.select()}
                            className={styles.qtyInput}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.tableFooter}>
              <p className={styles.hint}>
                Marque os produtos e ajuste a quantidade. Imprima A e B separadamente —
                você escolhe qual rolo está na impressora.
              </p>
              <span className={styles.selectedCount}>
                {selectedCount} de {items.length} selecionado{selectedCount === 1 ? '' : 's'}
              </span>
            </div>
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

function expandItems(items: EtiquetasPrinterItem[], selectedIds: Set<string>): { A: LabelData[]; B: LabelData[] } {
  const A: LabelData[] = []
  const B: LabelData[] = []
  for (const it of items) {
    if (!selectedIds.has(it.id)) continue
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
