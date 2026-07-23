'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { createProduct, updateProduct, deleteProduct } from './actions'
import type { ProductWithRelations, StoreOption, SupplierOption } from './page'
import { generateCode as buildCode } from '@/lib/productCode'
import { matchText } from '@/lib/normalize'
import { computeSalePrice, salePriceIsAuto } from '@/lib/pricing'
import styles from './ProdutoFormModal.module.css'

function generateCode(initials: string, month: number, costPrice: number): string {
  if (!initials || !month || !costPrice) return ''
  return buildCode(initials, month, costPrice)
}

// ─── Combobox customizado ─────────────────────────────────────────────────────

function Combobox({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const filtered = options.filter(o => matchText(o, value))

  return (
    <div className={styles.comboWrapper}>
      <input
        className={styles.input}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className={styles.comboDropdown}>
          {filtered.map(o => (
            <div key={o} className={styles.comboOption} onMouseDown={() => { onChange(o); setOpen(false) }}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  product: ProductWithRelations | null
  suppliers: SupplierOption[]
  stores: StoreOption[]
  categories: string[]
  materials: string[]
  defaultMarkupPct: number
  onClose: () => void
}

const currentYear = new Date().getFullYear()
const currentMonth = new Date().getMonth() + 1

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function ProdutoFormModal({ product, suppliers, stores, categories, materials, defaultMarkupPct, onClose }: Props) {
  const router = useRouter()
  const isEditing = !!product

  const [name, setName]             = useState(product?.name ?? '')
  const [category, setCategory]     = useState(product?.category ?? '')
  const [material, setMaterial]     = useState(product?.material ?? '')
  const [supplierId, setSupplierId] = useState(product?.supplier_id ?? '')
  const [storeId, setStoreId]       = useState(product?.store_id ?? '')
  const [costPrice, setCostPrice]   = useState(product?.cost_price?.toString() ?? '')
  const [salePrice, setSalePrice]   = useState(product?.sale_price?.toString() ?? '')
  const [promoPrice, setPromoPrice] = useState(product?.promotional_price?.toString() ?? '')
  const [qty, setQty]               = useState(product?.quantity_in_stock?.toString() ?? '1')
  const [ownership, setOwnership]   = useState<'own' | 'consignment'>(product?.ownership_type ?? 'own')
  const [month, setMonth]           = useState(product?.purchase_month?.toString() ?? String(currentMonth))
  const [year, setYear]             = useState(product?.purchase_year?.toString() ?? String(currentYear))
  const [photoUrl, setPhotoUrl]     = useState(product?.photo_url ?? '')
  const [photoPreview, setPhotoPreview] = useState(product?.photo_url ?? '')
  const [uploadError, setUploadError]   = useState('')
  const [uploading, setUploading]       = useState(false)
  const [saving, setSaving]             = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError]               = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedSupplier = suppliers.find(s => s.id === supplierId)
  const code = generateCode(
    selectedSupplier?.initials ?? '',
    Number(month),
    parseFloat(costPrice) || 0
  )

  // Preço de venda automático a partir do custo (mesma regra/config da Compra).
  // Não sobrescreve se o usuário já ajustou o preço manualmente.
  function handleCostChange(v: string) {
    const prevCost    = parseFloat(costPrice) || 0
    const currentSale = parseFloat(salePrice) || 0
    setCostPrice(v)
    if (salePriceIsAuto(currentSale, prevCost, defaultMarkupPct)) {
      const auto = computeSalePrice(parseFloat(v) || 0, defaultMarkupPct)
      setSalePrice(auto ? String(auto) : '')
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setPhotoPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.error) { setUploadError(json.error); setPhotoUrl('') }
      else setPhotoUrl(json.url)
    } catch {
      setUploadError('Erro ao fazer upload da foto.')
      setPhotoUrl('')
    }
    setUploading(false)
  }

  async function handleSubmit() {
    setError('')
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    if (!category.trim()) { setError('Categoria é obrigatória.'); return }
    if (!material.trim()) { setError('Material é obrigatório.'); return }
    if (!supplierId) { setError('Fornecedor é obrigatório.'); return }
    if (!storeId) { setError('Loja é obrigatória.'); return }
    if (!costPrice || parseFloat(costPrice) <= 0) { setError('Custo é obrigatório.'); return }
    if (!salePrice || parseFloat(salePrice) <= 0) { setError('Preço de venda é obrigatório.'); return }

    const data = {
      name, category, material,
      supplier_id: supplierId,
      store_id: storeId,
      cost_price: parseFloat(costPrice),
      sale_price: parseFloat(salePrice),
      promotional_price: promoPrice ? parseFloat(promoPrice) : null,
      quantity_in_stock: parseInt(qty) || 1,
      ownership_type: ownership,
      purchase_month: parseInt(month),
      purchase_year: parseInt(year),
      photo_url: photoUrl || null,
    }

    setSaving(true)
    const result = isEditing ? await updateProduct(product.id, data) : await createProduct(data)
    setSaving(false)

    if (!result.success) { setError(result.error ?? 'Erro ao salvar.'); return }
    router.refresh()
    onClose()
  }

  async function handleDelete() {
    if (!product) return
    setDeleting(true)
    const result = await deleteProduct(product.id)
    setDeleting(false)
    if (!result.success) { setError(result.error ?? 'Erro ao deletar.'); setConfirmDelete(false); return }
    router.refresh()
    onClose()
  }

  return (
    <Modal isOpen onClose={onClose} title={isEditing ? 'Editar Produto' : 'Novo Produto'} size="lg">
      <div className={styles.form}>

        {/* Seção 1: Identificação */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Identificação</div>
          <div className={styles.grid2} style={{ marginBottom: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Fornecedor <span className={styles.required}>*</span></label>
              <SearchableSelect
                value={supplierId}
                onChange={setSupplierId}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                placeholder="Selecione..."
                className={styles.fullWidth}
              />
              <button
                type="button"
                className={styles.createLink}
                onClick={() => window.open('/fornecedores', '_blank')}
              >
                <Plus size={11} /> Cadastrar novo fornecedor
              </button>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Loja destino <span className={styles.required}>*</span></label>
              <SearchableSelect
                value={storeId}
                onChange={setStoreId}
                options={stores.map(s => ({ value: s.id, label: s.name }))}
                placeholder="Selecione..."
                searchable={stores.length > 5}
                className={styles.fullWidth}
              />
            </div>
          </div>
          <div className={styles.field} style={{ marginBottom: 12 }}>
            <label className={styles.label}>Nome / Descrição <span className={styles.required}>*</span></label>
            <input className={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Brinco argola prata 925" />
          </div>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Categoria <span className={styles.required}>*</span></label>
              <Combobox value={category} onChange={setCategory} options={categories} placeholder="Ex: brinco, colar, anel..." />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Material <span className={styles.required}>*</span></label>
              <Combobox value={material} onChange={setMaterial} options={materials} placeholder="Ex: prata, banhado, aço..." />
            </div>
          </div>
        </div>

        {/* Seção 2: Precificação */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Precificação e Código</div>
          <div className={styles.grid3} style={{ marginBottom: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Custo (R$) <span className={styles.required}>*</span></label>
              <input className={styles.input} type="number" min="0" step="0.01" value={costPrice} onChange={e => handleCostChange(e.target.value)} placeholder="0,00" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Venda (R$) <span className={styles.required}>*</span></label>
              <input className={styles.input} type="number" min="0" step="0.01" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="0,00" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Promoção (R$)</label>
              <input className={styles.input} type="number" min="0" step="0.01" value={promoPrice} onChange={e => setPromoPrice(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className={styles.codeBlock}>
            <span className={styles.codeLabel}>CÓDIGO:</span>
            <span className={styles.codeValue}>{code || '—'}</span>
            {code && (
              <button className={styles.codeCopy} onClick={() => navigator.clipboard.writeText(code)}>
                Copiar
              </button>
            )}
          </div>

          <div className={styles.grid3} style={{ marginTop: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Mês da compra <span className={styles.required}>*</span></label>
              <select className={styles.select} value={month} onChange={e => setMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Ano <span className={styles.required}>*</span></label>
              <select className={styles.select} value={year} onChange={e => setYear(e.target.value)}>
                {Array.from({ length: 5 }, (_, i) => currentYear - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Qtd. em estoque</label>
              <input className={styles.input} type="number" min="0" step="1" value={qty} onChange={e => setQty(e.target.value)} />
            </div>
          </div>

          <div className={styles.field} style={{ marginTop: 12 }}>
            <label className={styles.label}>Tipo de propriedade</label>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input type="radio" value="own" checked={ownership === 'own'} onChange={() => setOwnership('own')} />
                Próprio
              </label>
              <label className={styles.radioLabel}>
                <input type="radio" value="consignment" checked={ownership === 'consignment'} onChange={() => setOwnership('consignment')} />
                Consignação
              </label>
            </div>
          </div>
        </div>

        {/* Seção 3: Foto */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Foto (opcional)</div>
          <div className={styles.uploadArea}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className={styles.uploadInput}
              onChange={handleFileChange}
              disabled={uploading}
            />
            {photoPreview
              ? <img src={photoPreview} alt="Preview" className={styles.uploadPreview} />
              : <ImageIcon size={32} className={styles.uploadIcon} />
            }
            <span className={styles.uploadText}>
              {uploading ? 'Enviando...' : photoPreview ? 'Clique para trocar a foto' : 'Clique para enviar uma foto'}
            </span>
            <span className={styles.uploadHint}>PNG, JPG ou WEBP — máx. 5MB</span>
            {uploadError && <span className={styles.uploadError}>{uploadError}</span>}
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          {/* Deletar — só ao editar */}
          {isEditing && !confirmDelete && (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              <Trash2 size={13} /> Deletar produto
            </button>
          )}
          {isEditing && confirmDelete && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
              <span style={{ fontSize: 12, color: 'var(--danger)' }}>Deletar permanentemente?</span>
              <Button size="sm" variant="danger" loading={deleting} onClick={handleDelete}>
                Confirmar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancelar
              </Button>
            </div>
          )}

          <Button variant="ghost" onClick={onClose} disabled={saving || deleting}>
            Cancelar
          </Button>
          <Button loading={saving || uploading} onClick={handleSubmit} disabled={deleting}>
            {isEditing ? 'Salvar alterações' : 'Criar Produto'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
