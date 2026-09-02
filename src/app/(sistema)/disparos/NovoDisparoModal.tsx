'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, Check, Info, ImagePlus, Loader2, X, Search } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { criarDisparo, atualizarDisparo, enviarDisparo, listarClientes, listarDestinatarios, listarTemplates, type TemplateMeta, type ClienteOption } from './actions'
import { renderPreview } from './templates'
import type { StoreOption, DisparoRow } from './page'
import styles from './NovoDisparoModal.module.css'
import { formatarTelefone } from '@/lib/telefone'
import SearchableSelect from '@/components/ui/SearchableSelect'

interface Props {
  stores: StoreOption[]
  currentUserRole: string
  currentUserStoreId: string | null
  editDisparo?: DisparoRow | null
  onClose: () => void
}

const miniBtn: React.CSSProperties = {
  padding: '0 10px', height: 32, fontSize: 12, borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
}


export default function NovoDisparoModal({ stores, currentUserRole, currentUserStoreId, editDisparo, onClose }: Props) {
  const isAdmin = currentUserRole === 'admin'
  const isEdit = !!editDisparo
  const defaultStoreId = currentUserStoreId ?? stores[0]?.id ?? ''

  const [templates, setTemplates] = useState<TemplateMeta[] | null>(null)
  const [tplError, setTplError]   = useState<string | null>(null)

  const [form, setForm] = useState({
    titulo: editDisparo?.titulo ?? '',
    store_id: editDisparo?.store_id ?? defaultStoreId,
    template_name: editDisparo?.template_name ?? '',
    param2: editDisparo?.param2 ?? '',
    param3: (editDisparo?.param3 && editDisparo.param3 !== '.') ? editDisparo.param3 : '',
    image_url: (editDisparo?.image_url ?? '') as string,
  })
  const [clientes, setClientes] = useState<ClienteOption[] | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** DDDs escolhidos no filtro. Vazio = todos. */
  const [dddFiltro, setDddFiltro] = useState<string[]>([])
  const [dddDigitando, setDddDigitando] = useState('')
  const [clienteSearch, setClienteSearch] = useState('')
  const [saving, setSaving]     = useState(false)
  const [sending, setSending]   = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)
  const [errors, setErrors]     = useState<{ titulo?: string; param2?: string; image?: string; template?: string; destinatarios?: string }>({})

  // Carrega os templates aprovados da WABA
  useEffect(() => {
    let alive = true
    listarTemplates().then(res => {
      if (!alive) return
      if (!res.success) { setTplError(res.error ?? 'Erro ao carregar templates'); setTemplates([]); return }
      const list = res.templates ?? []
      setTemplates(list)
      if (list[0]) setForm(f => ({ ...f, template_name: f.template_name || list[0].name }))
    })
    return () => { alive = false }
  }, [])

  const tpl = templates?.find(t => t.name === form.template_name) ?? null
  const needsImage = tpl?.headerFormat === 'IMAGE'

  /**
   * DDD do cliente: só dígitos, sem o `55` do internacional, os 2 primeiros.
   * A base tem formato misto (`(61) 98111-8248` e `+556181227155`) — sem tirar
   * o 55, o DDD sairia "55" para metade dos cadastros.
   */
  function dddDe(phone: string): string {
    const d = (phone || '').replace(/\D/g, '').replace(/^55/, '')
    return d.length >= 10 ? d.slice(0, 2) : '—'
  }

  /*
   * DDDs presentes, do mais comum para o menos.
   *
   * Só serve de sugestão, e sugestão curta: a lista completa da loja de
   * Brasília tem mais de 50 entradas, várias delas DDD inválido vindo de
   * telefone malformado (04, 00, 43). Mostrar tudo virou uma parede.
   */
  const ddds = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of clientes ?? []) m.set(dddDe(c.phone), (m.get(dddDe(c.phone)) ?? 0) + 1)
    return [...m.entries()]
      .filter(([d]) => d !== '—')
      .map(([ddd, qtd]) => ({ ddd, qtd }))
      .sort((a, b) => b.qtd - a.qtd)
  }, [clientes])

  function addDdd(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 2)
    if (d.length !== 2) return
    setDddFiltro(p => (p.includes(d) ? p : [...p, d]))
    setDddDigitando('')
  }
  function removeDdd(d: string) {
    setDddFiltro(p => p.filter(x => x !== d))
  }

  /*
   * Carrega os clientes da loja.
   *
   * Novo disparo: pré-seleciona só o DDD dominante da loja, não todos. Depois
   * da importação da agenda, Brasília ficou com 2.793 clientes mas só 2.376 com
   * DDD 61 — os outros 417 são de Campinas, SP e Goiânia, salvos no celular de
   * lá. Marcar todos mandaria mensagem para eles sem ninguém perceber.
   *
   * Os outros DDDs não somem: o campo mostra o filtro ativo, as sugestões
   * trazem os maiores de volta com um clique, e o rodapé conta quantos ficaram
   * de fora. A exclusão é visível, não silenciosa — que era o problema.
   *
   * Edição: respeita os destinatários já gravados no disparo.
   */
  useEffect(() => {
    let alive = true
    const sid = form.store_id
    if (!sid) return
    setClientes(null)
    setDddFiltro([])
    setDddDigitando('')
    Promise.all([
      listarClientes(sid),
      (isEdit && editDisparo) ? listarDestinatarios(editDisparo.disparo_id) : Promise.resolve<string[] | null>(null),
    ]).then(([cs, sel]) => {
      if (!alive) return
      setClientes(cs)
      if (sel) { setSelectedIds(new Set(sel)); return }

      const contagem = new Map<string, number>()
      for (const c of cs) contagem.set(dddDe(c.phone), (contagem.get(dddDe(c.phone)) ?? 0) + 1)
      const dominante = [...contagem.entries()]
        .filter(([d]) => d !== '—')
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

      setDddFiltro(dominante ? [dominante] : [])
      setSelectedIds(new Set(
        cs.filter(c => !dominante || dddDe(c.phone) === dominante).map(c => c.id)
      ))
    })
    return () => { alive = false }
  }, [form.store_id, isEdit, editDisparo])

  const filteredClientes = useMemo(() => {
    let list = clientes ?? []
    if (dddFiltro.length) list = list.filter(c => dddFiltro.includes(dddDe(c.phone)))
    const q = clienteSearch.trim().toLowerCase()
    if (!q) return list
    const qd = q.replace(/\D/g, '')
    return list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (qd && (c.phone || '').replace(/\D/g, '').includes(qd))
    )
  }, [clientes, clienteSearch, dddFiltro])

  /* Selecionados que estão FORA do DDD ativo — para a conta no rodapé não
     mentir quando a pessoa filtra depois de já ter marcado gente. */
  const selecionadosForaDoFiltro = useMemo(() => {
    if (!dddFiltro.length) return 0
    return (clientes ?? []).filter(c => selectedIds.has(c.id) && !dddFiltro.includes(dddDe(c.phone))).length
  }, [clientes, selectedIds, dddFiltro])

  function toggleCliente(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    setErrors(e => ({ ...e, destinatarios: undefined }))
  }
  function selectAll()  { setSelectedIds(new Set((clientes ?? []).map(c => c.id))) }
  function selectNone() { setSelectedIds(new Set()) }
  function selectFiltrados() { setSelectedIds(prev => { const n = new Set(prev); filteredClientes.forEach(c => n.add(c.id)); return n }) }

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm(f => ({ ...f, [k]: v }))
    if (k in errors) setErrors(e => ({ ...e, [k]: undefined }))
  }

  function validate(): boolean {
    const e: typeof errors = {}
    if (!form.titulo.trim()) e.titulo = 'Título é obrigatório'
    if (!tpl) e.template = 'Selecione um template'
    if (tpl && tpl.bodyVarCount >= 2 && !form.param2.trim()) e.param2 = 'O texto da campanha é obrigatório'
    if (needsImage && !form.image_url) e.image = 'Este template exige uma imagem'
    if (selectedIds.size === 0) e.destinatarios = 'Selecione ao menos 1 cliente'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function salvar(disparar: boolean) {
    if (!validate()) return
    setServerErr(null)
    if (disparar) setSending(true); else setSaving(true)

    const payload = {
      titulo: form.titulo,
      store_id: form.store_id,
      template_name: tpl!.name,
      template_language: tpl!.language,
      param2: form.param2,
      param3: form.param3,
      image_url: form.image_url || null,
      customer_ids: Array.from(selectedIds),
    }

    let disparoId: string
    let total: number

    if (isEdit && editDisparo) {
      const res = await atualizarDisparo(editDisparo.disparo_id, payload)
      if (!res.success) { setServerErr(res.error ?? 'Erro ao salvar'); setSaving(false); setSending(false); return }
      disparoId = editDisparo.disparo_id
      total = editDisparo.total
    } else {
      const res = await criarDisparo(payload)
      if (!res.success || !res.disparo_id) {
        setServerErr(res.error ?? 'Erro ao criar disparo'); setSaving(false); setSending(false); return
      }
      disparoId = res.disparo_id
      total = res.total ?? 0
    }

    if (!disparar) { onClose(); window.location.reload(); return }

    if (!confirm(`Disparar para ${total} cliente(s) agora?`)) {
      setSending(false); onClose(); window.location.reload(); return
    }
    const env = await enviarDisparo(disparoId)
    setSending(false)
    if (!env.success) { alert('Salvo, mas houve erro no envio: ' + env.error) }
    onClose(); window.location.reload()
  }

  const storeName = stores.find(s => s.id === form.store_id)?.name ?? '—'
  const previewHtml = tpl ? renderPreview(tpl.bodyText, 'Fernanda', form.param2, form.param3) : ''

  const busy = saving || sending

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Editar disparo' : 'Novo disparo'} size="lg">
      <div className={styles.body}>
        {/* Formulário */}
        <div className={styles.formCol}>
          <Field label="Título do disparo *" error={errors.titulo} hint="Só pra organização interna. O cliente não vê.">
            <input className={`${styles.input} ${errors.titulo ? styles.inputError : ''}`}
              value={form.titulo} onChange={e => set('titulo', e.target.value)}
              placeholder="Ex.: Convite arraiá — julho" maxLength={120} />
          </Field>

          <Field label="Loja (define o número que envia) *"
            hint={isEdit ? 'A loja não muda na edição. Pra trocar, duplique ou crie um novo.' : undefined}>
            {isAdmin && !isEdit ? (
              <StoreSelect stores={stores} value={form.store_id} onChange={v => set('store_id', v)} />
            ) : (
              <input className={styles.input} value={storeName} disabled style={{ opacity: .7, cursor: 'not-allowed' }} />
            )}
          </Field>

          <Field label="Template" hint="Puxado direto da WABA. Só aparecem os aprovados." error={errors.template}>
            {templates === null ? (
              <div className={styles.input} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: .7 }}>
                <Loader2 size={14} className={styles.spin} /> Carregando templates…
              </div>
            ) : templates.length === 0 ? (
              <div className={styles.input} style={{ opacity: .8, fontSize: 12 }}>
                {tplError ? `Erro: ${tplError}` : 'Nenhum template aprovado nesta WABA ainda.'}
              </div>
            ) : (
              <SearchableSelect
                value={form.template_name}
                onChange={v => set('template_name', v)}
                options={templates.map(t => ({
                  value: t.name,
                  label: `${t.name} · ${t.category}${t.headerFormat === 'IMAGE' ? ' · imagem' : ''}`,
                }))}
                placeholder="Escolha o template"
                permitirLimpar={false}
              />
            )}
          </Field>

          {needsImage && (
            <Field label="Imagem da campanha *" error={errors.image} hint="Arte com data/coleção/detalhes. JPEG ou PNG, até 5MB.">
              <ImageUpload value={form.image_url} onChange={url => { set('image_url', url); setErrors(e => ({ ...e, image: undefined })) }} />
            </Field>
          )}

          {tpl && tpl.bodyVarCount >= 2 && (
            <Field label="Texto da campanha ({{2}}) *" error={errors.param2}
              hint="O motivo + convite. Ex.: “Chegou nosso arraiá! Vem garantir a sua…”">
              <textarea className={`${styles.input} ${errors.param2 ? styles.inputError : ''}`}
                value={form.param2} onChange={e => set('param2', e.target.value)}
                rows={3} style={{ resize: 'vertical', fontFamily: 'inherit', height: 'auto', minHeight: 74, padding: '9px 11px' }}
                placeholder="Escreva o miolo do convite desta campanha" />
            </Field>
          )}

          {tpl && tpl.bodyVarCount >= 3 && (
            <Field label="Texto extra ({{3}}) — opcional" hint='Deixe vazio se o template não precisar.'>
              <input className={styles.input} value={form.param3} onChange={e => set('param3', e.target.value)} />
            </Field>
          )}

          {(
            <Field
              label={`Destinatários — ${selectedIds.size} selecionado(s)`}
              error={errors.destinatarios}
              hint="Marque quem vai receber. Busque por nome ou telefone. O nome de cada um entra no {{1}}.">
              {clientes === null ? (
                <div className={styles.input} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: .7 }}>
                  <Loader2 size={14} className={styles.spin} /> Carregando clientes…
                </div>
              ) : clientes.length === 0 ? (
                <div className={styles.input} style={{ opacity: .8, fontSize: 12 }}>Nenhum cliente elegível nesta loja.</div>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
                      <input className={styles.input} style={{ height: 36, paddingLeft: 30 }}
                        placeholder="Buscar nome ou telefone…" value={clienteSearch}
                        onChange={e => setClienteSearch(e.target.value)} />
                    </div>
                    <button type="button" onClick={selectAll} style={miniBtn}>Todos</button>
                    <button type="button" onClick={selectNone} style={miniBtn}>Nenhum</button>
                  </div>

                  {/* DDD digitado, não listado. A loja de Brasília tem mais de
                      50 DDDs distintos — vários inválidos, vindos de telefone
                      malformado. A sugestão mostra só os três maiores. */}
                  {ddds.length > 1 && (
                    <div className={styles.dddBar}>
                      <span className={styles.dddLabel}>DDD</span>

                      <div className={styles.dddCampo}>
                        {dddFiltro.map(d => (
                          <span key={d} className={styles.dddChip}>
                            {d}
                            <button type="button" className={styles.dddChipX}
                              onClick={() => removeDdd(d)} aria-label={`Remover DDD ${d}`}>
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                        <input
                          className={styles.dddInput}
                          inputMode="numeric"
                          value={dddDigitando}
                          placeholder={dddFiltro.length ? 'mais um…' : 'todos — digite p/ filtrar'}
                          onChange={e => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                            // 2 dígitos já é um DDD: vira chip sozinho, sem exigir Enter
                            if (v.length === 2) addDdd(v); else setDddDigitando(v)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); addDdd(dddDigitando) }
                            // apagar com o campo vazio tira o último chip
                            if (e.key === 'Backspace' && !dddDigitando && dddFiltro.length) {
                              removeDdd(dddFiltro[dddFiltro.length - 1])
                            }
                          }}
                        />
                      </div>

                      <div className={styles.dddSugestoes}>
                        {ddds.filter(d => !dddFiltro.includes(d.ddd)).slice(0, 3).map(d => (
                          <button key={d.ddd} type="button" className={styles.dddSugestao}
                            onClick={() => addDdd(d.ddd)}>
                            + {d.ddd} <span style={{ opacity: .65 }}>{d.qtd}</span>
                          </button>
                        ))}
                        {dddFiltro.length > 0 && (
                          <button type="button" className={styles.dddSugestao}
                            onClick={() => setDddFiltro([])}>
                            limpar
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {(clienteSearch || dddFiltro.length > 0) && filteredClientes.length > 0 && (
                    <button type="button" onClick={selectFiltrados}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 40, border: 'none', borderBottom: '1px solid var(--border)', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                      <Check size={16} /> Adicionar os {filteredClientes.length} mostrados à seleção
                    </button>
                  )}

                  <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                    {filteredClientes.map(c => {
                      const on = selectedIds.has(c.id)
                      return (
                        <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,.04))', background: on ? 'var(--accent-subtle)' : 'transparent' }}>
                          <input type="checkbox" checked={on} onChange={() => toggleCliente(c.id)} style={{ width: 17, height: 17, flexShrink: 0, cursor: 'pointer' }} />
                          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: on ? 600 : 400 }}>{c.name}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>{formatarTelefone(c.phone)}</span>
                        </label>
                      )
                    })}
                    {filteredClientes.length === 0 && (
                      <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>Nenhum resultado.</div>
                    )}
                  </div>

                  <div style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span>
                      {filteredClientes.length} mostrado(s)
                      {dddFiltro.length ? ` · DDD ${dddFiltro.join(', ')}` : ''}
                      {clienteSearch ? ' · busca' : ''}
                    </span>
                    <span>
                      {/* Sem isto o total mente: filtrar por DDD depois de já ter
                          marcado gente esconde quem ficou selecionado fora dele. */}
                      {selecionadosForaDoFiltro > 0 && (
                        <span style={{ color: 'var(--warning, var(--accent))', marginRight: 10 }}>
                          +{selecionadosForaDoFiltro} de outro DDD
                        </span>
                      )}
                      <strong style={{ color: 'var(--accent)' }}>{selectedIds.size}</strong> selecionado(s)
                    </span>
                  </div>
                </div>
              )}
            </Field>
          )}

          {serverErr && <div className={styles.serverError}>{serverErr}</div>}

          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="button" variant="outline" loading={saving} disabled={busy || !tpl} onClick={() => salvar(false)}>{isEdit ? 'Salvar alterações' : 'Salvar rascunho'}</Button>
            <Button type="button" loading={sending} disabled={busy || !tpl} onClick={() => salvar(true)}>Enviar agora</Button>
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
                {needsImage && (
                  form.image_url
                    ? <img src={form.image_url} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 8, display: 'block' }} />
                    : <div style={{ width: '100%', aspectRatio: '1.6', borderRadius: 8, marginBottom: 8, background: 'rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, gap: 6 }}>
                        <ImagePlus size={16} /> imagem da campanha
                      </div>
                )}
                {tpl ? <span style={{ whiteSpace: 'pre-wrap' }}>{previewHtml}</span> : <span style={{ opacity: .6 }}>Selecione um template…</span>}
                {tpl?.footer && <div className={styles.bubbleFooter}>{tpl.footer}</div>}
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

// Upload de imagem (reusa /api/upload -> MinIO, retorna { url })
function ImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setErr(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload-disparo', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setErr(data?.error ?? 'Erro no upload'); return }
      onChange(data.url)
    } catch {
      setErr('Falha no upload')
    } finally {
      setUploading(false)
    }
  }

  if (value) {
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <img src={value} alt="" style={{ maxWidth: 220, maxHeight: 130, borderRadius: 8, display: 'block', border: '1px solid var(--border)' }} />
        <button type="button" onClick={() => onChange('')}
          style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.7)', border: 'none', borderRadius: 6, color: '#fff', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
        className={styles.input}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
        {uploading ? <><Loader2 size={16} className={styles.spin} /> Enviando…</> : <><ImagePlus size={16} /> Escolher imagem</>}
      </button>
      {err && <span className={styles.error}>{err}</span>}
    </div>
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
