'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { createCustomer, updateCustomer } from './actions'
import type { CustomerWithStats, StoreOption } from './page'
import styles from './ClienteFormModal.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateCPF(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i)
  let r = (sum * 10) % 11
  if (r === 10 || r === 11) r = 0
  if (r !== parseInt(d[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i)
  r = (sum * 10) % 11
  if (r === 10 || r === 11) r = 0
  return r === parseInt(d[10])
}

function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2)  return d.length ? `(${d}` : ''
  if (d.length <= 7)  return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function maskCPF(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3)  return d
  if (d.length <= 6)  return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9)  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function maskZip(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

// Converte "YYYY-MM-DD" → "DD/MM/YYYY" para exibição
function toDisplayDate(v: string): string {
  if (!v) return ''
  const [y, m, d] = v.split('-')
  return `${d}/${m}/${y}`
}

// Mascara o input enquanto o usuário digita: auto-insere as barras
function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

// Converte "DD/MM/YYYY" → "YYYY-MM-DD" para o form state
function toISODate(display: string): string {
  const digits = display.replace(/\D/g, '')
  if (digits.length < 8) return ''
  return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Props {
  customer:           CustomerWithStats | null
  stores:             StoreOption[]
  currentUserRole:    string
  currentUserStoreId: string | null
  onClose:            () => void
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ClienteFormModal({
  customer,
  stores,
  currentUserRole,
  currentUserStoreId,
  onClose,
}: Props) {
  const defaultStoreId = customer?.origin_store_id ?? currentUserStoreId ?? stores[0]?.id ?? ''

  const [form, setForm] = useState({
    name:            customer?.name    ?? '',
    phone:           customer?.phone   ?? '',
    cpf:             customer?.cpf     ?? '',
    email:           customer?.email   ?? '',
    birthday:        customer?.birthday ?? '',
    address:         customer?.address  ?? '',
    city:            customer?.city     ?? '',
    state:           customer?.state    ?? '',
    zip_code:        customer?.zip_code ?? '',
    origin_store_id: defaultStoreId,
    notes:           customer?.notes    ?? '',
  })

  // Estado separado para exibição da data (DD/MM/YYYY)
  const [displayDate, setDisplayDate] = useState(toDisplayDate(customer?.birthday ?? ''))

  const [errors, setErrors]     = useState<Partial<Record<keyof typeof form, string>>>({})
  const [saving, setSaving]     = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)

  function set(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }))
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = maskDate(e.target.value)
    setDisplayDate(masked)
    set('birthday', toISODate(masked))
  }

  function validate(): boolean {
    const e: typeof errors = {}
    if (!form.name.trim())  e.name  = 'Nome é obrigatório'
    if (!form.phone.trim()) e.phone = 'Telefone é obrigatório'
    else if (form.phone.replace(/\D/g, '').length < 10) e.phone = 'Telefone inválido'
    if (form.cpf && !validateCPF(form.cpf)) e.cpf = 'CPF inválido'
    if (!form.origin_store_id) e.origin_store_id = 'Loja de origem é obrigatória'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    setServerErr(null)

    const result = customer
      ? await updateCustomer(customer.id, form)
      : await createCustomer(form)

    if (result.success) {
      onClose()
      window.location.reload()
    } else {
      setServerErr(result.error ?? 'Erro desconhecido')
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={customer ? 'Editar Cliente' : 'Nova Cliente'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className={styles.form}>

        {/* ── Informações principais ── */}
        <div className={styles.sectionTitle}>Informações principais</div>
        <div className={styles.grid2}>
          <Field label="Nome completo *" error={errors.name}>
            <input
              className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Nome da cliente"
              maxLength={120}
            />
          </Field>
          <Field label="Telefone *" error={errors.phone}>
            <input
              className={`${styles.input} ${errors.phone ? styles.inputError : ''}`}
              value={form.phone}
              onChange={e => set('phone', maskPhone(e.target.value))}
              placeholder="(19) 9 9999-9999"
            />
          </Field>
          <Field label="CPF" error={errors.cpf}>
            <input
              className={`${styles.input} ${errors.cpf ? styles.inputError : ''}`}
              value={form.cpf}
              onChange={e => set('cpf', maskCPF(e.target.value))}
              placeholder="000.000.000-00"
            />
          </Field>
          <Field label="E-mail">
            <input
              className={styles.input}
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="email@exemplo.com"
            />
          </Field>
        </div>

        {/* ── Endereço ── */}
        <div className={styles.sectionTitle}>Endereço</div>
        <div className={styles.grid3}>
          <Field label="CEP">
            <input
              className={styles.input}
              value={form.zip_code}
              onChange={e => set('zip_code', maskZip(e.target.value))}
              placeholder="00000-000"
            />
          </Field>
          <Field label="Cidade">
            <input
              className={styles.input}
              value={form.city}
              onChange={e => set('city', e.target.value)}
              placeholder="Campinas"
            />
          </Field>
          <Field label="UF">
            <input
              className={styles.input}
              value={form.state}
              onChange={e => set('state', e.target.value.toUpperCase().slice(0, 2))}
              placeholder="SP"
              maxLength={2}
            />
          </Field>
        </div>
        <Field label="Endereço completo">
          <input
            className={styles.input}
            value={form.address}
            onChange={e => set('address', e.target.value)}
            placeholder="Rua, número, bairro"
          />
        </Field>

        {/* ── Outras informações ── */}
        <div className={styles.sectionTitle}>Outras informações</div>
        <div className={styles.grid2}>
          <Field label="Data de nascimento">
            <input
              className={styles.input}
              type="text"
              inputMode="numeric"
              placeholder="DD/MM/AAAA"
              value={displayDate}
              onChange={handleDateChange}
              maxLength={10}
            />
          </Field>
          <Field label="Loja de origem *" error={errors.origin_store_id}>
            {currentUserRole === 'admin' ? (
              <StoreSelect
                stores={stores}
                value={form.origin_store_id}
                onChange={v => set('origin_store_id', v)}
                hasError={!!errors.origin_store_id}
              />
            ) : (
              <input
                className={styles.input}
                value={stores.find(s => s.id === form.origin_store_id)?.name ?? '—'}
                disabled
                style={{ cursor: 'not-allowed', opacity: 0.7 }}
              />
            )}
          </Field>
        </div>
        <Field label="Observações">
          <textarea
            className={styles.textarea}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Preferências, anotações, etc..."
            rows={3}
          />
        </Field>

        {serverErr && <div className={styles.serverError}>{serverErr}</div>}

        <div className={styles.footer}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>
            {customer ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StoreSelect({ stores, value, onChange, hasError }: {
  stores: StoreOption[]
  value: string
  onChange: (v: string) => void
  hasError?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = stores.find(s => s.id === value)

  // Fecha ao clicar fora
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className={styles.storeSelect} ref={ref}>
      <button
        type="button"
        className={`${styles.storeSelectTrigger} ${hasError ? styles.inputError : ''} ${open ? styles.storeSelectOpen : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className={selected ? styles.storeSelectValue : styles.storeSelectPlaceholder}>
          {selected?.name ?? 'Selecione a loja'}
        </span>
        <ChevronDown
          size={14}
          className={`${styles.storeSelectChevron} ${open ? styles.storeSelectChevronOpen : ''}`}
        />
      </button>

      {open && (
        <div className={styles.storeSelectDropdown}>
          {stores.map(s => (
            <button
              key={s.id}
              type="button"
              className={`${styles.storeSelectOption} ${s.id === value ? styles.storeSelectOptionActive : ''}`}
              onClick={() => { onChange(s.id); setOpen(false) }}
            >
              <span>{s.name}</span>
              {s.id === value && <Check size={13} className={styles.storeSelectCheck} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, error, children }: {
  label: string; error?: string; children: React.ReactNode
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      {children}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}
