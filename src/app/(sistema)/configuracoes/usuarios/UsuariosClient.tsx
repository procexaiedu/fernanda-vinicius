'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { BarChart2, Pencil, KeyRound, Power, Plus, Eye, EyeOff, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import FuncionariaDetalheModal from './FuncionariaDetalheModal'
import UsuarioFormModal from './UsuarioFormModal'
import type { UserWithMetrics } from './page'
import { toggleUserStatus, resetPassword } from './actions'
import styles from './UsuariosClient.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$!'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const STORE_COLORS = ['var(--success)', '#6366f1', '#f59e0b', '#ef4444', '#ec4899']

function getStoreColor(storeId: string, stores: { id: string }[]): string {
  const idx = stores.findIndex(s => s.id === storeId)
  return STORE_COLORS[Math.max(0, idx) % STORE_COLORS.length]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  users: UserWithMetrics[]
  stores: { id: string; name: string }[]
  currentUserId: string
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function UsuariosClient({ users: initialUsers, stores, currentUserId }: Props) {
  const [users, setUsers] = useState<UserWithMetrics[]>(initialUsers)
  const [search, setSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)

  const [detailUser, setDetailUser] = useState<UserWithMetrics | null>(null)
  const [editUser, setEditUser] = useState<UserWithMetrics | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // Reset senha inline
  const [resetUser, setResetUser] = useState<UserWithMetrics | null>(null)
  const [resetPwd, setResetPwd] = useState('')
  const [resetShowPwd, setResetShowPwd] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  // Toggle ativo/inativo
  const [confirmToggleUser, setConfirmToggleUser] = useState<UserWithMetrics | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    setUsers(initialUsers)
  }, [initialUsers])

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [search])

  const filtered = useMemo(() => {
    return users.filter(u => {
      if (!showInactive && !u.is_active) return false
      if (storeFilter !== 'all' && u.store_id !== storeFilter) return false
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        return (
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [users, showInactive, storeFilter, debouncedSearch])

  async function handleToggle(user: UserWithMetrics) {
    setTogglingId(user.id)
    setConfirmToggleUser(null)
    const res = await toggleUserStatus(user.id, !user.is_active)
    if (res.success) {
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: !u.is_active } : u))
    }
    setTogglingId(null)
  }

  async function handleResetPassword() {
    if (!resetUser || resetPwd.length < 6) return
    setResetLoading(true)
    setResetError(null)
    const res = await resetPassword(resetUser.id, resetPwd)
    if (res.success) {
      setResetUser(null)
      setResetPwd('')
    } else {
      setResetError(res.error ?? 'Erro ao redefinir senha.')
    }
    setResetLoading(false)
  }

  function openReset(user: UserWithMetrics) {
    setResetUser(user)
    setResetPwd('')
    setResetShowPwd(false)
    setResetError(null)
  }

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            placeholder="Buscar por nome ou e-mail…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className={styles.select}
            value={storeFilter}
            onChange={e => setStoreFilter(e.target.value)}
          >
            <option value="all">Todas as lojas</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              className={styles.toggleInput}
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
            />
            <span>Exibir inativas</span>
          </label>
        </div>
        <Button variant="primary" size="sm" onClick={() => { setEditUser(null); setFormOpen(true) }}>
          <Plus size={14} />
          Nova usuária
        </Button>
      </div>

      {/* ── Tabela ──────────────────────────────────────────── */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Usuária</th>
              <th>E-mail</th>
              <th>Loja</th>
              <th>Papel</th>
              <th className={styles.metricCol}>Vendas/mês</th>
              <th className={styles.metricCol}>Fat./mês</th>
              <th>Status</th>
              <th className={styles.actionsCol}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className={styles.empty}>
                    <span>Nenhuma usuária encontrada.</span>
                    <span className={styles.emptyHint}>Tente ajustar os filtros ou cadastre uma nova usuária.</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(u => (
                <tr
                  key={u.id}
                  className={`${styles.row} ${!u.is_active ? styles.rowInactive : ''}`}
                  onClick={() => setDetailUser(u)}
                >
                  {/* Avatar + Nome */}
                  <td>
                    <div className={styles.userCell}>
                      <div
                        className={styles.avatar}
                        data-role={u.role}
                      >
                        {u.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.userInfo}>
                        <span className={styles.userName}>
                          {u.full_name}
                          {u.id === currentUserId && (
                            <span className={styles.youBadge}>você</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* E-mail */}
                  <td className={styles.mutedCell}>{u.email}</td>

                  {/* Loja */}
                  <td>
                    {u.store_name ? (
                      <span
                        className={styles.storeBadge}
                        style={{ '--store-color': getStoreColor(u.store_id!, stores) } as React.CSSProperties}
                      >
                        {u.store_name}
                      </span>
                    ) : (
                      <span className={styles.mutedCell}>—</span>
                    )}
                  </td>

                  {/* Papel */}
                  <td>
                    <Badge variant={u.role === 'admin' ? 'accent' : 'muted'}>
                      {u.role === 'admin' ? 'Admin' : 'Operadora'}
                    </Badge>
                  </td>

                  {/* Vendas/mês */}
                  <td className={styles.metricCol}>
                    {u.role === 'operator' ? (
                      <div className={styles.metricCell}>
                        <span className={styles.metricValue}>{u.month_sales}</span>
                        <span className={styles.metricLabel}>este mês</span>
                      </div>
                    ) : (
                      <span className={styles.mutedCell}>—</span>
                    )}
                  </td>

                  {/* Fat./mês */}
                  <td className={styles.metricCol}>
                    {u.role === 'operator' ? (
                      <div className={styles.metricCell}>
                        <span className={styles.metricValue}>{formatCurrency(u.month_revenue)}</span>
                        {u.meta_target > 0 ? (
                          <span
                            className={styles.metricLabel}
                            style={{ color: u.meta_reached ? 'var(--success)' : 'var(--text-muted)', fontWeight: u.meta_reached ? 600 : 400 }}
                          >
                            {Math.round(u.meta_pct)}% da meta
                          </span>
                        ) : (
                          <span className={styles.metricLabel}>este mês</span>
                        )}
                      </div>
                    ) : (
                      <span className={styles.mutedCell}>—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td>
                    <Badge variant={u.is_active ? 'success' : 'muted'}>
                      {u.is_active ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </td>

                  {/* Ações */}
                  <td onClick={e => e.stopPropagation()}>
                    {confirmToggleUser?.id === u.id ? (
                      <div className={styles.confirmRow}>
                        <span className={styles.confirmText}>
                          {u.is_active ? 'Inativar?' : 'Reativar?'}
                        </span>
                        <button
                          className={`${styles.iconBtn} ${u.is_active ? styles.iconBtnDanger : styles.iconBtnSuccess}`}
                          onClick={() => handleToggle(u)}
                          disabled={togglingId === u.id}
                        >
                          {togglingId === u.id ? '…' : 'Sim'}
                        </button>
                        <button
                          className={styles.iconBtn}
                          onClick={() => setConfirmToggleUser(null)}
                        >
                          Não
                        </button>
                      </div>
                    ) : (
                      <div className={styles.actions}>
                        <button
                          className={styles.iconBtn}
                          title="Ver performance"
                          onClick={() => setDetailUser(u)}
                        >
                          <BarChart2 size={14} />
                        </button>
                        <button
                          className={styles.iconBtn}
                          title="Editar usuária"
                          onClick={() => { setEditUser(u); setFormOpen(true) }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className={styles.iconBtn}
                          title="Redefinir senha"
                          onClick={() => openReset(u)}
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          className={`${styles.iconBtn} ${u.is_active ? styles.iconBtnDanger : styles.iconBtnSuccess}`}
                          title={
                            u.id === currentUserId
                              ? 'Você não pode inativar sua própria conta'
                              : u.is_active ? 'Inativar conta' : 'Reativar conta'
                          }
                          disabled={u.id === currentUserId || togglingId === u.id}
                          onClick={() => setConfirmToggleUser(u)}
                        >
                          <Power size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modal Detalhe ────────────────────────────────────── */}
      {detailUser && (
        <FuncionariaDetalheModal
          user={detailUser}
          onClose={() => setDetailUser(null)}
          onEdit={(u) => { setDetailUser(null); setEditUser(u); setFormOpen(true) }}
        />
      )}

      {/* ── Modal Form (Criar / Editar) ───────────────────────── */}
      {formOpen && (
        <UsuarioFormModal
          user={editUser}
          stores={stores}
          onClose={() => { setFormOpen(false); setEditUser(null) }}
          onSaved={(updated) => {
            if (editUser) {
              // Edição: atualização otimista
              setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u))
              setFormOpen(false)
              setEditUser(null)
            } else {
              // Criação: recarregar para obter UUID real do servidor
              window.location.reload()
            }
          }}
        />
      )}

      {/* ── Modal Reset Senha ────────────────────────────────── */}
      {resetUser && (
        <Modal
          isOpen
          onClose={() => setResetUser(null)}
          title={`Redefinir senha — ${resetUser.full_name}`}
          size="sm"
        >
          <div className={styles.resetForm}>
            <p className={styles.resetHint}>
              A nova senha será aplicada imediatamente. Comunique-a à usuária.
            </p>
            <div className={styles.resetField}>
              <input
                type={resetShowPwd ? 'text' : 'password'}
                className={styles.resetInput}
                placeholder="Nova senha (mín. 6 caracteres)"
                value={resetPwd}
                onChange={e => setResetPwd(e.target.value)}
              />
              <button
                type="button"
                className={styles.resetEye}
                onClick={() => setResetShowPwd(p => !p)}
                tabIndex={-1}
              >
                {resetShowPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className={styles.generateBtn}
                onClick={() => { const p = generatePassword(); setResetPwd(p); setResetShowPwd(true) }}
              >
                Gerar
              </button>
            </div>
            {resetError && <p className={styles.resetError}>{resetError}</p>}
            <div className={styles.resetFooter}>
              <Button variant="ghost" size="sm" onClick={() => setResetUser(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={resetLoading}
                disabled={resetPwd.length < 6}
                onClick={handleResetPassword}
              >
                Salvar senha
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
