'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Check, Info } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { criarDisparo, enviarDisparo, contarDestinatarios } from './actions'
import { TEMPLATES, renderPreview } from './templates'
import type { StoreOption } from './page'
import styles from './NovoDisparoModal.module.css'

interface Props {
  stores: StoreOption[]
  currentUserRole: string
  currentUserStoreId: string | null
  onClose: () => void
}

export default function NovoDisparoModal({ stores, currentUserRole, currentUserStoreId, onClose }: Props) {
  const isAdmin = currentUserRole === 'admin'
  const defaultStoreId = currentUserStoreId ?? stores[0]?.id ?? ''

  const [form, setForm] = useState({
    titulo: '',
    store_id: defaultStoreId,
    template_name: TEMPLATES[0]?.name ?? '',
    param2: '',
    param3: 'Agradecemos a sua preferência!',
  })
  const [countState, setCountState] = useState<{ store: string; n: number | null }>({ store: '', n: null })
  const [saving, setSaving]   = useState(false)
  const [sending, setSending] = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)
  const [errors, setErrors]   = useState<{ titulo?: string; param2?: string }>({})

  const tpl = TEMPLATES.find(t => t.name === form.template_name) ?? TEMPLATES[0]

  // conta destinatários da loja escolhida (setState só no callback async — evita cascading render)
  useEffect(() => {
    let alive = true
    const sid = form.store_id
    if (!sid) return
    contarDestinatarios(sid).then(c => { if (alive) setCountState({ store: sid, n: c }) })
    return () => { alive = false }
  }, [form.store_id])

  // null enquanto a contagem não corresponde à loja atual (estado "calculando")
  const count = countState.store === form.store_id ? countState.n : null

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm(f => ({ ...f, [k]: v }))
    if (k in errors) setErrors(e => ({ ...e, [k]: undefined }))
  }

  function validate(): boolean {
    const e: typeof errors = {}
    if (!form.titulo.trim()) e.titulo = 'Título é obrigatório'
    if (!form.param2.trim()) e.param2 = 'O assunto é obrigatório'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function salvar(disparar: boolean) {
    if (!validate()) return
    setServerErr(null)
    if (disparar) setSending(true); else setSaving(true)

    const res = await criarDisparo({
      titulo: form.titulo,
      store_id: form.store_id,
      template_name: tpl.name,
      template_language: tpl.language,
      param2: form.param2,
      param3: form.param3,
    })

    if (!res.success || !res.disparo_id) {
      setServerErr(res.error ?? 'Erro ao criar disparo'); setSaving(false); setSending(false); return
    }

    if (!disparar) { onClose(); window.location.reload(); return }

    // disparar agora (com confirmação)
    if (!confirm(`Disparar para ${res.total} cliente(s) agora?`)) {
      setSending(false); onClose(); window.location.reload(); return
    }
    const env = await enviarDisparo(res.disparo_id)
    setSending(false)
    if (!env.success) { alert('Disparo criado, mas houve erro no envio: ' + env.error) }
    onClose(); window.location.reload()
  }

  const storeName = stores.find(s => s.id === form.store_id)?.name ?? '—'
  const previewHtml = renderPreview(tpl, 'Fernanda', form.param2, form.param3)

  return (
    <Modal isOpen onClose={onClose} title="Novo disparo" size="lg">
      <div className={styles.body}>
        {/* Formulário */}
        <div className={styles.formCol}>
          <Field label="Título do disparo *" error={errors.titulo} hint="Só pra organização interna. O cliente não vê.">
            <input className={`${styles.input} ${errors.titulo ? styles.inputError : ''}`}
              value={form.titulo} onChange={e => set('titulo', e.target.value)}
              placeholder="Ex.: Convite lançamento — junho" maxLength={120} />
          </Field>

          <Field label="Loja (define o número que envia) *">
            {isAdmin ? (
              <StoreSelect stores={stores} value={form.store_id} onChange={v => set('store_id', v)} />
            ) : (
              <input className={styles.input} value={storeName} disabled style={{ opacity: .7, cursor: 'not-allowed' }} />
            )}
          </Field>

          <Field label="Template" hint="Texto fixo já aprovado. Você só preenche as variáveis.">
            <select className={styles.input} value={form.template_name} onChange={e => set('template_name', e.target.value)}>
              {TEMPLATES.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}
            </select>
          </Field>

          <Field label="{{2}} — Assunto *" error={errors.param2}>
            <input className={`${styles.input} ${errors.param2 ? styles.inputError : ''}`}
              value={form.param2} onChange={e => set('param2', e.target.value)}
              placeholder="o lançamento da nossa nova coleção" />
          </Field>

          <Field label="{{3}} — Fechamento (opcional)" hint='Deixe "." se não quiser nada aqui.'>
            <input className={styles.input} value={form.param3} onChange={e => set('param3', e.target.value)}
              placeholder="Agradecemos a sua preferência!" />
          </Field>

          <div className={styles.recipients}>
            <Info size={14} />
            {count === null
              ? <span>Calculando destinatários…</span>
              : <span>Será enviado para <strong>{count}</strong> cliente(s) da loja <strong>{storeName}</strong> (sem opt-out). O nome de cada um é preenchido automaticamente.</span>}
          </div>

          {serverErr && <div className={styles.serverError}>{serverErr}</div>}

          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="button" variant="outline" loading={saving} onClick={() => salvar(false)}>Salvar rascunho</Button>
            <Button type="button" loading={sending} onClick={() => salvar(true)}>Enviar agora</Button>
          </div>
          <div className={styles.note}>Salvar <b>não</b> envia — o envio é uma ação separada com confirmação.</div>
        </div>

        {/* Preview WhatsApp */}
        <div className={styles.previewCol}>
          <div className={styles.previewLabel}>Pré-visualização</div>
          <div className={styles.phone}>
            <div className={styles.waTop}>fevinicius</div>
            <div className={styles.waBody}>
              <div className={styles.bubble}>
                {previewHtml}
                {tpl.footer && <div className={styles.bubbleFooter}>{tpl.footer}</div>}
                <div className={styles.bubbleTime}>14:32 ✓✓</div>
              </div>
            </div>
          </div>
          <div className={styles.previewHint}><Info size={13} /> O nome <span className={styles.var}>{'{{1}}'}</span> é preenchido por cliente.</div>
        </div>
      </div>
    </Modal>
  )
}

function StoreSelect({ stores, value, onChange }: { stores: StoreOption[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = stores.find(s => s.id === value)
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className={styles.select} ref={ref}>
      <button type="button" className={`${styles.selectTrigger} ${open ? styles.selectOpen : ''}`} onClick={() => setOpen(o => !o)}>
        <span>{selected?.name ?? 'Selecione a loja'}</span>
        <ChevronDown size={14} className={open ? styles.chevronOpen : ''} />
      </button>
      {open && (
        <div className={styles.dropdown}>
          {stores.map(s => (
            <button key={s.id} type="button"
              className={`${styles.option} ${s.id === value ? styles.optionActive : ''}`}
              onClick={() => { onChange(s.id); setOpen(false) }}>
              <span>{s.name}</span>
              {s.id === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      {children}
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  )
}
