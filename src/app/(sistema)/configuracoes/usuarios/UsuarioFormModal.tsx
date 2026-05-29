'use client'

import { useState, useRef, useEffect } from 'react'
import { Eye, EyeOff, Copy, Check, ChevronDown } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import type { UserWithMetrics } from './page'
import { createUser, updateUser } from './actions'
import styles from './UsuarioFormModal.module.css'

// ─── FormSelect ───────────────────────────────────────────────────────────────

function FormSelect<T extends string>({ value, onChange, options, error }: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
  error?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  function toggle() {
    if (open) { setOpen(false); setPos(null); return }
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    setOpen(true)
  }

  function select(v: T) { onChange(v); setOpen(false); setPos(null) }

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
    <div ref={ref} className={styles.selectWrap}>
      <button
        type="button"
        className={`${styles.selectBtn} ${open ? styles.selectBtnOpen : ''} ${error ? styles.selectBtnError : ''}`}
        onClick={toggle}
      >
        <span className={styles.selectBtnLabel}>{selected?.label ?? '—'}</span>
        <ChevronDown size={11} className={`${styles.selectChevron} ${open ? styles.selectChevronOpen : ''}`} />
      </button>
      {pos && (
        <div
          className={styles.selectDropdown}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
        >
          {options.map(o => (
            <div
              key={o.value}
              className={`${styles.selectOption} ${value === o.value ? styles.selectOptionActive : ''}`}
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

// ─── StoreSelect (com opção vazia) ────────────────────────────────────────────

function StoreSelect({ value, onChange, stores, placeholder, error }: {
  value: string
  onChange: (v: string) => void
  stores: { id: string; name: string }[]
  placeholder: string
  error?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  function toggle() {
    if (open) { setOpen(false); setPos(null); return }
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
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

  const selected = stores.find(s => s.id === value)

  return (
    <div ref={ref} className={styles.selectWrap}>
      <button
        type="button"
        className={`${styles.selectBtn} ${open ? styles.selectBtnOpen : ''} ${error ? styles.selectBtnError : ''}`}
        onClick={toggle}
      >
        <span className={`${styles.selectBtnLabel} ${!selected ? styles.selectBtnPlaceholder : ''}`}>
          {selected?.name ?? placeholder}
        </span>
        <ChevronDown size={11} className={`${styles.selectChevron} ${open ? styles.selectChevronOpen : ''}`} />
      </button>
      {pos && (
        <div
          className={styles.selectDropdown}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
        >
          <div
            className={`${styles.selectOption} ${!value ? styles.selectOptionActive : ''} ${styles.selectOptionMuted}`}
            onMouseDown={() => select('')}
          >
            {placeholder}
          </div>
          {stores.map(s => (
            <div
              key={s.id}
              className={`${styles.selectOption} ${value === s.id ? styles.selectOptionActive : ''}`}
              onMouseDown={() => select(s.id)}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$!'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  user: UserWithMetrics | null  // null = modo criar
  stores: { id: string; name: string }[]
  onClose: () => void
  onSaved: (user: UserWithMetrics) => void
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function UsuarioFormModal({ user, stores, onClose, onSaved }: Props) {
  const isEdit = user !== null

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [role, setRole] = useState<'admin' | 'operator'>(user?.role ?? 'operator')
  const [storeId, setStoreId] = useState(user?.store_id ?? '')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Estado pós-criação: exibir banner com senha
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!fullName.trim()) errs.fullName = 'Nome obrigatório.'
    if (!isEdit) {
      if (!email.trim()) errs.email = 'E-mail obrigatório.'
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'E-mail inválido.'
      if (!password) errs.password = 'Senha obrigatória.'
      else if (password.length < 6) errs.password = 'Mínimo 6 caracteres.'
    }
    if (role === 'operator' && !storeId) errs.storeId = 'Selecione a loja da operadora.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSubmitting(true)
    setActionError(null)

    if (isEdit) {
      const res = await updateUser(user!.id, {
        full_name: fullName,
        role,
        store_id: storeId || null,
      })
      if (res.success) {
        const storeName = stores.find(s => s.id === storeId)?.name ?? null
        onSaved({
          ...user!,
          full_name: fullName,
          role,
          store_id: storeId || null,
          store_name: storeName,
        })
      } else {
        setActionError(res.error ?? 'Erro ao atualizar.')
      }
    } else {
      const res = await createUser({
        full_name: fullName,
        email,
        password,
        role,
        store_id: storeId || null,
      })
      if (res.success) {
        setCreatedPassword(password)
      } else {
        setActionError(res.error ?? 'Erro ao criar usuária.')
      }
    }
    setSubmitting(false)
  }

  async function handleCopy() {
    if (!createdPassword) return
    await navigator.clipboard.writeText(createdPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleCloseAfterCreate() {
    const storeName = stores.find(s => s.id === storeId)?.name ?? null
    onSaved({
      id: '',  // será atualizado via revalidatePath
      full_name: fullName,
      email,
      role,
      store_id: storeId || null,
      store_name: storeName,
      is_active: true,
      created_at: new Date().toISOString(),
      month_sales: 0,
      month_revenue: 0,
      meta_target: 0,
      meta_pct: 0,
      meta_reached: false,
    })
  }

  const title = isEdit ? `Editar — ${user!.full_name}` : 'Nova usuária'

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">

      {/* ── Banner pós-criação ───────────────────────────── */}
      {createdPassword ? (
        <div className={styles.createdBanner}>
          <p className={styles.createdTitle}>Usuária criada com sucesso!</p>
          <p className={styles.createdHint}>
            Copie a senha abaixo antes de fechar. Ela não será exibida novamente.
          </p>
          <div className={styles.passwordBox}>
            <code className={styles.passwordCode}>{createdPassword}</code>
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <div className={styles.createdFooter}>
            <Button variant="primary" size="md" onClick={handleCloseAfterCreate}>
              Fechar (já copiei)
            </Button>
          </div>
        </div>
      ) : (

        /* ── Formulário ────────────────────────────────── */
        <div className={styles.form}>
          <Input
            label="Nome completo"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            error={errors.fullName}
            placeholder="Ex: Michele Oliveira"
            autoFocus
          />

          {!isEdit && (
            <>
              <Input
                label="E-mail"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                error={errors.email}
                placeholder="email@exemplo.com"
              />

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Senha inicial</label>
                <div className={styles.passwordRow}>
                  <div className={styles.passwordInputWrap}>
                    <input
                      type={showPwd ? 'text' : 'password'}
                      className={`${styles.passwordInput} ${errors.password ? styles.inputError : ''}`}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mín. 6 caracteres"
                    />
                    <button
                      type="button"
                      className={styles.eyeBtn}
                      onClick={() => setShowPwd(p => !p)}
                      tabIndex={-1}
                    >
                      {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.generateBtn}
                    onClick={() => { const p = generatePassword(); setPassword(p); setShowPwd(true) }}
                  >
                    Gerar
                  </button>
                </div>
                {errors.password && <span className={styles.fieldError}>{errors.password}</span>}
              </div>
            </>
          )}

          <div className={styles.row}>
            {/* Papel */}
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Papel</label>
              <FormSelect
                value={role}
                onChange={v => { setRole(v); if (v === 'admin') setStoreId('') }}
                options={[
                  { value: 'operator', label: 'Operadora' },
                  { value: 'admin', label: 'Administrador' },
                ]}
              />
            </div>

            {/* Loja */}
            <div className={`${styles.fieldGroup} ${styles.flex1}`}>
              <label className={styles.fieldLabel}>
                Loja {role === 'operator' && <span className={styles.required}>*</span>}
              </label>
              <StoreSelect
                value={storeId}
                onChange={setStoreId}
                stores={stores}
                placeholder={role === 'admin' ? 'Sem loja (acesso global)' : 'Selecionar loja…'}
                error={!!errors.storeId}
              />
              {errors.storeId && <span className={styles.fieldError}>{errors.storeId}</span>}
            </div>
          </div>

          {isEdit && (
            <p className={styles.editNote}>
              Para redefinir a senha, use o botão de chave na listagem de usuárias.
            </p>
          )}

          {actionError && (
            <p className={styles.actionError}>{actionError}</p>
          )}

          <div className={styles.footer}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={submitting}
              onClick={handleSubmit}
            >
              {isEdit ? 'Salvar alterações' : 'Criar usuária'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
