'use client'

import { useState, useMemo } from 'react'
import { Plus, Trash2, Search, Send, Megaphone, Loader2, Eye, Pencil, Copy } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import NovoDisparoModal from './NovoDisparoModal'
import DisparoDetalheModal from './DisparoDetalheModal'
import { enviarDisparo, excluirDisparo, duplicarDisparo } from './actions'
import type { DisparoRow, StoreOption } from './page'
import styles from './DisparosClient.module.css'

type FilterType = 'todos' | 'rascunhos' | 'enviados'

const STATUS_BADGE: Record<string, { variant: 'success' | 'warning' | 'accent' | 'muted'; label: string }> = {
  rascunho:  { variant: 'warning', label: 'Rascunho' },
  enviando:  { variant: 'accent',  label: 'Enviando' },
  concluido: { variant: 'success', label: 'Concluído' },
  cancelado: { variant: 'muted',   label: 'Cancelado' },
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

interface Props {
  disparos: DisparoRow[]
  stores: StoreOption[]
  currentUserRole: string
  currentUserStoreId: string | null
}

export default function DisparosClient({ disparos, stores, currentUserRole, currentUserStoreId }: Props) {
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<FilterType>('todos')
  const [formOpen, setFormOpen] = useState(false)
  const [editDisparo, setEditDisparo] = useState<DisparoRow | null>(null)
  const [detalhe, setDetalhe]   = useState<DisparoRow | null>(null)
  const [sendingId, setSendingId]   = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openNovo() { setEditDisparo(null); setFormOpen(true) }
  function openEditar(d: DisparoRow, e: React.MouseEvent) { e.stopPropagation(); setEditDisparo(d); setFormOpen(true) }

  async function handleDuplicate(d: DisparoRow, e: React.MouseEvent) {
    e.stopPropagation()
    setDuplicatingId(d.disparo_id)
    const r = await duplicarDisparo(d.disparo_id)
    setDuplicatingId(null)
    if (!r.success) { alert('Erro ao duplicar: ' + r.error); return }
    window.location.reload()
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return disparos.filter(d => {
      if (filter === 'rascunhos' && d.status !== 'rascunho') return false
      if (filter === 'enviados' && !(d.status === 'concluido' || d.status === 'enviando')) return false
      if (q && !`${d.titulo} ${d.store_name}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [disparos, search, filter])

  const counts = useMemo(() => ({
    rascunhos: disparos.filter(d => d.status === 'rascunho').length,
    enviados:  disparos.filter(d => d.status === 'concluido' || d.status === 'enviando').length,
  }), [disparos])

  async function handleSend(d: DisparoRow, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Disparar "${d.titulo}" para ${d.total} cliente(s) da loja ${d.store_name}?`)) return
    setSendingId(d.disparo_id)
    const r = await enviarDisparo(d.disparo_id)
    setSendingId(null)
    if (!r.success) alert('Erro ao disparar: ' + r.error)
    window.location.reload()
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return }
    setDeletingId(id)
    setConfirmDeleteId(null)
    await excluirDisparo(id)
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
              placeholder="Buscar disparo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className={styles.filters}>
            <button className={`${styles.filterBtn} ${filter === 'todos' ? styles.filterActive : ''}`} onClick={() => setFilter('todos')}>
              Todos <span className={styles.filterCount}>{disparos.length}</span>
            </button>
            <button className={`${styles.filterBtn} ${filter === 'rascunhos' ? styles.filterActive : ''}`} onClick={() => setFilter('rascunhos')}>
              Rascunhos <span className={styles.filterCount}>{counts.rascunhos}</span>
            </button>
            <button className={`${styles.filterBtn} ${filter === 'enviados' ? styles.filterActive : ''}`} onClick={() => setFilter('enviados')}>
              Enviados <span className={styles.filterCount}>{counts.enviados}</span>
            </button>
          </div>
        </div>
        <Button size="sm" onClick={openNovo}>
          <Plus size={14} /> Novo disparo
        </Button>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <Megaphone size={32} style={{ color: 'var(--text-disabled)', marginBottom: 8 }} />
            <span>{disparos.length === 0 ? 'Nenhum disparo criado.' : 'Nenhum disparo encontrado.'}</span>
            <span className={styles.emptyHint}>
              {disparos.length === 0 ? 'Clique em "Novo disparo" para começar.' : 'Tente ajustar a busca ou os filtros.'}
            </span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Título</th>
                <th>Loja</th>
                <th>Status</th>
                <th className={styles.num}>Enviados</th>
                <th className={styles.num}>Entregues</th>
                <th className={styles.num}>Lidos</th>
                <th>Data</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const badge = STATUS_BADGE[d.status] ?? STATUS_BADGE.cancelado
                const confirming = confirmDeleteId === d.disparo_id
                const isDraft = d.status === 'rascunho'
                return (
                  <tr key={d.disparo_id} className={styles.row} onClick={() => setDetalhe(d)} title="Ver detalhes">
                    <td className={styles.titleCell}>{d.titulo}</td>
                    <td className={styles.mutedCell}>{d.store_name}</td>
                    <td><Badge variant={badge.variant}>{badge.label}</Badge></td>
                    <td className={`${styles.num} ${styles.mutedCell}`}>{d.total ? `${d.enviados}/${d.total}` : '—'}</td>
                    <td className={`${styles.num} ${styles.mutedCell}`}>{d.enviados ? d.entregues : '—'}</td>
                    <td className={`${styles.num}`}>{d.enviados ? <span className={styles.lidos}>{d.lidos}</span> : '—'}</td>
                    <td className={styles.mutedCell}>{formatDate(d.created_at)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className={styles.actions}>
                        {confirming ? (
                          <>
                            <span className={styles.confirmText}>Excluir?</span>
                            <Button size="sm" variant="danger" loading={deletingId === d.disparo_id} onClick={e => handleDelete(d.disparo_id, e)}>Confirmar</Button>
                            <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setConfirmDeleteId(null) }}>Cancelar</Button>
                          </>
                        ) : (
                          <>
                            <button
                              className={styles.iconBtn}
                              title="Ver detalhes"
                              onClick={e => { e.stopPropagation(); setDetalhe(d) }}
                            >
                              <Eye size={14} />
                            </button>
                            {isDraft && (
                              <button
                                className={styles.iconBtn}
                                title="Editar"
                                onClick={e => openEditar(d, e)}
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            <button
                              className={styles.iconBtn}
                              title="Duplicar (reenviar)"
                              disabled={duplicatingId === d.disparo_id}
                              onClick={e => handleDuplicate(d, e)}
                            >
                              {duplicatingId === d.disparo_id ? <Loader2 size={14} className={styles.spin} /> : <Copy size={14} />}
                            </button>
                            {isDraft && (
                              <button
                                className={`${styles.iconBtn} ${styles.iconBtnSend}`}
                                title="Disparar agora"
                                disabled={sendingId === d.disparo_id}
                                onClick={e => handleSend(d, e)}
                              >
                                {sendingId === d.disparo_id ? <Loader2 size={14} className={styles.spin} /> : <Send size={14} />}
                              </button>
                            )}
                            <button
                              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                              title="Excluir"
                              disabled={deletingId === d.disparo_id}
                              onClick={e => handleDelete(d.disparo_id, e)}
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
          {filtered.length} disparo{filtered.length !== 1 ? 's' : ''} exibido{filtered.length !== 1 ? 's' : ''}
        </div>
      )}

      {formOpen && (
        <NovoDisparoModal
          stores={stores}
          currentUserRole={currentUserRole}
          currentUserStoreId={currentUserStoreId}
          editDisparo={editDisparo}
          onClose={() => { setFormOpen(false); setEditDisparo(null) }}
        />
      )}

      {detalhe && (
        <DisparoDetalheModal disparo={detalhe} onClose={() => setDetalhe(null)} />
      )}
    </>
  )
}
