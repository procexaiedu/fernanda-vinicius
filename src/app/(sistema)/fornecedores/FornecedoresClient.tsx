'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Pencil, Power, BarChart2, AlertTriangle,
  MessageCircle, ChevronUp, ChevronDown, Download,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import FornecedorFormModal from './FornecedorFormModal'
import FornecedorDetalheModal from './FornecedorDetalheModal'
import { toggleSupplierStatus } from './actions'
import type { SupplierWithCount } from './page'
import styles from './FornecedoresClient.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#C9A84C', '#4CAF7D', '#5B8DEF', '#E05252', '#9B59B6', '#E0A352', '#2196F3', '#FF7043',
]

function getAvatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPurchaseDate(s: string) {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export function getWhatsAppNumber(phones: { number: string; is_whatsapp: boolean }[]): string | null {
  if (!phones?.length) return null
  if (phones.length === 1) return phones[0].number
  return phones.find(p => p.is_whatsapp)?.number ?? null
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'products' | 'invested' | 'pending' | 'last_purchase'
type SortDir = 'asc' | 'desc'

interface Props {
  suppliers: SupplierWithCount[]
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function FornecedoresClient({ suppliers: initial }: Props) {
  const [suppliers, setSuppliers]                     = useState(initial)
  const [search, setSearch]                           = useState('')
  const [showInactive, setShowInactive]               = useState(false)
  const [filterConsignment, setFilterConsignment]     = useState(false)
  const [sortKey, setSortKey]                         = useState<SortKey>('name')
  const [sortDir, setSortDir]                         = useState<SortDir>('asc')
  const [formOpen, setFormOpen]                       = useState(false)
  const [editing, setEditing]                         = useState<SupplierWithCount | null>(null)
  const [detalhe, setDetalhe]                         = useState<SupplierWithCount | null>(null)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [togglingId, setTogglingId]                   = useState<string | null>(null)

  useEffect(() => { setSuppliers(initial) }, [initial])

  // Iniciais duplicadas
  const duplicateInitials = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const s of suppliers) {
      const key = s.initials.toUpperCase()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s.name)
    }
    const dupes = new Set<string>()
    for (const [key, names] of map.entries()) {
      if (names.length > 1)
        for (const s of suppliers)
          if (s.initials.toUpperCase() === key) dupes.add(s.id)
    }
    return dupes
  }, [suppliers])

  function getDuplicateTooltip(s: SupplierWithCount): string {
    const key = s.initials.toUpperCase()
    const others = suppliers.filter(x => x.id !== s.id && x.initials.toUpperCase() === key).map(x => x.name)
    return `Iniciais duplicadas com: ${others.join(', ')}`
  }

  // Filtro + ordenação
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = suppliers.filter(s => {
      if (!showInactive && !s.is_active) return false
      if (filterConsignment && !s.accepts_consignment) return false
      if (q && !s.name.toLowerCase().includes(q) && !s.initials.toLowerCase().includes(q)) return false
      return true
    })

    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name')          cmp = a.name.localeCompare(b.name, 'pt-BR')
      if (sortKey === 'products')      cmp = a.product_count - b.product_count
      if (sortKey === 'invested')      cmp = a.total_invested - b.total_invested
      if (sortKey === 'pending')       cmp = a.pending_amount - b.pending_amount
      if (sortKey === 'last_purchase') cmp = (a.last_purchase_date ?? '').localeCompare(b.last_purchase_date ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [suppliers, search, showInactive, filterConsignment, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={11} className={styles.sortIconInactive} />
    return sortDir === 'asc'
      ? <ChevronUp size={11} className={styles.sortIconActive} />
      : <ChevronDown size={11} className={styles.sortIconActive} />
  }

  // Export CSV
  function exportCSV() {
    const header = ['Nome', 'Iniciais', 'Responsável', 'WhatsApp', 'E-mail', 'CNPJ', 'Cidade', 'Estado', 'Consignação', 'Produtos ativos', 'Total investido', 'Parcelas pendentes', 'Última compra', 'Status']
    const rows = suppliers.map(s => [
      s.name, s.initials, s.contact_name ?? '', getWhatsAppNumber(s.phones) ?? '',
      s.email ?? '', s.cnpj ?? '', s.city ?? '', s.state ?? '',
      s.accepts_consignment ? 'Sim' : 'Não', s.product_count,
      s.total_invested.toFixed(2), s.pending_amount.toFixed(2),
      s.last_purchase_date ? formatPurchaseDate(s.last_purchase_date) : '',
      s.is_active ? 'Ativo' : 'Inativo',
    ])
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fornecedores_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  function openCreate() { setEditing(null); setFormOpen(true) }

  function openEdit(s: SupplierWithCount, e: React.MouseEvent) {
    e.stopPropagation()
    setDetalhe(null); setEditing(s); setFormOpen(true)
  }

  async function handleToggle(s: SupplierWithCount, e: React.MouseEvent) {
    e.stopPropagation()
    if (!s.is_active) {
      setTogglingId(s.id)
      await toggleSupplierStatus(s.id, true)
      setTogglingId(null)
      window.location.reload()
      return
    }
    setConfirmDeactivateId(s.id)
  }

  async function confirmDeactivate(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setTogglingId(id); setConfirmDeactivateId(null)
    await toggleSupplierStatus(id, false)
    setTogglingId(null)
    window.location.reload()
  }

  return (
    <>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <input
            className={styles.search}
            placeholder="Buscar por nome ou iniciais..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <label className={styles.toggle}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Exibir inativos
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={filterConsignment} onChange={e => setFilterConsignment(e.target.checked)} />
            Só consignação
          </label>
        </div>
        <div className={styles.toolbarRight}>
          <button className={styles.exportBtn} onClick={exportCSV} title="Exportar CSV">
            <Download size={14} />
            Exportar
          </button>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            Novo Fornecedor
          </Button>
        </div>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <span>Nenhum fornecedor encontrado.</span>
            <span className={styles.emptyHint}>
              {suppliers.length === 0 ? 'Clique em "Novo Fornecedor" para começar.' : 'Tente ajustar os filtros.'}
            </span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thSortable} onClick={() => toggleSort('name')}>
                  Fornecedor <SortIcon col="name" />
                </th>
                <th className="col-tertiary">Responsável</th>
                <th className="col-tertiary">WhatsApp</th>
                <th className={styles.thSortable} onClick={() => toggleSort('products')}>
                  Produtos <SortIcon col="products" />
                </th>
                <th className={styles.thSortable} onClick={() => toggleSort('invested')}>
                  Total investido <SortIcon col="invested" />
                </th>
                <th className={styles.thSortable} onClick={() => toggleSort('pending')}>
                  Em aberto <SortIcon col="pending" />
                </th>
                <th className={`${styles.thSortable} col-tertiary`} onClick={() => toggleSort('last_purchase')}>
                  Última compra <SortIcon col="last_purchase" />
                </th>
                <th>Status</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const isDupe = duplicateInitials.has(s.id)
                return (
                  <tr
                    key={s.id}
                    className={`${styles.row} ${!s.is_active ? styles.rowInactive : ''}`}
                    onClick={() => setDetalhe(s)}
                    title="Clique para ver detalhes"
                  >
                    <td>
                      <div className={styles.supplierCell}>
                        <div className={styles.avatar} style={{ background: getAvatarColor(s.id) }}>
                          {s.initials.toUpperCase()}
                        </div>
                        <div className={styles.supplierInfo}>
                          <span className={styles.supplierName}>{s.name}</span>
                          <div className={styles.supplierMeta}>
                            {s.city && <span>{s.city}{s.state ? ` / ${s.state}` : ''}</span>}
                            {s.accepts_consignment && <Badge variant="accent">Consigna</Badge>}
                            {isDupe && (
                              <span className={styles.dupeWarning} title={getDuplicateTooltip(s)}>
                                <AlertTriangle size={13} /> Iniciais duplicadas
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className={`${styles.mutedCell} col-tertiary`}>{s.contact_name || '—'}</td>

                    <td className={`${styles.mutedCell} col-tertiary`}>
                      {(() => {
                        const waNum = getWhatsAppNumber(s.phones)
                        if (!waNum) return '—'
                        return (
                          <a
                            href={`https://wa.me/55${waNum.replace(/\D/g, '')}`}
                            target="_blank" rel="noreferrer"
                            className={styles.waLink}
                            onClick={e => e.stopPropagation()}
                            title="Abrir no WhatsApp"
                          >
                            <MessageCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            {waNum}
                          </a>
                        )
                      })()}
                    </td>

                    <td className={styles.mutedCell}>
                      <span className={styles.productCount}>{s.product_count}</span>
                    </td>

                    <td className={styles.mutedCell}>
                      {s.total_invested > 0
                        ? <span className={styles.investedValue}>{formatCurrency(s.total_invested)}</span>
                        : '—'}
                    </td>

                    <td className={styles.mutedCell}>
                      {s.pending_amount > 0
                        ? <span className={styles.pendingBadge}>{formatCurrency(s.pending_amount)}</span>
                        : <span>—</span>}
                    </td>

                    <td className={`${styles.mutedCell} col-tertiary`}>
                      {s.last_purchase_date ? formatPurchaseDate(s.last_purchase_date) : '—'}
                    </td>

                    <td>
                      {s.is_active
                        ? <Badge variant="success">Ativo</Badge>
                        : <Badge variant="muted">Inativo</Badge>}
                    </td>

                    <td onClick={e => e.stopPropagation()}>
                      <div className={styles.actions}>
                        {confirmDeactivateId === s.id ? (
                          <>
                            <span className={styles.confirmText}>Desativar?</span>
                            <Button size="sm" variant="danger" loading={togglingId === s.id} onClick={e => confirmDeactivate(s.id, e)}>
                              Confirmar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setConfirmDeactivateId(null) }}>
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <button className={styles.iconBtn} title="Ver detalhes" onClick={e => { e.stopPropagation(); setDetalhe(s) }}>
                              <BarChart2 size={14} />
                            </button>
                            <button className={styles.iconBtn} title="Editar" onClick={e => openEdit(s, e)}>
                              <Pencil size={14} />
                            </button>
                            <button
                              className={`${styles.iconBtn} ${s.is_active ? styles.iconBtnDanger : styles.iconBtnSuccess}`}
                              title={s.is_active ? 'Inativar' : 'Reativar'}
                              disabled={togglingId === s.id}
                              onClick={e => handleToggle(s, e)}
                            >
                              <Power size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && (
        <FornecedorFormModal
          supplier={editing}
          allInitials={suppliers
            .filter(s => !editing || s.id !== editing.id)
            .map(s => ({ id: s.id, name: s.name, initials: s.initials }))}
          onClose={() => setFormOpen(false)}
        />
      )}

      {detalhe && (
        <FornecedorDetalheModal
          supplier={detalhe}
          onClose={() => setDetalhe(null)}
          onEdit={s => { setDetalhe(null); setEditing(s); setFormOpen(true) }}
          onDeleted={() => { setSuppliers(prev => prev.filter(s => s.id !== detalhe.id)); setDetalhe(null) }}
        />
      )}
    </>
  )
}
