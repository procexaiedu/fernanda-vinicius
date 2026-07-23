'use client'

import { usePersistedState } from '@/hooks/usePersistedState'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  ChevronUp, ChevronDown, ArrowLeftRight, BarChart2, Pencil,
} from 'lucide-react'
import Badge from '@/components/ui/Badge'
import DatePicker from '@/components/ui/DatePicker'
import VendaDetalheModal from '@/components/venda/VendaDetalheModal'
import type { SaleRow } from './page'
import styles from './VendasClient.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function todayStr() {
  const t = new Date()
  const mm = String(t.getMonth() + 1).padStart(2, '0')
  const dd = String(t.getDate()).padStart(2, '0')
  return `${t.getFullYear()}-${mm}-${dd}`
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
  const today = todayStr()

  const [sales, setSales]             = useState(initial)
  const [search, setSearch]           = useState('')
  const [filterStore, setFilterStore] = usePersistedState('fv-filtros-vendas-store', '')
  const [filterStatus, setFilterStatus] = usePersistedState('fv-filtros-vendas-status', '')
  const [filterSeller, setFilterSeller] = usePersistedState('fv-filtros-vendas-seller', '')
  const [dateFrom, setDateFrom]       = useState(today)
  const [dateTo, setDateTo]           = useState(today)
  const [sortKey, setSortKey]         = usePersistedState<SortKey>('fv-filtros-vendas-sortkey', 'date')
  const [sortDir, setSortDir]         = usePersistedState<SortDir>('fv-filtros-vendas-sortdir', 'desc')
  const [detalheId, setDetalheId]     = useState<string | null>(null)

  useEffect(() => { setSales(initial) }, [initial])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = sales.filter(s => {
      // sale_date vem como "2026-07-23T00:00:00+00:00" e os filtros como "2026-07-23".
      // Comparar as strings inteiras excluía a venda do próprio dia final — comparar só a data.
      const saleDay = s.sale_date.slice(0, 10)
      if (dateFrom && saleDay < dateFrom) return false
      if (dateTo   && saleDay > dateTo)   return false
      if (filterStore  && s.store_id  !== filterStore)  return false
      if (filterSeller && s.seller_id !== filterSeller) return false
      if (filterStatus === 'exchange'  && !s.has_exchange)       return false
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
  }, [sales, search, dateFrom, dateTo, filterStore, filterSeller, filterStatus, sortKey, sortDir])

  // Stats refletem o período e filtros ativos
  const totalRevenue = filtered.reduce((s, v) => s + v.total, 0)
  const avgTicket    = filtered.length ? totalRevenue / filtered.length : 0
  const nExchanges   = filtered.filter(s => s.has_exchange).length

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
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <a
            href="/pdv"
            target="_blank"
            rel="noopener"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 16px',
              background: 'transparent', color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600,
              textDecoration: 'none',
            }}
            title="Abrir o PDV em uma nova aba (registro rápido + caixa do dia)"
          >
            🖥 Abrir PDV
          </a>
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

      {/* Stats — refletem o período selecionado */}
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Vendas</span>
          <span className={styles.statValue}>{filtered.length}</span>
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
          {/* Filtro de data */}
          <div className={styles.dateRange}>
            <div className={styles.dateRangeField}>
              <DatePicker
                value={dateFrom}
                onChange={v => { setDateFrom(v); if (v && dateTo && v > dateTo) setDateTo(v) }}
              />
            </div>
            <span className={styles.dateRangeSep}>—</span>
            <div className={styles.dateRangeField}>
              <DatePicker
                value={dateTo}
                onChange={v => { setDateTo(v); if (v && dateFrom && v < dateFrom) setDateFrom(v) }}
              />
            </div>
          </div>

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
              {sales.length === 0 ? 'Clique em "+ Nova Venda" para registrar a primeira.' : 'Tente ajustar os filtros ou o período.'}
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
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button className={styles.iconBtn} onClick={() => setDetalheId(s.id)} title="Ver detalhe">
                        <BarChart2 size={13} />
                      </button>
                      <Link className={styles.iconBtn} href={`/vendas/${s.id}/editar`} title="Editar venda">
                        <Pencil size={13} />
                      </Link>
                    </div>
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
