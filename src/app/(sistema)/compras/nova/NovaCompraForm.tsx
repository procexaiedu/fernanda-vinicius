'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, AlertTriangle, Upload, ChevronDown } from 'lucide-react'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import { salvarCompra } from '../actions'
import type { GridRow, PaymentRow } from '../actions'
import styles from './NovaCompraForm.module.css'

// ─── Tipos de props ────────────────────────────────────────────────────────────

interface SupplierOption { id: string; name: string; initials: string }
interface StoreOption    { id: string; name: string; city: string }
interface ProductOption  {
  id: string; name: string; code: string; category: string; material: string
  cost_price: number; sale_price: number; promotional_price: number | null
  supplier_id: string; store_id: string; ownership_type: string
}

interface Props {
  suppliers:       SupplierOption[]
  stores:          StoreOption[]
  products:        ProductOption[]
  categories:      string[]
  materials:       string[]
  defaultMarkupPct: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function generateCode(initials: string, month: number, costPrice: number): string {
  if (!initials || !month || !costPrice) return ''
  const m = String(month).padStart(2, '0')
  const costCents = Math.round(costPrice * 100)
  return `F${initials.toUpperCase()}${m}${costCents}`
}

function suggestInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2)
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Row inicial ───────────────────────────────────────────────────────────────

function emptyRow(defaultStoreId: string): GridRow {
  return {
    productId: null,
    productName: '',
    productExistingCostDiffers: false,
    supplierId: null,
    supplierName: '',
    supplierInitials: '',
    category: '',
    material: '',
    costPrice: 0,
    salePrice: 0,
    promoPrice: null,
    labelFormat: 'A',
    quantity: 1,
    storeId: defaultStoreId,
  }
}

// ─── Hook: posição do dropdown fixo ───────────────────────────────────────────

