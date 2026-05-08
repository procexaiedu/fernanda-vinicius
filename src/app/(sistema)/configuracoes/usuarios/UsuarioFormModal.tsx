'use client'

import { useState } from 'react'
import { Eye, EyeOff, Copy, Check } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import type { UserWithMetrics } from './page'
import { createUser, updateUser } from './actions'
import styles from './UsuarioFormModal.module.css'

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
              <select
                className={styles.select}
                value={role}
                onChange={e => setRole(e.target.value as 'admin' | 'operator')}
              >
                <option value="operator">Operadora</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            {/* Loja */}
            <div className={`${styles.fieldGroup} ${styles.flex1}`}>
              <label className={styles.fieldLabel}>
                Loja {role === 'operator' && <span className={styles.required}>*</span>}
              </label>
              <select
                className={`${styles.select} ${errors.storeId ? styles.selectError : ''}`}
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
              >
                <option value="">
                  {role === 'admin' ? 'Sem loja (acesso global)' : 'Selecionar loja…'}
                </option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
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
