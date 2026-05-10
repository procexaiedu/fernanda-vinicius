'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ExternalLink, AlertTriangle, RefreshCw, CheckCircle, Clock, Trash2, X, Package, CreditCard } from 'lucide-react'
import Button from '@/components/ui/Button'
import styles from './ComprasClient.module.css'
import { buscarDetalheCompra, deletarCompra } from './actions'
import type { PurchaseDetail } from './actions'

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

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4)
}

function methodLabel(m: string) {
  return { pix: 'PIX', cash: 'Dinheiro', transfer: 'Transferência', credit: 'Crédito' }[m] ?? m
}

// ─── Modal de detalhe ──────────────────────────────────────────────────────────

function DetalheModal({ purchaseId, onClose, onDeleted }: {
  purchaseId: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [detail, setDetail] = useState<PurchaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    buscarDetalheCompra(purchaseId).then(({ data }) => {
      setDetail(data)
      setLoading(false)
    })
  }, [purchaseId])

  async function handleDelete() {
    setDeleting(true)
    const r = await deletarCompra(purchaseId)
    setDeleting(false)
    if (r.success) { onDeleted(); onClose() }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h2 className={styles.modalTitle}>Detalhe da Compra</h2>
            {detail && (
              <p className={styles.modalSubtitle}>
                {fmtDate(detail.purchase_date)}
                {detail.nf_number && <> · NF {detail.nf_number}</>}
                {detail.nf_url && (
                  <a href={detail.nf_url} target="_blank" rel="noreferrer" className={styles.nfLink} style={{ marginLeft: 6 }}>
                    <ExternalLink size={11} /> Ver NF
                  </a>
                )}
              </p>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? (
          <div className={styles.modalLoading}>Carregando...</div>
        ) : !detail ? (
          <div className={styles.modalLoading}>Erro ao carregar.</div>
        ) : (
          <>
            {detail.notes && (
              <div className={styles.notesBox}>{detail.notes}</div>
            )}

            {/* Itens */}
            <div className={styles.modalSection}>
              <div className={styles.modalSectionTitle}><Package size={13} /> Itens ({detail.items.length})</div>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Fornecedor</th>
                    <th>Categoria</th>
                    <th>Material</th>
                    <th>Loja</th>
                    <th>Código</th>
                    <th>Etiq.</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Custo unit.</th>
                    <th style={{ textAlign: 'right' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map(item => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 500 }}>{item.product_name}</td>
                      <td className={styles.muted}>{item.supplier_name}</td>
                      <td className={styles.muted} style={{ textTransform: 'capitalize' }}>{item.category}</td>
                      <td className={styles.muted} style={{ textTransform: 'capitalize' }}>{item.material}</td>
                      <td className={styles.muted}>{item.store_name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{item.code}</td>
                      <td className={styles.muted}>{item.label_format}</td>
                      <td style={{ textAlign: 'right' }} className={styles.muted}>{item.quantity}</td>
                      <td style={{ textAlign: 'right' }} className={styles.muted}>{fmt(item.unit_cost)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11, padding: '8px 12px', fontWeight: 600 }}>CUSTO TOTAL</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, padding: '8px 12px', color: 'var(--accent)' }}>{fmt(detail.total_cost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Pagamentos */}
            {detail.payments.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionTitle}><CreditCard size={13} /> Pagamentos</div>
                <table className={styles.detailTable}>
                  <thead>
                    <tr>
                      <th>Método</th>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.map(pay => (
                      <tr key={pay.id}>
                        <td>{methodLabel(pay.payment_method)}</td>
                        <td className={styles.muted}>{pay.installment_number ? `Parcela ${pay.installment_number}` : '—'}</td>
                        <td className={styles.muted}>{fmtDate(pay.due_date)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(pay.amount)}</td>
                        <td>
                          {pay.status === 'completed'
                            ? <span className={styles.statusPaid}><CheckCircle size={11} /> Pago</span>
                            : <span className={styles.statusPending}><Clock size={11} /> Pendente</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Ações */}
            <div className={styles.modalActions}>
              {!confirmDelete ? (
                <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={13} /> Excluir compra
                </button>
              ) : (
                <div className={styles.confirmDelete}>
                  <AlertTriangle size={13} />
                  <span>Excluir também reverte o estoque. Confirma?</span>
                  <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Excluindo...' : 'Sim, excluir'}
                  </button>
                  <button className={styles.cancelBtn} onClick={() => setConfirmDelete(false)}>Cancelar</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ComprasClient({ purchases, consignments }: Props) {
  const router = useRouter()
  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'purchase' | 'consignment'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending' | 'active'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
          <select className={styles.filter} value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}>
            <option value="all">Todos os tipos</option>
            <option value="purchase">Compras próprias</option>
            <option value="consignment">Consignações</option>
          </select>
          <select className={styles.filter} value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">Todos os status</option>
            <option value="paid">Pago</option>
            <option value="pending">Pendente</option>
            <option value="active">Consig. ativa</option>
          </select>
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
                <th>Data</th>
                <th>Tipo</th>
                <th>Fornecedores</th>
                <th>Lojas</th>
                <th>NF</th>
                <th style={{ textAlign: 'right' }}>Itens</th>
                <th style={{ textAlign: 'right' }}>Custo total</th>
                <th>Status</th>
                <th>Prazo devolução</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                if (row.type === 'purchase') {
                  return (
                    <tr
                      key={row.id}
                      className={`${styles.row} ${styles.rowClickable}`}
                      onClick={() => setSelectedId(row.id)}
                      title="Clique para ver detalhes"
                    >
                      <td className={styles.date}>{fmtDate(row.purchase_date)}</td>
                      <td><span className={styles.badgeMuted}>Própria</span></td>
                      <td className={styles.suppliers}>
                        {row.suppliers.length > 0
                          ? row.suppliers.join(', ')
                          : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.muted}>
                        {row.storeNames.length > 0 ? row.storeNames.join(', ') : '—'}
                      </td>
                      <td>
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
                      <td style={{ textAlign: 'right' }} className={styles.muted}>{row.total_items}</td>
                      <td style={{ textAlign: 'right' }} className={styles.cost}>{fmt(row.total_cost)}</td>
                      <td>
                        {row.paymentStatus === 'paid'
                          ? <span className={styles.statusPaid}><CheckCircle size={12} /> Pago</span>
                          : <span className={styles.statusPending}><Clock size={12} /> Pendente</span>}
                      </td>
                      <td className={styles.muted}>—</td>
                    </tr>
                  )
                } else {
                  const isOverdue = row.return_deadline && row.return_deadline < new Date().toISOString().slice(0, 10)
                  return (
                    <tr key={row.id} className={styles.row}>
                      <td className={styles.date}>{fmtDate(row.received_date)}</td>
                      <td><span className={styles.badgeAccent}>Consignação</span></td>
                      <td className={styles.muted}>—</td>
                      <td className={styles.muted}>{row.storeName}</td>
                      <td className={styles.muted}>—</td>
                      <td style={{ textAlign: 'right' }} className={styles.muted}>{row.total_pieces}</td>
                      <td style={{ textAlign: 'right' }} className={styles.cost}>{fmt(row.total_cost_value)}</td>
                      <td>
                        {row.status === 'active'
                          ? <span className={styles.statusActive}><RefreshCw size={12} /> Ativa</span>
                          : row.status === 'settled'
                          ? <span className={styles.statusPaid}><CheckCircle size={12} /> Acertada</span>
                          : <span className={styles.muted}>Devolvida</span>}
                      </td>
                      <td>
                        {row.return_deadline
                          ? <span style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-secondary)', fontSize: 13 }}>
                              {isOverdue && <AlertTriangle size={11} style={{ marginRight: 4 }} />}
                              {fmtDate(row.return_deadline)}
                            </span>
                          : <span className={styles.muted}>—</span>}
                      </td>
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
        <DetalheModal
          purchaseId={selectedId}
          onClose={() => setSelectedId(null)}
          onDeleted={() => router.refresh()}
        />
      )}
    </div>
  )
}
