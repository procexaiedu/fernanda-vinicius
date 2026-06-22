'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import {
  criarFornecedorRapido,
  criarCategoriaRapida,
  criarMaterialRapido,
} from '../catalog-actions'

export type QuickCreateType = 'supplier' | 'category' | 'material'

interface SupplierOption { id: string; name: string; initials: string }

interface Props {
  type: QuickCreateType
  initialValue: string
  existingSuppliers: SupplierOption[]
  onClose: () => void
  onCreatedSupplier: (s: SupplierOption) => void
  onCreatedCategory: (name: string, labelFormat: 'A' | 'B') => void
  onCreatedMaterial: (name: string) => void
}

function suggestInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2)
}

const TITLES: Record<QuickCreateType, string> = {
  supplier: 'Novo Fornecedor',
  category: 'Nova Categoria',
  material: 'Novo Material',
}

export default function QuickCreateCatalogModal({
  type,
  initialValue,
  existingSuppliers,
  onClose,
  onCreatedSupplier,
  onCreatedCategory,
  onCreatedMaterial,
}: Props) {
  const [name, setName]               = useState(initialValue.trim())
  const [initials, setInitials]       = useState(type === 'supplier' ? suggestInitials(initialValue) : '')
  const [labelFormat, setLabelFormat] = useState<'A' | 'B'>(
    type === 'category' && initialValue.toLowerCase().includes('brinco') ? 'B' : 'A'
  )
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // Aviso de iniciais duplicadas (fornecedor)
  const [dupeWarning, setDupeWarning] = useState<string | null>(null)
  useEffect(() => {
    if (type !== 'supplier' || !initials) { setDupeWarning(null); return }
    const key = initials.toUpperCase()
    const match = existingSuppliers.find(s => s.initials.toUpperCase() === key)
    setDupeWarning(match
      ? `As iniciais "${key}" já estão em uso por: ${match.name}. Os códigos podem ficar ambíguos.`
      : null
    )
  }, [type, initials, existingSuppliers])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Informe o nome.'); return }
    setSaving(true)
    setError(null)

    if (type === 'supplier') {
      if (!initials.trim()) { setError('Informe as iniciais.'); setSaving(false); return }
      const res = await criarFornecedorRapido(name, initials)
      setSaving(false)
      if (!res.success || !res.supplier) { setError(res.error ?? 'Erro ao criar.'); return }
      onCreatedSupplier(res.supplier)
      onClose()
    } else if (type === 'category') {
      const res = await criarCategoriaRapida(name, labelFormat)
      setSaving(false)
      if (!res.success || !res.category) { setError(res.error ?? 'Erro ao criar.'); return }
      onCreatedCategory(res.category.name, res.category.labelFormat)
      onClose()
    } else {
      const res = await criarMaterialRapido(name)
      setSaving(false)
      if (!res.success || !res.material) { setError(res.error ?? 'Erro ao criar.'); return }
      onCreatedMaterial(res.material)
      onClose()
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={TITLES[type]} size="sm">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>

        {type === 'supplier' ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 2 }}>
              <Input
                label="Nome *"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Moda Joia Atacado"
                autoFocus
              />
            </div>
            <div style={{ flex: '0 0 88px' }}>
              <Input
                label="Sigla *"
                value={initials}
                onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="MJ"
                maxLength={2}
              />
            </div>
          </div>
        ) : (
          <Input
            label="Nome *"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={type === 'category' ? 'Ex: Brinco, Colar, Anel...' : 'Ex: Prata, Ouro, Banhado...'}
            autoFocus
          />
        )}

        {type === 'supplier' && dupeWarning && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            background: 'rgba(224, 163, 82, 0.12)', border: '1px solid rgba(224, 163, 82, 0.3)',
            borderRadius: 'var(--radius-md)', color: 'var(--warning)', fontSize: 12,
          }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span>{dupeWarning}</span>
          </div>
        )}

        {type === 'category' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Tipo de etiqueta
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { v: 'A' as const, label: 'A — Anel / geral (90×13mm)' },
                { v: 'B' as const, label: 'B — Brinco (30×18mm)' },
              ]).map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setLabelFormat(opt.v)}
                  style={{
                    flex: 1, padding: '8px 10px', fontSize: 12, fontWeight: 600,
                    borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    border: `1px solid ${labelFormat === opt.v ? 'var(--accent)' : 'var(--border)'}`,
                    background: labelFormat === opt.v ? 'var(--accent)' : 'transparent',
                    color: labelFormat === opt.v ? '#000' : 'var(--text-muted)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="submit" loading={saving}>Registrar</Button>
        </div>
      </form>
    </Modal>
  )
}
