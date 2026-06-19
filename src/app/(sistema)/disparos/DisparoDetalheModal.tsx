'use client'

import { useState } from 'react'
import { Info, Send } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { enviarDisparo } from './actions'
import { TEMPLATES, renderPreview } from './templates'
import type { DisparoRow } from './page'
import styles from './DisparoDetalheModal.module.css'

const STATUS_BADGE: Record<string, { variant: 'success' | 'warning' | 'accent' | 'muted'; label: string }> = {
  rascunho:  { variant: 'warning', label: 'Rascunho' },
  enviando:  { variant: 'accent',  label: 'Enviando' },
  concluido: { variant: 'success', label: 'Concluído' },
  cancelado: { variant: 'muted',   label: 'Cancelado' },
}

function formatDateTime(s: string | null) {
  return s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

interface Props {
  disparo: DisparoRow
  onClose: () => void
}

export default function DisparoDetalheModal({ disparo: d, onClose }: Props) {
  const [sending, setSending] = useState(false)
  const tpl = TEMPLATES.find(t => t.name === d.template_name) ?? TEMPLATES[0]
  const badge = STATUS_BADGE[d.status] ?? STATUS_BADGE.cancelado
  const isDraft = d.status === 'rascunho'
  const previewHtml = tpl ? renderPreview(tpl, 'Fernanda', d.param2 ?? '', d.param3 ?? '.') : ''

  async function handleSend() {
    if (!confirm(`Disparar "${d.titulo}" para ${d.total} cliente(s) da loja ${d.store_name}?`)) return
    setSending(true)
    const r = await enviarDisparo(d.disparo_id)
    setSending(false)
    if (!r.success) alert('Erro ao disparar: ' + r.error)
    onClose(); window.location.reload()
  }

  return (
    <Modal isOpen onClose={onClose} title={d.titulo} size="lg">
      <div className={styles.body}>
        {/* Infos + métricas */}
        <div className={styles.infoCol}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Status</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <div className={styles.metaRow}><span className={styles.metaLabel}>Loja</span><span>{d.store_name}</span></div>
          <div className={styles.metaRow}><span className={styles.metaLabel}>Template</span><span>{tpl?.label ?? d.template_name}</span></div>
          <div className={styles.metaRow}><span className={styles.metaLabel}>Criado em</span><span>{formatDateTime(d.created_at)}</span></div>
          {d.sent_at && <div className={styles.metaRow}><span className={styles.metaLabel}>Enviado em</span><span>{formatDateTime(d.sent_at)}</span></div>}

          <div className={styles.params}>
            <div><span className={styles.metaLabel}>{'{{2}}'} Assunto</span><div className={styles.paramVal}>{d.param2 || '—'}</div></div>
            <div><span className={styles.metaLabel}>{'{{3}}'} Fechamento</span><div className={styles.paramVal}>{d.param3 || '—'}</div></div>
          </div>

          <div className={styles.metrics}>
            <Stat n={d.total} label="Total" />
            <Stat n={d.enviados} label="Enviados" />
            <Stat n={d.entregues} label="Entregues" />
            <Stat n={d.lidos} label="Lidos" accent />
            <Stat n={d.falhas} label="Falhas" danger />
          </div>

          <div className={styles.footer}>
            <Button type="button" variant="ghost" onClick={onClose}>Fechar</Button>
            {isDraft && (
              <Button type="button" loading={sending} onClick={handleSend}>
                <Send size={14} /> Enviar agora
              </Button>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className={styles.previewCol}>
          <div className={styles.previewLabel}>Como o cliente vê</div>
          <div className={styles.phone}>
            <div className={styles.waTop}>fevinicius</div>
            <div className={styles.waBody}>
              <div className={styles.bubble}>
                {previewHtml}
                {tpl?.footer && <div className={styles.bubbleFooter}>{tpl.footer}</div>}
                <div className={styles.bubbleTime}>14:32 ✓✓</div>
              </div>
            </div>
          </div>
          <div className={styles.previewHint}><Info size={13} /> O nome de cada cliente entra no lugar de <span className={styles.var}>{'{{1}}'}</span>.</div>
        </div>
      </div>
    </Modal>
  )
}

function Stat({ n, label, accent, danger }: { n: number; label: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className={styles.stat}>
      <div className={`${styles.statNum} ${accent ? styles.statAccent : ''} ${danger && n > 0 ? styles.statDanger : ''}`}>{n}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  )
}
