'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  ChevronUp, ChevronDown, ArrowLeftRight,
  BarChart2, FileBarChart2,
} from 'lucide-react'
import Badge from '@/components/ui/Badge'
import VendaDetalheModal from '@/components/venda/VendaDetalheModal'
import FechamentoModal from './FechamentoModal'
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

// ─── FilterSelect ─────────────────────────────────────────────────────────────

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: Array<{ value: string; label: string }>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  function toggle() {
    if (open) { setOpen(false); setPos(null); return }
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) })
    setOpen(true)
  }

  function select(v: string) { onChange(v); setOpen(false); setPos(null) }

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setPos(null) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className={styles.filterWrap}>
      <button type="button" className={`${styles.filterBtn} ${open ? styles.filterBtnOpen : ''}`} onClick={toggle}>
        <span className={value ? styles.filterBtnActive : ''}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      {pos && (
        <div className={styles.filterDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}>
          <div
            className={`${styles.filterOption} ${value === '' ? styles.filterOptionActive : ''}`}
            onMouseDown={() => select('')}
          >
            {placeholder}
          </div>
          {options.map(o => (
            <div
              key={o.value}
              className={`${styles.filterOption} ${value === o.value ? styles.filterOptionActive : ''}`}
              onMouseDown={() => select(o.value)}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

type SortKey = 'date' | 'customer' | 'total' | 'items'
type SortDir = 'asc' | 'desc'

interface Props {
  sales: SaleRow[]
  stores: Array<{ id: string; name: string }>
  sellers: Array<{ id: string; full_name: string }>
  userRole: string
}

export default function VendasClient({ sales: initial, stores, sellers, userRole }: Props) {
  const [sales, setSales]         = useState(initial)
  const [search, setSearch]       = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSeller, setFilterSeller] = useState('')
  const [sortKey, setSortKey]     = useState<SortKey>('date')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')
  const [detalheId, setDetalheId] = useState<string | null>(null)
  const [fechamentoOpen, setFechamentoOpen] = useState(false)

  useEffect(() => { setSales(initial) }, [initial])

  // Stats
  const totalRevenue = sales.reduce((s, v) => s + v.total, 0)
  const avgTicket    = sales.length ? totalRevenue / sales.length : 0
  const nExchanges   = sales.filter(s => s.has_exchange).length

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = sales.filter(s => {
      if (filterStore && s.store_id !== filterStore) return false
      if (filterSeller && s.seller_id !== filterSeller) return false
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
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Vendas</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setFechamentoOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px',
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,168,76,0.4)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)' }}
          >
            <FileBarChart2 size={14} />
            Fechamento
          </button>
          <Link
            href="/vendas/nova"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 16px',
              background: 'var(--accent)', color: '#000',
              borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            + Nova Venda
          </Link>
        </div>
      </div>

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
            <FilterSelect
              value={filterStore}
              onChange={setFilterStore}
              placeholder="Todas as lojas"
              options={stores.map(s => ({ value: s.id, label: s.name }))}
            />
          )}
          {userRole === 'admin' && (
            <FilterSelect
              value={filterSeller}
              onChange={setFilterSeller}
              placeholder="Todas as vendedoras"
              options={sellers.map(u => ({ value: u.id, label: u.full_name }))}
            />
          )}
          <FilterSelect
            value={filterStatus}
            onChange={setFilterStatus}
            placeholder="Todos os status"
            options={[
              { value: 'completed', label: 'Concluídas' },
              { value: 'exchange', label: 'Com troca' },
            ]}
          />
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
                {userRole === 'admin' && <th>Vendedora</th>}
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
                  {userRole === 'admin' && (
                    <td className={styles.muted}>{s.seller_name ?? <span className={styles.muted}>—</span>}</td>
                  )}
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

      {fechamentoOpen && (
        <FechamentoModal
          sellers={sellers}
          userRole={userRole}
          onClose={() => setFechamentoOpen(false)}
        />
      )}
    </>
  )
}
