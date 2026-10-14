'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, Check, Info, ImagePlus, Loader2, X, ArrowLeft, ArrowRight, Send, Users, Ban, Wallet, AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { criarDisparo, atualizarDisparo, enviarDisparo, listarCandidatos, listarListas, listarDestinatarios, listarTemplates, infoEnvio, type TemplateMeta, type Candidato, type ListaSalva } from './actions'
import DestinatariosPicker, { FILTROS_PADRAO, dddDe, recebeuHaPouco, aplicar, MOTIVO, type Filtros } from './DestinatariosPicker'
import { renderPreview } from './templates'
import type { StoreOption, DisparoRow } from './page'
import styles from './NovoDisparoModal.module.css'
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
  const [clientes, setClientes] = useState<Candidato[] | null>(null)
  const [clientesErro, setClientesErro] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO)
  const [listas, setListas] = useState<ListaSalva[]>([])
  const [envio, setEnvio] = useState<{ limiteDia: number | null; saldoUsd: number | null; custoMsgUsd: number }>({ limiteDia: null, saldoUsd: null, custoMsgUsd: 0.0625 })
  const [etapa, setEtapa] = useState(0)
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

  /*
   * Carrega as candidatas da loja (com histórico de compra e exclusão).
   *
   * Novo disparo: o filtro começa em "já comprou" + DDD dominante da loja, e a
   * seleção é quem passa nele e não está excluída. Brasília tem centenas de
   * contatos de agenda importada; mandar para eles foi o que bloqueou a conta
   * em 16/09.
   *
   * Edição: respeita os destinatários já gravados, menos os excluídos depois.
   */
  useEffect(() => {
    let alive = true
    const sid = form.store_id
    if (!sid) return
    infoEnvio(sid).then(r => { if (alive) setEnvio(r) })
    setListas([])
    listarListas(sid).then(r => { if (alive && r.ok) setListas(r.listas ?? []) })
    Promise.all([
      listarCandidatos(sid),
      (isEdit && editDisparo) ? listarDestinatarios(editDisparo.disparo_id) : Promise.resolve<string[] | null>(null),
    ]).then(([res, sel]) => {
      if (!alive) return
      if (!res.ok) { setClientesErro(res.error ?? 'Erro ao carregar clientes'); setClientes([]); return }
      const cs = res.candidatos ?? []
      setClientes(cs)
      const excl = new Set(cs.filter(c => c.excluido).map(c => c.id))
      if (sel) { setFiltros({ ...FILTROS_PADRAO, publico: 'todos', minCompras: 0 }); setSelectedIds(new Set(sel.filter(id => !excl.has(id)))); return }

      const compradoras = cs.filter(c => c.compras > 0)
      const contagem = new Map<string, number>()
      for (const c of compradoras) contagem.set(dddDe(c.phone), (contagem.get(dddDe(c.phone)) ?? 0) + 1)
      const dominante = [...contagem.entries()].filter(([d]) => d !== '—').sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

      setFiltros({ ...FILTROS_PADRAO, ddds: dominante ? [dominante] : [] })
      setSelectedIds(new Set(compradoras.filter(c => !c.excluido && !recebeuHaPouco(c, FILTROS_PADRAO.semRepetirDias) && (!dominante || dddDe(c.phone) === dominante)).map(c => c.id)))
    })
    return () => { alive = false }
  }, [form.store_id, isEdit, editDisparo])

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm(f => ({ ...f, [k]: v }))
    if (k in errors) setErrors(e => ({ ...e, [k]: undefined }))
  }

  function validate(disparar = false): boolean {
    const e: typeof errors = {}
    if (!form.titulo.trim()) e.titulo = 'Título é obrigatório'
    if (!tpl) e.template = 'Selecione um template'
    if (tpl && tpl.bodyVarCount >= 2 && !form.param2.trim()) e.param2 = 'O texto da campanha é obrigatório'
    if (needsImage && !form.image_url) e.image = 'Este template exige uma imagem'
    if (selectedIds.size === 0) e.destinatarios = 'Selecione ao menos 1 cliente'
    else if (disparar && envio.limiteDia != null && selectedIds.size > envio.limiteDia)
      e.destinatarios = `O número só envia ${envio.limiteDia} por dia. Reduza a seleção para enviar (rascunho pode salvar).`
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function salvar(disparar: boolean) {
    if (!validate(disparar)) { setEtapa(erroEtapa0() ? 0 : disparar && selectedIds.size > 0 ? 2 : 1); return }
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

  /* Resumo da etapa 3: quem recebe, quem ficou de fora e por quê. Mesmas
     regras do picker (aplicar/recebeuHaPouco), só contadas. */
  const resumo = useMemo(() => {
    const cs = clientes ?? []
    const lista = listas.find(l => l.id === filtros.lista) ?? null
    const membros = lista ? new Set(lista.customer_ids) : null
    const base = aplicar(cs, { ...filtros, semRepetirDias: null }, membros)
    const porMotivo = new Map<string, number>()
    let recentes = 0
    for (const c of base) {
      if (c.excluido) porMotivo.set(c.excluido, (porMotivo.get(c.excluido) ?? 0) + 1)
      else if (recebeuHaPouco(c, filtros.semRepetirDias)) recentes++
    }
    const excluidos = [...porMotivo.entries()].sort((a, b) => b[1] - a[1])
      .map(([m, n]) => ({ motivo: MOTIVO[m] ?? m, n }))
    const nuncaCompraram = cs.filter(c => selectedIds.has(c.id) && c.compras === 0).length
    return { excluidos, totalExcl: excluidos.reduce((s, e) => s + e.n, 0), recentes, nuncaCompraram, lista: lista?.nome ?? null }
  }, [clientes, listas, filtros, selectedIds])

  const total = selectedIds.size
  const custo = total * envio.custoMsgUsd
  const passaLimite = envio.limiteDia != null && total > envio.limiteDia
  const passaSaldo = envio.saldoUsd != null && custo > envio.saldoUsd

  function erroEtapa0() {
    return !form.titulo.trim() || !tpl || (tpl.bodyVarCount >= 2 && !form.param2.trim()) || (needsImage && !form.image_url)
  }
  function irPara(n: number) {
    if (n > 0 && erroEtapa0()) { validate(); setEtapa(0); return }
    if (n > 1 && total === 0) { validate(); setEtapa(1); return }
    setErrors({})
    setEtapa(n)
  }

  const ETAPAS = ['Mensagem', 'Público', 'Revisar e enviar']

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Editar disparo' : 'Novo disparo'} size="xl2">
      <ol className={styles.stepper} aria-label="Etapas do disparo">
        {ETAPAS.map((nome, i) => (
          <li key={nome}>
            <button type="button" onClick={() => irPara(i)} aria-current={etapa === i ? 'step' : undefined}
              className={`${styles.step} ${etapa === i ? styles.stepOn : ''} ${etapa > i ? styles.stepDone : ''}`}>
              <span className={styles.stepNum}>{etapa > i ? <Check size={13} /> : i + 1}</span>
              <span className={styles.stepNome}>{nome}</span>
              {i === 1 && clientes && <span className={styles.stepConta}>{total}</span>}
            </button>
          </li>
        ))}
      </ol>

      <div className={styles.body}>
        <div className={styles.formCol}>
        {etapa === 0 && (<>
          <Field label="Título do disparo *" error={errors.titulo} hint="Só pra organização interna. O cliente não vê.">
            <input className={`${styles.input} ${errors.titulo ? styles.inputError : ''}`}
              value={form.titulo} onChange={e => set('titulo', e.target.value)}
              placeholder="Ex.: Convite arraiá — julho" maxLength={120} />
          </Field>

          {/*
            A loja faz DUAS coisas, e o rótulo antigo só contava uma.

            Ela decide quem RECEBE — `listarClientes(sid)`, no efeito acima, que
            recarrega a lista inteira e refaz a seleção — e de qual número SAI
            (`stores.whatsapp_phone`, em lib/disparo/enviarLote).

            Quem lia "define o número que envia" não imaginava que trocar a loja
            trocava os destinatários. Pior: a troca acontece sem aviso, e quem
            já tinha marcado nomes à mão perde a marcação.
          */}
          <Field label="Loja (define os clientes e o número que envia) *"
            hint={isEdit
              ? 'A loja não muda na edição. Pra trocar, duplique ou crie um novo.'
              : 'Trocar a loja recarrega a lista de clientes e refaz a seleção.'}>
            {isAdmin && !isEdit ? (
              <StoreSelect stores={stores} value={form.store_id} onChange={v => { setClientes(null); setClientesErro(null); set('store_id', v) }} />
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
        </>)}

        {etapa === 1 && (
          <Field
            label={`Quem vai receber — ${selectedIds.size} selecionado(s)`}
            error={errors.destinatarios}
            hint="Comece por quem já comprou na loja. Quem está na lista de exclusão aparece apagada e não recebe.">
            {clientes === null ? (
              <div className={styles.input} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: .7 }}>
                <Loader2 size={14} className={styles.spin} /> Carregando clientes…
              </div>
            ) : clientesErro ? (
              <div className={styles.serverError}>{clientesErro}</div>
            ) : clientes.length === 0 ? (
              <div className={styles.input} style={{ opacity: .8, fontSize: 12 }}>Nenhum cliente elegível nesta loja.</div>
            ) : (
              <DestinatariosPicker
                candidatos={clientes}
                listas={listas}
                selecionados={selectedIds}
                onChange={s => { setSelectedIds(s); setErrors(e => ({ ...e, destinatarios: undefined })) }}
                filtros={filtros}
                onFiltros={setFiltros}
                limiteDia={envio.limiteDia}
                saldoUsd={envio.saldoUsd}
                custoMsgUsd={envio.custoMsgUsd}
              />
            )}
          </Field>
        )}

        {etapa === 2 && (
          <div className={styles.revisao}>
            <div className={styles.resumoGrid}>
              <div className={`${styles.resumoCard} ${styles.resumoOk}`}>
                <Users size={16} />
                <span className={styles.resumoRot}>Vão receber</span>
                <strong className={`${styles.resumoNum} ${passaLimite ? styles.ruim : ''}`}>{total}</strong>
                <span className={styles.resumoSub}>{envio.limiteDia != null ? `limite de ${envio.limiteDia} por dia` : 'clientes selecionadas'}</span>
              </div>
              <div className={`${styles.resumoCard} ${styles.resumoExcl}`}>
                <Ban size={16} />
                <span className={styles.resumoRot}>Ficaram de fora</span>
                <strong className={styles.resumoNum}>{resumo.totalExcl + resumo.recentes}</strong>
                <span className={styles.resumoSub}>no filtro escolhido</span>
              </div>
              <div className={`${styles.resumoCard} ${styles.resumoCusto}`}>
                <Wallet size={16} />
                <span className={styles.resumoRot}>Custo estimado</span>
                <strong className={`${styles.resumoNum} ${passaSaldo ? styles.ruim : ''}`}>US$ {custo.toFixed(2)}</strong>
                <span className={styles.resumoSub}>{envio.saldoUsd != null ? `saldo US$ ${envio.saldoUsd.toFixed(2)}` : 'saldo não lido'}</span>
              </div>
            </div>

            <div className={styles.porque}>
              <div className={styles.porqueTit}>Por que ficaram de fora</div>
              {resumo.totalExcl + resumo.recentes === 0 ? (
                <div className={styles.porqueVazio}>Ninguém do filtro ficou de fora.</div>
              ) : (
                <ul className={styles.porqueLista}>
                  {resumo.recentes > 0 && <li><span>Já receberam disparo nos últimos {filtros.semRepetirDias} dias</span><b>{resumo.recentes}</b></li>}
                  {resumo.excluidos.map(e => <li key={e.motivo}><span>Lista de exclusão: {e.motivo}</span><b>{e.n}</b></li>)}
                </ul>
              )}
            </div>

            <dl className={styles.ficha}>
              <div><dt>Campanha</dt><dd>{form.titulo || '—'}</dd></div>
              <div><dt>Loja / número</dt><dd>{storeName}</dd></div>
              <div><dt>Template</dt><dd>{tpl?.name ?? '—'}</dd></div>
              {resumo.lista && <div><dt>Lista salva</dt><dd>{resumo.lista}</dd></div>}
            </dl>

            {passaLimite && <Aviso>O número só pode iniciar {envio.limiteDia} conversas por dia. Volte ao Público e reduza a seleção (rascunho pode salvar).</Aviso>}
            {passaSaldo && <Aviso>O saldo da YCloud não cobre este envio. Peça a recarga antes de enviar.</Aviso>}
            {resumo.nuncaCompraram > 0 && <Aviso>{resumo.nuncaCompraram} selecionada(s) nunca compraram nesta loja.</Aviso>}
            {errors.destinatarios && <span className={styles.error}>{errors.destinatarios}</span>}
          </div>
        )}

          {serverErr && <div className={styles.serverError}>{serverErr}</div>}

          <div className={styles.actions}>
            {etapa === 0
              ? <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
              : <Button type="button" variant="ghost" onClick={() => setEtapa(etapa - 1)}><ArrowLeft size={14} /> Voltar</Button>}
            <span className={styles.actionsGap} />
            <Button type="button" variant="outline" loading={saving} disabled={busy || !tpl} onClick={() => salvar(false)}>{isEdit ? 'Salvar alterações' : 'Salvar rascunho'}</Button>
            {etapa < 2
              ? <Button type="button" onClick={() => irPara(etapa + 1)}>Continuar <ArrowRight size={14} /></Button>
              : <Button type="button" loading={sending} disabled={busy || !tpl} onClick={() => salvar(true)}><Send size={14} /> Enviar para {total}</Button>}
          </div>
          <div className={styles.note}>Salvar <b>não</b> envia. O envio pede confirmação antes de sair.</div>
        </div>

        {/* Preview WhatsApp */}
        <div className={`${styles.previewCol} ${etapa === 1 ? styles.previewOculta : ''}`}>
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

function Aviso({ children }: { children: React.ReactNode }) {
  return <div className={styles.aviso}><AlertTriangle size={14} /><span>{children}</span></div>
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
