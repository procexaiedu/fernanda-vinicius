'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Power } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import LojaDetalheModal from './LojaDetalheModal'
import type { Store } from '@/types'
import { createStore, updateStore, toggleStoreStatus, type StoreFormData } from './actions'
import styles from './LojasClient.module.css'

const BR_STATES = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA',
  'MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN',
  'RS','RO','RR','SC','SP','SE','TO',
]

function formatCNPJ(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2)  return d
  if (d.length <= 5)  return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8)  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

export function formatPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2)  return d.length ? `(${d}` : ''
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

const emptyForm: StoreFormData = { name: '', city: '', state: 'SP', address: '', phone: '', cnpj: '' }

interface Props {
  stores: Store[]
}

export default function LojasClient({ stores: initialStores }: Props) {
  const [stores, setStores] = useState<Store[]>(initialStores)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedStore, setSelectedStore] = useState<Store | null>(null)
  const [detalheStore, setDetalheStore] = useState<Store | null>(null)
  const [form, setForm] = useState<StoreFormData>(emptyForm)
  const [errors, setErrors] = useState<Partial<StoreFormData>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    setStores(initialStores)
  }, [initialStores])

  function openCreateModal() {
    setSelectedStore(null)
    setForm(emptyForm)
    setErrors({})
    setActionError(null)
    setModalOpen(true)
  }

  function openEditModal(store: Store) {
    setDetalheStore(null)
    setSelectedStore(store)
    setForm({
      name: store.name,
      city: store.city,
      state: store.state,
      address: store.address ?? '',
      phone: store.phone ?? '',
      cnpj: store.cnpj ?? '',
    })
    setErrors({})
    setActionError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setSelectedStore(null)
  }

  function validate(): boolean {
    const e: Partial<StoreFormData> = {}
    if (!form.name.trim())  e.name = 'Nome é obrigatório.'
    if (!form.city.trim())  e.city = 'Cidade é obrigatória.'
    if (!form.state.trim()) e.state = 'Estado é obrigatório.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setIsSubmitting(true)
    setActionError(null)

    const result = selectedStore
      ? await updateStore(selectedStore.id, form)
      : await createStore(form)

    setIsSubmitting(false)

    if (!result.success) {
      setActionError(result.error ?? 'Erro ao salvar.')
      return
    }

    closeModal()
    window.location.reload()
  }

  async function handleToggle(store: Store, e: React.MouseEvent) {
    e.stopPropagation()
    if (!store.is_active) {
      setTogglingId(store.id)
      await toggleStoreStatus(store.id, true)
      setTogglingId(null)
      window.location.reload()
      return
    }
    setConfirmDeactivateId(store.id)
  }

  async function confirmDeactivate(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setTogglingId(id)
    setConfirmDeactivateId(null)
    await toggleStoreStatus(id, false)
    setTogglingId(null)
    window.location.reload()
  }

  return (
    <>
      <div className={styles.toolbar}>
        <Button size="sm" onClick={openCreateModal}>
          <Plus size={14} />
          Nova Loja
        </Button>
      </div>

      <div className={styles.tableWrapper}>
        {stores.length === 0 ? (
          <div className={styles.empty}>
            <span>Nenhuma loja cadastrada.</span>
            <span className={styles.emptyHint}>Clique em &quot;Nova Loja&quot; para começar.</span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Cidade / UF</th>
                <th>CNPJ</th>
                <th>Telefone</th>
                <th>Status</th>
                <th className={styles.actionsCol}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr
                  key={store.id}
                  className={`${styles.row} ${store.is_active ? '' : styles.rowInactive}`}
                  onClick={() => setDetalheStore(store)}
                  title="Clique para ver detalhes"
                >
                  <td className={styles.nameCell}>{store.name}</td>
                  <td className={styles.mutedCell}>
                    {store.city} / {store.state}
                  </td>
                  <td className={styles.mutedCell}>{store.cnpj || '—'}</td>
                  <td className={styles.mutedCell}>{store.phone ? formatPhone(store.phone) : '—'}</td>
                  <td>
                    {store.is_active
                      ? <Badge variant="success">Ativa</Badge>
                      : <Badge variant="muted">Inativa</Badge>
                    }
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className={styles.actions}>
                      {confirmDeactivateId === store.id ? (
                        <>
                          <span className={styles.confirmText}>Desativar?</span>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={togglingId === store.id}
                            onClick={(e) => confirmDeactivate(store.id, e)}
                          >
                            Confirmar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeactivateId(null) }}
                          >
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <button
                            className={styles.iconBtn}
                            title="Editar"
                            onClick={(e) => { e.stopPropagation(); openEditModal(store) }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className={`${styles.iconBtn} ${store.is_active ? styles.iconBtnDanger : styles.iconBtnSuccess}`}
                            title={store.is_active ? 'Desativar' : 'Reativar'}
                            disabled={togglingId === store.id}
                            onClick={(e) => handleToggle(store, e)}
                          >
                            <Power size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de Criação / Edição */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={selectedStore ? 'Editar Loja' : 'Nova Loja'}
      >
        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <Input
            label="Nome *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={errors.name}
            placeholder="Ex: Loja Centro"
            autoFocus
          />
          <div className={styles.formRow}>
            <div className={styles.flex1}>
              <Input
                label="Cidade *"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                error={errors.city}
                placeholder="Ex: São Paulo"
              />
            </div>
            <div className={styles.stateCol}>
              <label className={styles.selectLabel} htmlFor="loja-state">Estado *</label>
              <select
                id="loja-state"
                className={`${styles.select} ${errors.state ? styles.selectError : ''}`}
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              >
                {BR_STATES.map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
              {errors.state && <span className={styles.errorMsg}>{errors.state}</span>}
            </div>
          </div>
          <Input
            label="Endereço"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Rua, número, bairro"
          />
          <div className={styles.formRow}>
            <div className={styles.flex1}>
              <Input
                label="Telefone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))}
                placeholder="(11) 99999-9999"
                maxLength={15}
              />
            </div>
            <div className={styles.flex1}>
              <Input
                label="CNPJ"
                value={form.cnpj}
                onChange={(e) => setForm((f) => ({ ...f, cnpj: formatCNPJ(e.target.value) }))}
                placeholder="00.000.000/0000-00"
                maxLength={18}
              />
            </div>
          </div>

          {actionError && <p className={styles.actionError}>{actionError}</p>}

          <div className={styles.formFooter}>
            <Button type="button" variant="ghost" onClick={closeModal} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {selectedStore ? 'Salvar Alterações' : 'Criar Loja'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Detalhe */}
      {detalheStore && (
        <LojaDetalheModal
          store={detalheStore}
          onClose={() => setDetalheStore(null)}
          onEdit={(store) => openEditModal(store)}
        />
      )}
    </>
  )
}