function useFixedDropdown<T extends HTMLElement = HTMLInputElement>() {
  const inputRef = useRef<T>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  function openAt() {
    if (!inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
  }

  function close() { setPos(null) }

  return { inputRef, pos, openAt, close }
}

// ─── Combobox genérico ─────────────────────────────────────────────────────────

function Combobox({ value, onChange, options, placeholder, className }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
  className?: string
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase())).slice(0, 8)

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        className={`${styles.cell} ${className ?? ''}`}
        value={value}
        onChange={e => { onChange(e.target.value); openAt() }}
        onFocus={openAt}
        onBlur={() => setTimeout(close, 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {pos && filtered.length > 0 && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}>
          {filtered.map(o => (
            <div key={o} className={styles.comboOption} onMouseDown={() => { onChange(o); close() }}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ProductCombobox ───────────────────────────────────────────────────────────

function ProductCombobox({ value, onChange, products, placeholder }: {
  value: string
  onChange: (name: string, product: ProductOption | null) => void
  products: ProductOption[]
  placeholder: string
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const filtered = products.filter(p => p.name.toLowerCase().includes(value.toLowerCase())).slice(0, 8)

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        className={styles.cell}
        value={value}
        onChange={e => { onChange(e.target.value, null); openAt() }}
        onFocus={openAt}
        onBlur={() => setTimeout(close, 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {pos && filtered.length > 0 && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 280), zIndex: 9999 }}>
          {filtered.map(p => (
            <div key={p.id} className={styles.comboOption} onMouseDown={() => { onChange(p.name, p); close() }}>
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{p.code} · R$ {p.cost_price}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SupplierCombobox ──────────────────────────────────────────────────────────

function SupplierCombobox({ value, onChange, suppliers, placeholder }: {
  value: string
  onChange: (name: string, supplier: SupplierOption | null) => void
  suppliers: SupplierOption[]
  placeholder: string
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(value.toLowerCase())).slice(0, 8)

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        className={styles.cell}
        value={value}
        onChange={e => { onChange(e.target.value, null); openAt() }}
        onFocus={openAt}
        onBlur={() => setTimeout(close, 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {pos && filtered.length > 0 && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 240), zIndex: 9999 }}>
          {filtered.map(s => (
            <div key={s.id} className={styles.comboOption} onMouseDown={() => { onChange(s.name, s); close() }}>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{s.initials}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── PaySelect — dropdown customizado para pagamentos ─────────────────────

const METHOD_OPTIONS = [
  { value: 'pix',      label: 'PIX' },
  { value: 'cash',     label: 'Dinheiro' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'credit',   label: 'Crédito' },
]

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Pago' },
  { value: 'pending',   label: 'Pendente' },
]

function PaySelect({ value, onChange, options, disabled }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown<HTMLButtonElement>()
  const selected = options.find(o => o.value === value)

  return (
    <div className={styles.comboWrap}>
      <button
        type="button"
        ref={inputRef}
        className={`${styles.payCell} ${styles.storeBtn}`}
        onClick={() => { if (!disabled) { pos ? close() : openAt() } }}
        onBlur={() => setTimeout(close, 150)}
        disabled={disabled}
      >
        <span>{selected?.label ?? '—'}</span>
        {!disabled && <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5 }} />}
      </button>
      {pos && !disabled && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 130), zIndex: 9999 }}>
          {options.map(o => (
            <div
              key={o.value}
              className={`${styles.comboOption} ${o.value === value ? styles.comboOptionActive : ''}`}
              onMouseDown={() => { onChange(o.value); close() }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── StoreSelect customizado ───────────────────────────────────────────────────

function StoreSelect({ value, onChange, stores }: {
  value: string
  onChange: (id: string) => void
  stores: StoreOption[]
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown<HTMLButtonElement>()
  const selected = stores.find(s => s.id === value)

  return (
    <div className={styles.comboWrap}>
      <button
        type="button"
        ref={inputRef}
        className={`${styles.cell} ${styles.storeBtn}`}
        onClick={() => pos ? close() : openAt()}
        onBlur={() => setTimeout(close, 150)}
      >
        <span>{selected?.name ?? 'Selecione...'}</span>
        <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
      </button>
      {pos && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 160), zIndex: 9999 }}>
          {stores.map(s => (
            <div
              key={s.id}
              className={`${styles.comboOption} ${s.id === value ? styles.comboOptionActive : ''}`}
              onMouseDown={() => { onChange(s.id); close() }}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function NovaCompraForm({ suppliers, stores, products, categories, materials, defaultMarkupPct }: Props) {
  const router = useRouter()
  const defaultStoreId = stores.find(s => s.name.toLowerCase().includes('campinas'))?.id ?? stores[0]?.id ?? ''

  // Cabeçalho
  const [purchaseDate, setPurchaseDate]     = useState(today())
  const [nfNumber, setNfNumber]             = useState('')
  const [nfUrl, setNfUrl]                   = useState('')
  const [notes, setNotes]                   = useState('')
  const [isConsignment, setIsConsignment]   = useState(false)
  const [returnDeadline, setReturnDeadline] = useState('')
  const [minPurchasePct, setMinPurchasePct] = useState('')
  const [uploadingNF, setUploadingNF]       = useState(false)

  // Grid de itens
  const [rows, setRows] = useState<GridRow[]>([emptyRow(defaultStoreId)])

  // Grupos de fornecedor derivados dos itens
  const supplierGroups = useMemo(() => {
    const map = new Map<string, { groupKey: string; supplierName: string; subtotal: number }>()
    for (const row of rows) {
      if (!row.supplierName.trim() || !row.costPrice) continue
      const key = row.supplierId ?? row.supplierName.trim().toLowerCase()
      const existing = map.get(key)
      const rowSubtotal = (row.costPrice || 0) * (row.quantity || 1)
      if (existing) {
        existing.subtotal += rowSubtotal
      } else {
        map.set(key, { groupKey: key, supplierName: row.supplierName, subtotal: rowSubtotal })
      }
    }
    return [...map.values()]
  }, [rows])

  // Pagamentos por fornecedor
  const [supplierPayments, setSupplierPayments] = useState<Record<string, PaymentRow[]>>({})

  // Sincronizar chaves de pagamento quando os grupos mudam
  useEffect(() => {
    const activeKeys = new Set(supplierGroups.map(g => g.groupKey))
    setSupplierPayments(prev => {
      let changed = false
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (!activeKeys.has(key)) { delete next[key]; changed = true }
      }
      for (const key of activeKeys) {
        if (!next[key]) { next[key] = []; changed = true }
      }
      return changed ? next : prev
    })
  }, [supplierGroups])

  // Estado
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const nfInputRef = useRef<HTMLInputElement>(null)

  const purchaseMonth = parseInt(purchaseDate.slice(5, 7)) || new Date().getMonth() + 1

  // ── Grid helpers ──────────────────────────────────────────────────────────

  function updateRow(index: number, patch: Partial<GridRow>) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r))
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow(defaultStoreId)])
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  function handleProductSelect(index: number, name: string, product: ProductOption | null) {
    if (!product) {
      updateRow(index, { productId: null, productName: name, productExistingCostDiffers: false })
      return
    }
    const sup = suppliers.find(s => s.id === product.supplier_id)
    const costDiffers = false // ao selecionar, ainda não há custo novo — o usuário vai digitar
    updateRow(index, {
      productId: product.id,
      productName: product.name,
      productExistingCostDiffers: costDiffers,
      supplierId: product.supplier_id,
      supplierName: sup?.name ?? '',
      supplierInitials: sup?.initials ?? '',
      category: product.category,
      material: product.material,
      salePrice: product.sale_price,
      promoPrice: product.promotional_price,
      storeId: product.store_id,
      costPrice: product.cost_price,
    })
  }

  function handleSupplierSelect(index: number, name: string, supplier: SupplierOption | null) {
    if (supplier) {
      updateRow(index, { supplierId: supplier.id, supplierName: supplier.name, supplierInitials: supplier.initials })
    } else {
      updateRow(index, { supplierId: null, supplierName: name, supplierInitials: suggestInitials(name) })
    }
  }

  function handleCostChange(index: number, cost: number) {
    const row = rows[index]
    const originalCost = products.find(p => p.id === row.productId)?.cost_price ?? 0
    // Auto-sugere preço de venda se o campo ainda não foi editado manualmente
    const autoSalePrice = cost > 0 ? parseFloat((cost * (1 + defaultMarkupPct / 100)).toFixed(2)) : 0
    const prevAutoPrice = row.costPrice > 0 ? parseFloat((row.costPrice * (1 + defaultMarkupPct / 100)).toFixed(2)) : 0
    const salePriceWasAuto = row.salePrice === 0 || row.salePrice === prevAutoPrice
    updateRow(index, {
      costPrice: cost,
      productExistingCostDiffers: !!row.productId && originalCost !== 0 && cost !== originalCost,
      ...(salePriceWasAuto ? { salePrice: autoSalePrice } : {}),
    })
  }

  function getCode(row: GridRow): string {
    const initials = row.supplierInitials || suppliers.find(s => s.id === row.supplierId)?.initials || ''
    return generateCode(initials, purchaseMonth, row.costPrice)
  }

  function handleEnterOnLastColumn(e: React.KeyboardEvent, isLastCol: boolean) {
    if (e.key === 'Enter' && isLastCol) {
      e.preventDefault()
      addRow()
    }
  }

  // ── NF upload ─────────────────────────────────────────────────────────────

  async function handleNFUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingNF(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.url) setNfUrl(json.url)
    } finally {
      setUploadingNF(false)
    }
  }

  // ── Pagamentos ────────────────────────────────────────────────────────────

  function addPayment() {
    setPayments(prev => [...prev, {
      method: 'pix',
      totalAmount: 0,
      installments: 1,
      firstDueDate: today(),
      status: 'completed',
    }])
  }

  function updatePayment(index: number, patch: Partial<PaymentRow>) {
    setPayments(prev => prev.map((p, i) => i === index ? { ...p, ...patch } : p))
  }

  function removePayment(index: number) {
    setPayments(prev => prev.filter((_, i) => i !== index))
  }

  // ── Totais ────────────────────────────────────────────────────────────────

  const totalCost     = rows.reduce((s, r) => s + (r.costPrice || 0) * (r.quantity || 1), 0)
  const totalPayments = payments.reduce((s, p) => s + (p.totalAmount || 0), 0)
  const difference    = totalPayments - totalCost

  // ── Validação e submit ────────────────────────────────────────────────────

  async function handleSubmit() {
    setError('')

    if (!purchaseDate) { setError('Informe a data da compra.'); return }
    if (rows.length === 0) { setError('Adicione ao menos um item.'); return }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.productName.trim()) { setError(`Linha ${i + 1}: informe o nome do produto.`); return }
      if (!r.supplierName.trim()) { setError(`Linha ${i + 1}: informe o fornecedor.`); return }
      if (!r.supplierInitials.trim()) { setError(`Linha ${i + 1}: informe as iniciais do fornecedor.`); return }
      if (!r.category.trim()) { setError(`Linha ${i + 1}: informe a categoria.`); return }
      if (!r.material.trim()) { setError(`Linha ${i + 1}: informe o material.`); return }
      if (!r.costPrice || r.costPrice <= 0) { setError(`Linha ${i + 1}: informe o preço de custo.`); return }
      if (!r.salePrice || r.salePrice <= 0) { setError(`Linha ${i + 1}: informe o preço de venda.`); return }
      if (!r.storeId) { setError(`Linha ${i + 1}: selecione a loja destino.`); return }
    }

    if (isConsignment && !returnDeadline) { setError('Informe o prazo de devolução da consignação.'); return }

    if (!isConsignment && payments.length === 0) { setError('Adicione ao menos uma forma de pagamento.'); return }

    setSaving(true)
    const result = await salvarCompra({
      purchaseDate,
      nfNumber,
      nfUrl,
      notes,
      rows,
      payments,
      isConsignment,
      returnDeadline,
      minPurchasePct: minPurchasePct ? parseFloat(minPurchasePct) : null,
    })
    setSaving(false)

    if (!result.success) { setError(result.error ?? 'Erro ao salvar.'); return }
    router.push('/compras')
    router.refresh()
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.wrapper}>

      {/* ── Cabeçalho ────────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Informações Gerais</div>

        {/* Toggle tipo */}
        <div className={styles.typeToggle}>
          <button
            type="button"
            className={`${styles.typeBtn} ${!isConsignment ? styles.typeBtnActive : ''}`}
            onClick={() => setIsConsignment(false)}
          >
            Compra Própria
          </button>
          <button
            type="button"
            className={`${styles.typeBtn} ${isConsignment ? styles.typeBtnActive : ''}`}
            onClick={() => setIsConsignment(true)}
          >
            Consignação
          </button>
        </div>

        <div className={styles.headerGrid}>
          <div className={styles.field}>
            <label className={styles.label}>Data da compra <span className={styles.req}>*</span></label>
            <DatePicker value={purchaseDate} onChange={setPurchaseDate} className={styles.input} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>NF Número</label>
            <input className={styles.input} value={nfNumber} onChange={e => setNfNumber(e.target.value)} placeholder="Ex: 001042" />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Arquivo NF</label>
            <input ref={nfInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleNFUpload} />
            <button type="button" className={styles.uploadBtn} onClick={() => nfInputRef.current?.click()} disabled={uploadingNF}>
              <Upload size={13} />
              {uploadingNF ? 'Enviando...' : nfUrl ? 'Arquivo anexado ✓' : 'Anexar NF'}
            </button>
          </div>

          {isConsignment && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Prazo devolução <span className={styles.req}>*</span></label>
                <DatePicker value={returnDeadline} onChange={setReturnDeadline} className={styles.input} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>% mínimo de compra</label>
                <input type="number" min="0" max="100" step="1" className={styles.input} value={minPurchasePct} onChange={e => setMinPurchasePct(e.target.value)} placeholder="Ex: 50" />
              </div>
            </>
          )}

          <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
            <label className={styles.label}>Observações</label>
            <textarea className={styles.textarea} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas sobre essa compra..." rows={2} />
          </div>
        </div>
      </div>

      {/* ── Grid de itens ────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Itens da Compra</div>
          <div className={styles.sectionStats}>
            {rows.length} {rows.length === 1 ? 'item' : 'itens'} · Custo total: <strong>{fmt(totalCost)}</strong>
          </div>
        </div>

        <div className={styles.gridWrapper}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.thNum}>#</th>
                <th className={styles.thProd}>Produto <span className={styles.req}>*</span></th>
                <th className={styles.thSup}>Fornecedor <span className={styles.req}>*</span></th>
                <th className={styles.thIni}>Inic.</th>
                <th className={styles.thCat}>Categoria <span className={styles.req}>*</span></th>
                <th className={styles.thMat}>Material <span className={styles.req}>*</span></th>
                <th className={styles.thNum2}>Custo R$ <span className={styles.req}>*</span></th>
                <th className={styles.thNum2}>Venda R$ <span className={styles.req}>*</span></th>
                <th className={styles.thNum2}>Promo R$</th>
                <th className={styles.thEtiq}>Etiq.</th>
                <th className={styles.thQty}>Qtd</th>
                <th className={styles.thLoja}>Loja <span className={styles.req}>*</span></th>
                <th className={styles.thCod}>Código</th>
                <th className={styles.thSub}>Subtotal</th>
                <th className={styles.thDel}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const code    = getCode(row)
                const subtotal = (row.costPrice || 0) * (row.quantity || 1)
                const originalCost = products.find(p => p.id === row.productId)?.cost_price ?? 0
                const showDupWarning = row.productId && row.costPrice > 0 && row.costPrice !== originalCost

                return (
                  <tr key={i} className={styles.row}>
                    <td className={styles.tdNum}>{i + 1}</td>

                    {/* Produto */}
                    <td className={styles.tdProd}>
                      <ProductCombobox
                        value={row.productName}
                        onChange={(name, prod) => handleProductSelect(i, name, prod)}
                        products={products}
                        placeholder="Nome do produto..."
                      />
                      {showDupWarning && (
                        <div className={styles.dupWarning}>
                          <AlertTriangle size={11} /> Custo diferente (R$ {originalCost}) — novo lote
                        </div>
                      )}
                    </td>

                    {/* Fornecedor */}
                    <td className={styles.tdSup}>
                      <SupplierCombobox
                        value={row.supplierName}
                        onChange={(name, sup) => handleSupplierSelect(i, name, sup)}
                        suppliers={suppliers}
                        placeholder="Fornecedor..."
                      />
                    </td>

                    {/* Iniciais */}
                    <td className={styles.tdIni}>
                      <input
                        className={styles.cell}
                        value={row.supplierInitials}
                        onChange={e => updateRow(i, { supplierInitials: e.target.value.toUpperCase().slice(0, 2) })}
                        maxLength={2}
                        placeholder="MJ"
                        readOnly={!!row.supplierId}
                        style={{ opacity: row.supplierId ? 0.5 : 1 }}
                      />
                    </td>

                    {/* Categoria */}
                    <td className={styles.tdCat}>
                      <Combobox value={row.category} onChange={v => {
                        const isBrinco = v.toLowerCase().includes('brinco')
                        updateRow(i, { category: v, labelFormat: isBrinco ? 'B' : 'A' })
                      }} options={categories} placeholder="brinco..." />
                    </td>

                    {/* Material */}
                    <td className={styles.tdMat}>
                      <Combobox value={row.material} onChange={v => updateRow(i, { material: v })} options={materials} placeholder="prata..." />
                    </td>

                    {/* Custo */}
                    <td className={styles.tdNum2}>
                      <input
                        type="number" min="0" step="0.01"
                        className={styles.cell}
                        value={row.costPrice || ''}
                        onChange={e => handleCostChange(i, parseFloat(e.target.value) || 0)}
                        placeholder="0,00"
                      />
                    </td>

                    {/* Venda */}
                    <td className={styles.tdNum2}>
                      <input
                        type="number" min="0" step="0.01"
                        className={styles.cell}
                        value={row.salePrice || ''}
                        onChange={e => updateRow(i, { salePrice: parseFloat(e.target.value) || 0 })}
                        placeholder="0,00"
                      />
                    </td>

                    {/* Promo */}
                    <td className={styles.tdNum2}>
                      <input
                        type="number" min="0" step="0.01"
                        className={styles.cell}
                        value={row.promoPrice ?? ''}
                        onChange={e => updateRow(i, { promoPrice: e.target.value ? parseFloat(e.target.value) : null })}
                        placeholder="—"
                      />
                    </td>

                    {/* Etiqueta A/B */}
                    <td className={styles.tdEtiq}>
                      <div className={styles.labelToggle}>
                        <button
                          type="button"
                          className={`${styles.labelBtn} ${row.labelFormat === 'A' ? styles.labelBtnActive : ''}`}
                          onClick={() => updateRow(i, { labelFormat: 'A' })}
                          title="Anel"
                        >A</button>
                        <button
                          type="button"
                          className={`${styles.labelBtn} ${row.labelFormat === 'B' ? styles.labelBtnActive : ''}`}
                          onClick={() => updateRow(i, { labelFormat: 'B' })}
                          title="Brinco"
                        >B</button>
                      </div>
                    </td>

                    {/* Qtd */}
                    <td className={styles.tdQty}>
                      <input
                        type="number" min="1" step="1"
                        className={styles.cell}
                        value={row.quantity}
                        onChange={e => updateRow(i, { quantity: parseInt(e.target.value) || 1 })}
                      />
                    </td>

                    {/* Loja */}
                    <td className={styles.tdLoja}>
                      <StoreSelect
                        value={row.storeId}
                        onChange={id => updateRow(i, { storeId: id })}
                        stores={stores}
                      />
                    </td>

                    {/* Código (read-only) */}
                    <td className={styles.tdCod}>
                      <span className={styles.codeText}>{code || '—'}</span>
                    </td>

                    {/* Subtotal */}
                    <td className={styles.tdSub}>
                      <span className={styles.subtotalText}>{subtotal > 0 ? fmt(subtotal) : '—'}</span>
                    </td>

                    {/* Deletar */}
                    <td className={styles.tdDel}>
                      <button
                        type="button"
                        className={styles.delBtn}
                        onClick={() => removeRow(i)}
                        disabled={rows.length === 1}
                        onKeyDown={e => handleEnterOnLastColumn(e, true)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <button type="button" className={styles.addRowBtn} onClick={addRow}>
          <Plus size={13} /> Adicionar linha
        </button>
      </div>

      {/* ── Pagamentos ───────────────────────────────────────────────── */}
      {!isConsignment && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Pagamento</div>
            <button type="button" className={styles.addPayBtn} onClick={addPayment}>
              <Plus size={13} /> Adicionar pagamento
            </button>
          </div>

          {payments.length > 0 && (
            <div className={styles.paymentsTable}>
              <div className={styles.payHeader}>
                <span style={{ flex: '0 0 140px' }}>Método</span>
                <span style={{ flex: '0 0 130px' }}>Valor total</span>
                <span style={{ flex: '0 0 80px' }}>Parcelas</span>
                <span style={{ flex: '0 0 150px' }}>1ª Data venc.</span>
                <span style={{ flex: '0 0 120px' }}>Status</span>
                <span style={{ flex: 1 }}></span>
              </div>

              {payments.map((p, i) => (
                <div key={i} className={styles.payRow}>
                  <div style={{ flex: '0 0 140px' }}>
                    <PaySelect
                      value={p.method}
                      onChange={v => updatePayment(i, { method: v as PaymentRow['method'], installments: 1 })}
                      options={METHOD_OPTIONS}
                    />
                  </div>

                  <input
                    type="number" min="0" step="0.01"
                    className={styles.payCell}
                    style={{ flex: '0 0 130px' }}
                    value={p.totalAmount || ''}
                    onChange={e => updatePayment(i, { totalAmount: parseFloat(e.target.value) || 0 })}
                    placeholder="R$ 0,00"
                  />

                  <div style={{ flex: '0 0 80px', opacity: p.method !== 'credit' ? 0.3 : 1 }}>
                    <PaySelect
                      value={String(p.installments)}
                      onChange={v => updatePayment(i, { installments: parseInt(v) })}
                      options={Array.from({ length: 12 }, (_, k) => ({ value: String(k + 1), label: `${k + 1}x` }))}
                      disabled={p.method !== 'credit'}
                    />
                  </div>

                  <div style={{ flex: '0 0 150px' }}>
                    <DatePicker
                      value={p.firstDueDate}
                      onChange={v => updatePayment(i, { firstDueDate: v })}
                    />
                  </div>

                  <div style={{ flex: '0 0 120px' }}>
                    <PaySelect
                      value={p.status}
                      onChange={v => updatePayment(i, { status: v as PaymentRow['status'] })}
                      options={STATUS_OPTIONS}
                    />
                  </div>

                  {p.method === 'credit' && p.installments > 1 && (
                    <span className={styles.installmentHint}>
                      {p.installments}x de {fmt(p.totalAmount / p.installments)}
                    </span>
                  )}

                  <button type="button" className={styles.delBtn} onClick={() => removePayment(i)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              {/* Totais */}
              <div className={styles.payTotals}>
                <span>Custo total dos itens: <strong>{fmt(totalCost)}</strong></span>
                <span>Total informado: <strong>{fmt(totalPayments)}</strong></span>
                {Math.abs(difference) > 0.01 && (
                  <span className={styles.diffWarning}>
                    <AlertTriangle size={13} />
                    Diferença: {fmt(Math.abs(difference))} {difference > 0 ? '(a mais)' : '(a menos)'} — possível taxa da maquininha
                  </span>
                )}
              </div>
            </div>
          )}

          {payments.length === 0 && (
            <p className={styles.emptyPay}>Nenhum pagamento adicionado. Clique em "+ Adicionar pagamento".</p>
          )}
        </div>
      )}

      {/* ── Erro e ações ─────────────────────────────────────────────── */}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>
          Cancelar
        </Button>
        <Button loading={saving} onClick={handleSubmit}>
          {isConsignment ? 'Salvar Consignação' : 'Salvar Compra'} →
        </Button>
      </div>
    </div>
  )
}
