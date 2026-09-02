'use client'

import { usePersistedState } from '@/hooks/usePersistedState'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ExternalLink, AlertTriangle, RefreshCw, CheckCircle, Clock, Printer } from 'lucide-react'
import Button from '@/components/ui/Button'
import CompraDetalheModal from '@/components/compra/CompraDetalheModal'
import EtiquetasPrinter, { type EtiquetasPrinterItem } from '@/components/etiquetas/EtiquetasPrinter'
import { getItensCompraParaEtiquetas } from './actions'
import ThOrdenavel from '@/components/ui/ThOrdenavel'
import { useOrdenacao } from '@/hooks/useOrdenacao'
import styles from './ComprasClient.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'
import SearchableSelect from '@/components/ui/SearchableSelect'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Purchase {
  id: string
  purchase_date: string
  total_cost: number
  total_items: number
  nf_number: string | null
  nf_url: string | null
  notes: string | null
  created_at: string
  suppliers: string[]
  supplierInitials: string[]
  storeNames: string[]
  paymentStatus: 'paid' | 'pending'
  type: 'purchase'
}

interface Consignment {
  id: string
  received_date: string
  return_deadline: string | null
  total_pieces: number
  total_cost_value: number
  status: 'active' | 'settled' | 'returned'
  supplier_id: string | null
  store_id: string | null
  storeName: string
  type: 'consignment'
}

