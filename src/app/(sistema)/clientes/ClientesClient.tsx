'use client'

import { useState, useMemo } from 'react'
import { Plus, Pencil, Trash2, Eye, Search, Users, Cake, Clock, ChevronUp, ChevronDown } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import ClienteFormModal from './ClienteFormModal'
import ClienteDetalheModal from './ClienteDetalheModal'
import { deleteCustomer } from './actions'
import type { CustomerWithStats, StoreOption } from './page'
import styles from './ClientesClient.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#C9A84C', '#4CAF7D', '#5B8DEF', '#E05252', '#9B59B6', '#E0A352', '#2196F3', '#FF7043',
]

function getAvatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('pt-BR')
}

function formatBirthdayShort(birthday: string): string {
  const [, m, d] = birthday.split('-')
  return `${d}/${m}`
}

function isBirthdayThisMonth(birthday: string | null): boolean {
  if (!birthday) return false
  return parseInt(birthday.split('-')[1]) === new Date().getMonth() + 1
}

function isInactive(lastSaleDate: string | null, inactiveDays: number): boolean {
  if (!lastSaleDate) return true
  const diff = (Date.now() - new Date(lastSaleDate).getTime()) / 86400000
  return diff >= inactiveDays
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type FilterType = 'todos' | 'aniversariantes' | 'inativos'
type SortKey    = 'name' | 'last_sale_date'
type SortDir    = 'asc'  | 'desc'

interface Props {
  customers: CustomerWithStats[]
  stores: StoreOption[]
  inactiveDays: number
  currentUserRole: string
  currentUserStoreId: string | null
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ClientesClient({
  customers: initial,
  stores,
  inactiveDays,
  currentUserRole,
  currentUserStoreId,
}: Props) {
  const [customers, setCustomers]         = useState(initial)
  const [search, setSearch]               = useState('')
  const [filter, setFilter]               = useState<FilterType>('todos')
  const [sortKey, setSortKey]             = useState<SortKey>('last_sale_date')
  const [sortDir, setSortDir]             = useState<SortDir>('desc')
  const [formOpen, setFormOpen]           = useState(false)
  const [editing, setEditing]             = useState<CustomerWithStats | null>(null)
  const [detalhe, setDetalhe]             = useState<CustomerWithStats | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId]       = useState<string | null>(null)

  const currentMonth = new Date().getMonth() + 1

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const list = customers.filter(c => {
      if (filter === 'aniversariantes' && !isBirthdayThisMonth(c.birthday)) return false
      if (filter === 'inativos' && !isInactive(c.last_sale_date, inactiveDays)) return false
      if (q) {
        const haystack = `${c.name} ${c.phone} ${c.cpf ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    return [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name, 'pt-BR')
      } else {
        // nulls vão para o final independente da direção
        if (!a.last_sale_date && !b.last_sale_date) cmp = 0
        else if (!a.last_sale_date) return 1
        else if (!b.last_sale_date) return -1
        else cmp = a.last_sale_date.localeCompare(b.last_sale_date)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [customers, search, filter, inactiveDays, sortKey, sortDir])

  const counts = useMemo(() => ({
    aniversariantes: customers.filter(c => isBirthdayThisMonth(c.birthday)).length,
    inativos:        customers.filter(c => isInactive(c.last_sale_date, inactiveDays)).length,
  }), [customers, inactiveDays])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={11} style={{ color: 'var(--text-disabled)', verticalAlign: 'middle', marginLeft: 4 }} />
    return sortDir === 'asc'
      ? <ChevronUp   size={11} style={{ color: 'var(--accent)', verticalAlign: 'middle', marginLeft: 4 }} />
      : <ChevronDown size={11} style={{ color: 'var(--accent)', verticalAlign: 'middle', marginLeft: 4 }} />
  }

  function openCreate() { setEditing(null); setFormOpen(true) }

  function openEdit(c: CustomerWithStats, e: React.MouseEvent) {
    e.stopPropagation()
    setDetalhe(null)
    setEditing(c)
    setFormOpen(true)
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return }
    setDeletingId(id)
    setConfirmDeleteId(null)
    await deleteCustomer(id)
    setDeletingId(null)
    window.location.reload()
  }

  return (
    <>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.search}
              placeholder="Buscar por nome, telefone ou CPF..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.filters}>
            <button
              className={`${styles.filterBtn} ${filter === 'todos' ? styles.filterActive : ''}`}
              onClick={() => setFilter('todos')}
            >
              <Users size={13} />
              Todos
              <span className={styles.filterCount}>{customers.length}</span>
            </button>
            <button
              className={`${styles.filterBtn} ${filter === 'aniversariantes' ? styles.filterActive : ''}`}
              onClick={() => setFilter('aniversariantes')}
            >
              <Cake size={13} />
              Aniversariantes
              {counts.aniversariantes > 0 && (
                <span className={`${styles.filterCount} ${styles.filterCountBirthday}`}>
                  {counts.aniversariantes}
                </span>
              )}
            </button>
            <button
              className={`${styles.filterBtn} ${filter === 'inativos' ? styles.filterActive : ''}`}
              onClick={() => setFilter('inativos')}
            >
              <Clock size={13} />
              Inativos
              {counts.inativos > 0 && (
                <span className={`${styles.filterCount} ${styles.filterCountInactive}`}>
                  {counts.inativos}
                </span>
              )}
            </button>
          </div>
        </div>

        <Button size="sm" onClick={openCreate}>
          <Plus size={14} />
          Nova Cliente
        </Button>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <Users size={32} style={{ color: 'var(--text-disabled)', marginBottom: 8 }} />
            <span>{customers.length === 0 ? 'Nenhuma cliente cadastrada.' : 'Nenhuma cliente encontrada.'}</span>
            <span className={styles.emptyHint}>
              {customers.length === 0
                ? 'Clique em "Nova Cliente" para começar.'
                : 'Tente ajustar a busca ou os filtros.'}
            </span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thSortable} onClick={() => toggleSort('name')}>
                  Cliente <SortIcon col="name" />
                </th>
                <th>Telefone</th>
                <th>Aniversário</th>
                <th className={styles.thSortable} onClick={() => toggleSort('last_sale_date')}>
                  Última compra <SortIcon col="last_sale_date" />
                </th>
                <th className={styles.rightCol}>Total gasto</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const birthday   = isBirthdayThisMonth(c.birthday)
                const inactive   = isInactive(c.last_sale_date, inactiveDays)
                const confirming = confirmDeleteId === c.id

                return (
                  <tr
                    key={c.id}
                    className={styles.row}
                    onClick={() => setDetalhe(c)}
                    title="Clique para ver detalhes"
                  >
                    {/* Cliente */}
                    <td>
                      <div className={styles.customerCell}>
                        <div className={styles.avatar} style={{ background: getAvatarColor(c.id) }}>
                          {getInitials(c.name)}
                        </div>
                        <div className={styles.customerInfo}>
                          <div className={styles.customerName}>
                            {c.name}
                            {birthday && (
                              <span className={styles.birthdayBadge} title="Aniversariante este mês">🎂</span>
                            )}
                          </div>
                          <div className={styles.customerMeta}>
                            <span className={styles.storeBadge}>{c.origin_store_name}</span>
                            {inactive && c.total_sales > 0 && (
                              <span className={styles.inactiveBadge}>Inativa</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Telefone */}
                    <td className={styles.mutedCell}>{c.phone}</td>

                    {/* Aniversário */}
                    <td className={styles.mutedCell}>
                      {c.birthday ? (
                        <span className={birthday ? styles.birthdayHighlight : ''}>
                          {formatBirthdayShort(c.birthday)}
                        </span>
                      ) : '—'}
                    </td>

                    {/* Última compra */}
                    <td className={styles.mutedCell}>
                      {c.last_sale_date ? formatDate(c.last_sale_date) : (
                        <span className={styles.neverText}>Nunca</span>
                      )}
                    </td>

                    {/* Total gasto */}
                    <td className={`${styles.mutedCell} ${styles.rightCol}`}>
                      {c.total_spent > 0 ? (
                        <span className={styles.totalValue}>{formatCurrency(c.total_spent)}</span>
                      ) : '—'}
                    </td>

                    {/* Ações */}
                    <td onClick={e => e.stopPropagation()}>
                      <div className={styles.actions}>
                        {confirming ? (
                          <>
                            <span className={styles.confirmText}>Excluir?</span>
                            <Button
                              size="sm"
                              variant="danger"
                              loading={deletingId === c.id}
                              onClick={e => handleDelete(c.id, e)}
                            >
                              Confirmar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={e => { e.stopPropagation(); setConfirmDeleteId(null) }}
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <button
                              className={styles.iconBtn}
                              title="Ver detalhes"
                              onClick={e => { e.stopPropagation(); setDetalhe(c) }}
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              className={styles.iconBtn}
                              title="Editar"
                              onClick={e => openEdit(c, e)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                              title="Excluir"
                              disabled={deletingId === c.id}
                              onClick={e => handleDelete(c.id, e)}
                            >
                              <Trash2 size={14} />
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

      {filtered.length > 0 && (
        <div className={styles.footer}>
          {filtered.length} cliente{filtered.length !== 1 ? 's' : ''} exibida{filtered.length !== 1 ? 's' : ''}
          {search || filter !== 'todos' ? ` de ${customers.length} total` : ''}
        </div>
      )}

      {formOpen && (
        <ClienteFormModal
          customer={editing}
          stores={stores}
          currentUserRole={currentUserRole}
          currentUserStoreId={currentUserStoreId}
          onClose={() => setFormOpen(false)}
        />
      )}

      {detalhe && (
        <ClienteDetalheModal
          customer={detalhe}
          inactiveDays={inactiveDays}
          isAdmin={currentUserRole === 'admin'}
          onClose={() => setDetalhe(null)}
          onEdit={c => { setDetalhe(null); setEditing(c); setFormOpen(true) }}
        />
      )}
    </>
  )
}
