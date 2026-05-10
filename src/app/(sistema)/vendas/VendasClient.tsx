'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  ChevronUp, ChevronDown, ArrowLeftRight, AlertTriangle, X,
  BarChart2, Trash2, Receipt,
} from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { buscarDetalheVenda, deletarVenda, type VendaDetail } from './actions'
import type { SaleRow } from './page'
import styles from './VendasClient.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  const date = s.slice(0, 10)   // pega só YYYY-MM-DD mesmo que seja timestamptz
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito',
}

// ─── Modal de detalhe ─────────────────────────────────────────────────────────

function VendaDetalheModal({ saleId, onClose, onDeleted }: {
  saleId: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [venda, setVenda]         = useState<VendaDetail | null>(null)
  const [loading, setLoading]     = useState(true)
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  useEffect(() => {
    buscarDetalheVenda(saleId).then(r => {
      setVenda(r.data)
      setLoading(false)
    })
  }, [saleId])

  async function handleDelete() {
    setDeleting(true)
    setDeleteErr('')
    const res = await deletarVenda(saleId)
    setDeleting(false)
    if (!res.success) { setDeleteErr(res.error ?? 'Erro ao deletar.'); return }
    onDeleted()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <Receipt size={16} />
            Detalhe da Venda
          </div>
          <div className={styles.modalHeaderActions}>
            {!confirmDel ? (
              <button className={styles.deleteBtn} onClick={() => setConfirmDel(true)} title="Excluir venda">
                <Trash2 size={14} />
              </button>
            ) : (
              <div className={styles.deleteConfirm}>
                <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />
                <span>Reverter estoque e excluir?</span>
                <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                  {deleting ? '...' : 'Sim'}
                </button>
                <button className={styles.deleteBtnCancel} onClick={() => setConfirmDel(false)}>Não</button>
              </div>
            )}
            {deleteErr && <span className={styles.deleteError}>{deleteErr}</span>}
            <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className={styles.modalBody}>
          {loading ? (
            <div className={styles.loadingState}>Carregando...</div>
          ) : !venda ? (
            <div className={styles.loadingState}>Venda não encontrada.</div>
          ) : (
            <>
              {/* Cabeçalho */}
              <div className={styles.detailHeader}>
                <div className={styles.detailMeta}>
                  <span className={styles.detailDate}>{fmtDate(venda.sale_date)}</span>
                  <span className={styles.detailSep}>·</span>
                  <span>{venda.store_name}</span>
                  {venda.customer_name && (
                    <>
                      <span className={styles.detailSep}>·</span>
                      <span>{venda.customer_name}</span>
                    </>
                  )}
                </div>
                <Badge variant={venda.status === 'completed' ? 'success' : 'muted'}>
                  {venda.status === 'completed' ? 'Concluída' : venda.status}
                </Badge>
              </div>

              {/* Itens */}
              <div className={styles.detailSection}>
                <div className={styles.detailSectionTitle}>Itens</div>
                <table className={styles.detailTable}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Código</th>
                      <th style={{ textAlign: 'right' }}>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Preço unit.</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venda.items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.product_name}</td>
                        <td className={styles.codeCell}>{item.product_code}</td>
                        <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(item.unit_price)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Descontos */}
              <div className={styles.detailSummary}>
                <div className={styles.summaryLine}>
                  <span>Subtotal</span>
                  <span>{fmt(venda.subtotal)}</span>
                </div>
                {venda.discount_amount > 0 && (
                  <div className={`${styles.summaryLine} ${styles.summaryDiscount}`}>
                    <span>
                      Desconto
                      {venda.discount_type && ` (${venda.discount_type.split(',').map(d =>
                        d === 'pix' ? 'PIX' : d === 'birthday' ? 'Aniversário' : 'Manual'
                      ).join(' + ')})`}
                    </span>
                    <span>− {fmt(venda.discount_amount)}</span>
                  </div>
                )}
                <div className={`${styles.summaryLine} ${styles.summaryTotal}`}>
                  <span>Total</span>
                  <strong>{fmt(venda.total)}</strong>
                </div>
              </div>

              {/* Pagamentos */}
              {venda.payments.length > 0 && (
                <div className={styles.detailSection}>
                  <div className={styles.detailSectionTitle}>Pagamentos</div>
                  <div className={styles.paymentsList}>
                    {venda.payments.map((p, i) => (
                      <div key={i} className={styles.paymentItem}>
                        <span>{METHOD_LABELS[p.payment_method] ?? p.payment_method}</span>
                        {p.installments > 1 && (
                          <span className={styles.installmentBadge}>{p.installments}x de {fmt(p.amount / p.installments)}</span>
                        )}
                        <span className={styles.paymentAmount}>{fmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Troca */}
              {venda.exchange && (
                <div className={styles.detailSection}>
                  <div className={styles.exchangeHeader}>
                    <ArrowLeftRight size={13} />
                    <div className={styles.detailSectionTitle} style={{ marginBottom: 0 }}>Troca</div>
                  </div>

                  {venda.exchange.returned_items.length > 0 && (
                    <>
                      <div className={styles.exchangeSubtitle}>Devolvidos pelo cliente</div>
                      {venda.exchange.returned_items.map((item, i) => (
                        <div key={i} className={styles.exchangeItemRow}>
                          <span>{item.product_name}</span>
                          <span className={styles.codeCell}>{item.product_code}</span>
                          <span>{item.quantity}x</span>
                          <span className={styles.paymentAmount}>{fmt(item.unit_price)}</span>
                        </div>
                      ))}
                    </>
                  )}

                  {venda.exchange.given_items.length > 0 && (
                    <>
                      <div className={styles.exchangeSubtitle} style={{ marginTop: 8 }}>Recebidos pelo cliente</div>
                      {venda.exchange.given_items.map((item, i) => (
                        <div key={i} className={styles.exchangeItemRow}>
                          <span>{item.product_name}</span>
                          <span className={styles.codeCell}>{item.product_code}</span>
                          <span>{item.quantity}x</span>
                          <span className={styles.paymentAmount}>{fmt(item.unit_price)}</span>
                        </div>
                      ))}
                    </>
                  )}

                  <div className={styles.exchangeDiff}>
                    {venda.exchange.price_difference > 0
                      ? `Cliente pagou diferença: ${fmt(venda.exchange.price_difference)}`
                      : venda.exchange.price_difference < 0
                        ? `Crédito sobrando: ${fmt(Math.abs(venda.exchange.price_difference))}`
                        : 'Troca sem diferença de valor'}
                  </div>
                </div>
              )}

              {/* Nota */}
              {venda.notes && (
                <div className={styles.detailNotes}>{venda.notes}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

type SortKey = 'date' | 'customer' | 'total' | 'items'
type SortDir = 'asc' | 'desc'

interface Props {
  sales: SaleRow[]
  stores: Array<{ id: string; name: string }>
  userRole: string
}

export default function VendasClient({ sales: initial, stores, userRole }: Props) {
  const [sales, setSales]         = useState(initial)
  const [search, setSearch]       = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortKey, setSortKey]     = useState<SortKey>('date')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')
  const [detalheId, setDetalheId] = useState<string | null>(null)

  useEffect(() => { setSales(initial) }, [initial])

  // Stats
  const totalRevenue = sales.reduce((s, v) => s + v.total, 0)
  const avgTicket    = sales.length ? totalRevenue / sales.length : 0
  const nExchanges   = sales.filter(s => s.has_exchange).length

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = sales.filter(s => {
      if (filterStore && s.store_id !== filterStore) return false
      if (filterStatus === 'exchange' && !s.has_exchange) return false
      if (filterStatus === 'completed' && s.status !== 'completed') return false
      if (q && !(s.customer_name ?? '').toLowerCase().includes(q) && !s.payment_summary?.toLowerCase().includes(q)) return false
      return true
    })

    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date')     cmp = a.sale_date.localeCompare(b.sale_date)
      if (sortKey === 'customer') cmp = (a.customer_name ?? '').localeCompare(b.customer_name ?? '')
      if (sortKey === 'total')    cmp = a.total - b.total
      if (sortKey === 'items')    cmp = a.items_count - b.items_count
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [sales, search, filterStore, filterStatus, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={11} style={{ opacity: 0.3 }} />
    return sortDir === 'asc'
      ? <ChevronUp size={11} style={{ color: 'var(--accent)' }} />
      : <ChevronDown size={11} style={{ color: 'var(--accent)' }} />
  }

  return (
    <>
      {/* Stats */}
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Vendas</span>
          <span className={styles.statValue}>{sales.length}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Receita total</span>
          <span className={styles.statValue}>{fmt(totalRevenue)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Ticket médio</span>
          <span className={styles.statValue}>{fmt(avgTicket)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Trocas</span>
          <span className={styles.statValue}>{nExchanges}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <input
            className={styles.search}
            placeholder="Buscar por cliente ou pagamento..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {userRole === 'admin' && (
            <select className={styles.filter} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
              <option value="">Todas as lojas</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select className={styles.filter} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Todos os status</option>
            <option value="completed">Concluídas</option>
            <option value="exchange">Com troca</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <span>Nenhuma venda encontrada.</span>
            <span className={styles.emptyHint}>
              {sales.length === 0 ? 'Clique em "+ Nova Venda" para registrar a primeira.' : 'Tente ajustar os filtros.'}
            </span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thSortable} onClick={() => toggleSort('date')}>
                  Data <SortIcon col="date" />
                </th>
                <th className={styles.thSortable} onClick={() => toggleSort('customer')}>
                  Cliente <SortIcon col="customer" />
                </th>
                {userRole === 'admin' && <th>Loja</th>}
                <th className={styles.thSortable} onClick={() => toggleSort('items')}>
                  Itens <SortIcon col="items" />
                </th>
                <th>Subtotal</th>
                <th>Desconto</th>
                <th className={styles.thSortable} onClick={() => toggleSort('total')}>
                  Total <SortIcon col="total" />
                </th>
                <th>Pagamento</th>
                <th>Troca</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr
                  key={s.id}
                  className={styles.row}
                  onClick={() => setDetalheId(s.id)}
                  title="Clique para ver detalhes"
                >
                  <td className={styles.dateCell}>{fmtDate(s.sale_date)}</td>
                  <td>{s.customer_name ?? <span className={styles.muted}>—</span>}</td>
                  {userRole === 'admin' && <td className={styles.muted}>{s.store_name}</td>}
                  <td className={styles.muted}>{s.items_count}</td>
                  <td className={styles.muted}>{fmt(s.subtotal)}</td>
                  <td className={styles.muted}>
                    {s.discount_amount > 0 ? (
                      <span className={styles.discountBadge}>
                        {s.discount_pct > 0 ? `${s.discount_pct}%` : ''} − {fmt(s.discount_amount)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={styles.totalCell}>{fmt(s.total)}</td>
                  <td className={styles.muted} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.payment_summary ?? '—'}
                  </td>
                  <td>
                    {s.has_exchange
                      ? <span className={styles.exchangeBadge}><ArrowLeftRight size={11} /> Sim</span>
                      : <span className={styles.muted}>—</span>}
                  </td>
                  <td>
                    <Badge variant={s.status === 'completed' ? 'success' : 'muted'}>
                      {s.status === 'completed' ? 'OK' : s.status}
                    </Badge>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button className={styles.iconBtn} onClick={() => setDetalheId(s.id)} title="Ver detalhe">
                      <BarChart2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detalheId && (
        <VendaDetalheModal
          saleId={detalheId}
          onClose={() => setDetalheId(null)}
          onDeleted={() => {
            setSales(prev => prev.filter(s => s.id !== detalheId))
            setDetalheId(null)
          }}
        />
      )}
    </>
  )
}