interface Props {
  purchases:    Purchase[]
  consignments: Consignment[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/* Dinheiro: um formatador só para o sistema — ver src/lib/dinheiro.ts */
const fmt = formatarDinheiro

function fmtDate(s: string) {
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4)
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ComprasClient({ purchases, consignments }: Props) {
  const router = useRouter()
  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'purchase' | 'consignment'>('all')
  const [statusFilter, setStatusFilter] = usePersistedState<'all' | 'paid' | 'pending' | 'active'>('fv-filtros-compras-status', 'all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reprintOpen, setReprintOpen]   = useState(false)
  const [reprintItems, setReprintItems] = useState<EtiquetasPrinterItem[]>([])

  async function openReprint(e: React.MouseEvent, purchaseId: string) {
    e.stopPropagation()
    const items = await getItensCompraParaEtiquetas(purchaseId)
    // Quantidades já vêm iguais às compradas (purchase_items.quantity);
    // a seleção/ajuste fino é feito dentro do próprio modal.
    setReprintItems(items)
    setReprintOpen(true)
  }

  type Row = (Purchase | Consignment)

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = []
    if (typeFilter !== 'consignment') rows.push(...purchases)
    if (typeFilter !== 'purchase')    rows.push(...consignments)
    return rows.sort((a, b) => {
      const dateA = a.type === 'purchase' ? a.purchase_date : a.received_date
      const dateB = b.type === 'purchase' ? b.purchase_date : b.received_date
      return dateB.localeCompare(dateA)
    })
  }, [purchases, consignments, typeFilter])

  /*
   * Compra e consignação têm nomes de campo diferentes para a mesma ideia (data,
   * itens, custo), então a ordenação precisa normalizar antes de comparar — senão
   * ordenar por "Data" só funcionaria para metade das linhas.
   */
  const dataDaLinha  = (r: Row) => r.type === 'purchase' ? r.purchase_date : r.received_date
  const itensDaLinha = (r: Row) => r.type === 'purchase' ? r.total_items : r.total_pieces
  const custoDaLinha = (r: Row) => r.type === 'purchase' ? r.total_cost : r.total_cost_value

  const filtered = useMemo(() => {
    return allRows.filter(row => {
      if (search) {
        const q = search.toLowerCase()
        if (row.type === 'purchase') {
          const match = row.suppliers.some(s => s.toLowerCase().includes(q)) ||
            (row.nf_number ?? '').toLowerCase().includes(q)
          if (!match) return false
        }
      }
      if (statusFilter !== 'all') {
        if (row.type === 'purchase') {
          if (statusFilter === 'active') return false
          if (statusFilter !== row.paymentStatus) return false
        } else {
          if (statusFilter === 'paid' || statusFilter === 'pending') return false
          if (statusFilter === 'active' && row.status !== 'active') return false
        }
      }
      return true
    })
  }, [allRows, search, statusFilter])

  const ord = useOrdenacao(filtered, {
    data:          { valor: dataDaLinha, tipo: 'data' },
    tipo:          { valor: r => r.type === 'purchase' ? 'Compra' : 'Consignação', tipo: 'texto' },
    fornecedores:  { valor: r => r.type === 'purchase' ? (r.suppliers[0] ?? '') : '', tipo: 'texto' },
    lojas:         { valor: r => r.type === 'purchase' ? (r.storeNames[0] ?? '') : r.storeName, tipo: 'texto' },
    itens:         { valor: itensDaLinha, tipo: 'numero' },
    custo:         { valor: custoDaLinha, tipo: 'numero' },
  })

  const totalCompras  = purchases.length
  const totalConsign  = consignments.filter(c => c.status === 'active').length
  const totalPendente = purchases.filter(p => p.paymentStatus === 'pending')
    .reduce((s, p) => s + p.total_cost, 0)

  return (
    <div>
      {/* Stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Compras registradas</span>
          <span className={styles.statValue}>{totalCompras}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Consignações ativas</span>
          <span className={styles.statValue}>{totalConsign}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>A pagar (compras)</span>
          <span className={styles.statValue} style={{ color: totalPendente > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {fmt(totalPendente)}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <input
            className={styles.search}
            placeholder="Buscar por fornecedor ou NF..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <SearchableSelect
            value={typeFilter}
            onChange={v => setTypeFilter((v || 'all') as typeof typeFilter)}
            options={[
              { value: 'all',         label: 'Todos os tipos' },
              { value: 'purchase',    label: 'Compras próprias' },
              { value: 'consignment', label: 'Consignações' },
            ]}
            placeholder="Todos os tipos"
            searchable={false}
            permitirLimpar={false}
          />
          <SearchableSelect
            value={statusFilter}
            onChange={v => setStatusFilter((v || 'all') as typeof statusFilter)}
            options={[
              { value: 'all',     label: 'Todos os status' },
              { value: 'paid',    label: 'Pago' },
              { value: 'pending', label: 'Pendente' },
              { value: 'active',  label: 'Consig. ativa' },
            ]}
            placeholder="Todos os status"
            searchable={false}
            permitirLimpar={false}
          />
        </div>
        <div className={styles.toolbarRight}>
          <Button size="sm" onClick={() => router.push('/compras/nova')}>
            <Plus size={14} /> Nova Compra
          </Button>
        </div>
      </div>

      {/* Tabela */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>Nenhuma compra encontrada.</p>
          <p className={styles.emptyHint}>Clique em "Nova Compra" para registrar a primeira entrada de estoque.</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <ThOrdenavel ord={ord} coluna="data" className="col-date">Data</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="tipo" className="col-center col-tertiary">Tipo</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="fornecedores">Fornecedores</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="lojas" className="col-secondary">Lojas</ThOrdenavel>
                <th className="col-tertiary">NF</th>
                <ThOrdenavel ord={ord} coluna="itens" className="col-num col-secondary">Itens</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="custo" className="col-num">Custo total</ThOrdenavel>
                <th className="col-center">Status</th>
                <th className="col-tertiary col-date">Prazo devolução</th>
                <th className="col-center" style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {ord.ordenados.map(row => {
                if (row.type === 'purchase') {
                  return (
                    <tr
                      key={row.id}
                      className={`${styles.row} ${styles.rowClickable}`}
                      onClick={() => setSelectedId(row.id)}
                      title="Clique para ver detalhes"
                    >
                      <td className={`${styles.date} col-date`}>{fmtDate(row.purchase_date)}</td>
                      <td className="col-center col-tertiary"><span className={styles.badgeMuted}>Própria</span></td>
                      <td className={styles.suppliers}>
                        {row.suppliers.length > 0
                          ? row.suppliers.length === 1
                            ? row.suppliers[0]
                            : row.supplierInitials.join(' · ')
                          : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={`${styles.muted} col-secondary`}>
                        {row.storeNames.length > 0 ? row.storeNames.join(', ') : '—'}
                      </td>
                      <td className="col-tertiary">
                        {row.nf_number
                          ? <span className={styles.nf}>
                              {row.nf_number}
                              {row.nf_url && (
                                <a href={row.nf_url} target="_blank" rel="noreferrer" className={styles.nfLink} onClick={e => e.stopPropagation()}>
                                  <ExternalLink size={11} />
                                </a>
                              )}
                            </span>
                          : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={`col-num col-secondary ${styles.muted}`}>{row.total_items}</td>
                      <td className={`col-num ${styles.cost}`}>{fmt(row.total_cost)}</td>
                      <td className="col-center">
                        {row.paymentStatus === 'paid'
                          ? <span className={styles.statusPaid}><CheckCircle size={12} /> Pago</span>
                          : <span className={styles.statusPending}><Clock size={12} /> Pendente</span>}
                      </td>
                      <td className={`col-tertiary ${styles.muted}`}>—</td>
                      <td className="col-center">
                        <button
                          className={styles.reprintBtn}
                          title="Reimprimir etiquetas"
                          onClick={e => openReprint(e, row.id)}
                        >
                          <Printer size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                } else {
                  const isOverdue = row.return_deadline && row.return_deadline < new Date().toISOString().slice(0, 10)
                  return (
                    <tr key={row.id} className={styles.row}>
                      <td className={`${styles.date} col-date`}>{fmtDate(row.received_date)}</td>
                      <td className="col-center col-tertiary"><span className={styles.badgeAccent}>Consignação</span></td>
                      <td className={styles.muted}>—</td>
                      <td className={`${styles.muted} col-secondary`}>{row.storeName}</td>
                      <td className={`col-tertiary ${styles.muted}`}>—</td>
                      <td className={`col-num col-secondary ${styles.muted}`}>{row.total_pieces}</td>
                      <td className={`col-num ${styles.cost}`}>{fmt(row.total_cost_value)}</td>
                      <td>
                        {row.status === 'active'
                          ? <span className={styles.statusActive}><RefreshCw size={12} /> Ativa</span>
                          : row.status === 'settled'
                          ? <span className={styles.statusPaid}><CheckCircle size={12} /> Acertada</span>
                          : <span className={styles.muted}>Devolvida</span>}
                      </td>
                      <td className="col-tertiary col-date">
                        {row.return_deadline
                          ? <span style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-secondary)', fontSize: 13 }}>
                              {isOverdue && <AlertTriangle size={11} style={{ marginRight: 4 }} />}
                              {fmtDate(row.return_deadline)}
                            </span>
                          : <span className={styles.muted}>—</span>}
                      </td>
                      <td></td>
                    </tr>
                  )
                }
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de detalhe */}
      {selectedId && (
        <CompraDetalheModal
          purchaseId={selectedId}
          onClose={() => setSelectedId(null)}
          onDeleted={() => router.refresh()}
        />
      )}

      {/* Modal de reimpressão de etiquetas */}
      <EtiquetasPrinter
        isOpen={reprintOpen}
        onClose={() => setReprintOpen(false)}
        initialItems={reprintItems}
        title="Reimprimir etiquetas da compra"
      />
    </div>
  )
}
