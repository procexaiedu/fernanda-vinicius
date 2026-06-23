'use client'

import { AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { QuickCreateType } from './QuickCreateCatalogModal'

interface Props {
  type: QuickCreateType
  label: string
  deleting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

const NOUN: Record<QuickCreateType, string> = {
  supplier: 'o fornecedor',
  category: 'a categoria',
  material: 'o material',
}

const TITLE: Record<QuickCreateType, string> = {
  supplier: 'Excluir fornecedor',
  category: 'Excluir categoria',
  material: 'Excluir material',
}

export default function ConfirmDeleteCatalogModal({
  type, label, deleting, error, onCancel, onConfirm,
}: Props) {
  return (
    <Modal isOpen onClose={onCancel} title={TITLE[type]} size="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          display: 'flex', gap: 12, padding: '12px 14px',
          background: 'rgba(224, 82, 82, 0.08)', border: '1px solid rgba(224, 82, 82, 0.25)',
          borderRadius: 'var(--radius-md)',
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Tem certeza que deseja excluir {NOUN[type]} <strong style={{ color: 'var(--text-primary)' }}>“{label}”</strong>?
            <br />
            Ele deixará de aparecer nas listas, mas{' '}
            <strong style={{ color: 'var(--text-primary)' }}>os produtos já cadastrados continuam intactos</strong>.
            É possível recadastrar com o mesmo nome depois.
          </div>
        </div>

        {error && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={deleting}>Cancelar</Button>
          <Button type="button" variant="danger" loading={deleting} onClick={onConfirm}>Excluir</Button>
        </div>
      </div>
    </Modal>
  )
}
