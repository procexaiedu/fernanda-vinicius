'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, FileText, ExternalLink, AlertTriangle, RefreshCw, CheckCircle, Clock } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import styles from './ComprasClient.module.css'

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

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ComprasClient({ purchases, consignments }: Props) {
  const router = useRouter()
  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'purchase' | 'consignment'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending' | 'active'>('all')

  // Unifica compras e consignações para exibição
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
      // Busca
      if (search) {
        const q = search.toLowerCase()
        if (row.type === 'purchase') {
          const match = row.suppliers.some(s => s.toLowerCase().includes(q)) ||
            (row.nf_number ?? '').toLowerCase().includes(q)
          if (!match) return false
        }
      }
      // Status
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

  const totalCompras    = purchases.length
  const totalConsign    = consignments.filter(c => c.status === 'active').length
  const totalPendente   = purchases.filter(p => p.paymentStatus === 'pending')
    .reduce((s, p) => s + p.total_cost, 0)

  return (
    <div>
      {/* ── Stats cards ──────────────────────────────────────────── */}
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

      {/* ── Toolbar ──────────────────────────────────────────────── */}
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

      {/* ── Tabela ───────────────────────────────────────────────── */}
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
                    <tr key={row.id} className={styles.row}>
                      <td className={styles.date}>{fmtDate(row.purchase_date)}</td>
                      <td><Badge variant="muted">Própria</Badge></td>
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
                              {row.nf_url && <a href={row.nf_url} target="_blank" rel="noreferrer" className={styles.nfLink}><ExternalLink size={11} /></a>}
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
                      <td><Badge variant="accent">Consignação</Badge></td>
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
    </div>
  )
}
