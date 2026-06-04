'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle, Clock, ShoppingBag, ChevronDown, RefreshCw } from 'lucide-react'
import Button from '@/components/ui/Button'
import {
  editarCompra,
  type CompraParaEdicao,
  type EditItemData,
  type EditPaymentData,
} from '@/app/(sistema)/compras/actions'
import styles from './EditCompraForm.module.css'

interface Props {
  compra: CompraParaEdicao
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', transfer: 'Transferência', credit: 'Crédito',
}

// Permite quantity vazio durante digitação sem forçar 0 imediatamente
type FormItem = Omit<EditItemData, 'quantity'> & { quantity: number | '' }

// ── Componente: select customizado (sem dropdown nativo do OS) ────────────────

interface SelectOption { value: string; label: string }

function SelectField({ value, onChange, options, disabled, wide }: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  disabled?: boolean
  wide?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = options.find(o => o.value === value)?.label ?? value

  return (
    <div ref={ref} className={styles.selectWrap}>
      <button
        type="button"
        className={`${styles.selectTrigger} ${wide ? styles.selectTriggerWide : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={disabled ? 'Produto com vendas — loja bloqueada' : undefined}
      >
        <span className={styles.selectLabel}>{label}</span>
        <ChevronDown size={11} className={`${styles.selectChevron} ${open ? styles.selectChevronOpen : ''}`} />
      </button>
      {open && (
        <div className={styles.selectDropdown}>
          {options.map(opt => (
            <div
              key={opt.value}
              className={`${styles.selectOption} ${opt.value === value ? styles.selectOptionActive : ''}`}
              onMouseDown={() => { onChange(opt.value); setOpen(false) }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function EditCompraForm({ compra }: Props) {
  const router = useRouter()

  const [purchaseDate, setPurchaseDate] = useState(compra.purchaseDate)
  const [notes,        setNotes]        = useState(compra.notes)
  const [nfNumber,     setNfNumber]     = useState(compra.nfNumber)

  const [items, setItems] = useState<FormItem[]>(
    compra.items.map(i => ({
      purchaseItemId: i.purchaseItemId,
      productId:      i.productId,
      name:           i.name,
      category:       i.category,
      material:       i.material,
      costPrice:      i.costPrice,
      salePrice:      i.salePrice,
      promoPrice:     i.promoPrice,
      labelFormat:    i.labelFormat,
      quantity:       i.quantity,
      storeId:        i.storeId,
      supplierId:     i.supplierId,
    }))
  )

  const [payments, setPayments] = useState<EditPaymentData[]>(
    compra.payments.map(p => ({ ...p }))
  )

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // ── Subtotais por fornecedor (calculado ao vivo) ──────────────────────────

  const supplierSubtotals = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>()
    items.forEach((item, idx) => {
      const origName = compra.items[idx]?.supplierName ?? '—'
      const sup = compra.suppliers.find(s => s.id === item.supplierId)
      const name = sup?.name ?? origName
      const prev = map.get(item.supplierId) ?? { name, total: 0 }
      map.set(item.supplierId, { name, total: prev.total + item.costPrice * (Number(item.quantity) || 0) })
    })
    return [...map.values()]
  }, [items, compra.items, compra.suppliers])

  const totalCost     = items.reduce((s, i) => s + i.costPrice * (Number(i.quantity) || 0), 0)
  const totalPayments = payments.reduce((s, p) => s + p.amount, 0)
  const paymentsDiff  = Math.abs(totalCost - totalPayments)
  const hasPaymentMismatch = paymentsDiff > 0.01

  // ── Redistribuir pagamentos proporcionalmente ao novo custo ──────────────

  function redistributePayments() {
    if (payments.length === 0 || totalCost === 0) return
    if (totalPayments > 0.01) {
      // Proporcional ao que já existe
      setPayments(prev => prev.map(p => ({
        ...p,
        amount: Math.round((p.amount / totalPayments) * totalCost * 100) / 100,
      })))
    } else {
      // Distribuição igual
      const each = Math.round((totalCost / payments.length) * 100) / 100
      setPayments(prev => prev.map(p => ({ ...p, amount: each })))
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function updateItem<K extends keyof FormItem>(idx: number, key: K, val: FormItem[K]) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }

  function updatePayment<K extends keyof EditPaymentData>(idx: number, key: K, val: EditPaymentData[K]) {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, [key]: val } : p))
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setError(null)
    const result = await editarCompra({
      purchaseId:   compra.id,
      purchaseDate,
      notes,
      nfNumber,
      items: items.map(it => ({ ...it, quantity: Number(it.quantity) || 1 })),
      payments,
    })
    setSaving(false)
    if (result.success) {
      router.push('/compras')
      router.refresh()
    } else {
      setError(result.error ?? 'Erro ao salvar.')
    }
  }

  // ── Options ───────────────────────────────────────────────────────────────

  const supplierOptions = compra.suppliers.map(s => ({ value: s.id, label: s.name }))
  const storeOptions    = compra.stores.map(s => ({ value: s.id, label: s.name }))
  const methodOptions   = [
    { value: 'cash',     label: 'Dinheiro' },
    { value: 'pix',      label: 'PIX' },
    { value: 'transfer', label: 'Transferência' },
    { value: 'credit',   label: 'Crédito' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.wrapper}>

      {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Dados Gerais</div>
        <div className={styles.headerGrid}>
          <div className={styles.field}>
            <label className={styles.label}>Data da compra</label>
            <input
              type="date"
              className={styles.input}
              value={purchaseDate}
              onChange={e => setPurchaseDate(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Observações</label>
            <input
              className={styles.input}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Observações gerais..."
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>NF</label>
            <input
              className={styles.input}
              value={nfNumber}
              onChange={e => setNfNumber(e.target.value)}
              placeholder="Número da NF"
            />
          </div>
        </div>
      </div>

      {/* ── Itens ──────────────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <ShoppingBag size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Itens ({items.length}) — Custo total: {fmt(totalCost)}
        </div>

        {compra.hasAnySale && (
          <div className={styles.storeWarning}>
            <AlertTriangle size={13} />
            Há produtos com vendas registradas. A loja desses produtos não pode ser alterada.
          </div>
        )}

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th style={{ minWidth: 160 }}>Produto</th>
                <th style={{ width: 110 }}>Categoria</th>
                <th style={{ width: 110 }}>Material</th>
                <th style={{ width: 160 }}>Fornecedor</th>
                <th style={{ width: 130 }}>Loja</th>
                <th style={{ width: 90 }}>Custo unit.</th>
                <th style={{ width: 90 }}>Preço venda</th>
                <th style={{ width: 70 }}>Qtd</th>
                <th style={{ width: 60 }}>Etiq.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const original  = compra.items[idx]
                const unitsSold = original.unitsSold
                const hasSales  = unitsSold > 0

                return (
                  <tr key={item.purchaseItemId}>
                    <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>{idx + 1}</td>

                    {/* Produto */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <input
                          className={styles.cell}
                          value={item.name}
                          onChange={e => updateItem(idx, 'name', e.target.value)}
                        />
                        {hasSales && (
                          <span className={styles.soldBadge}>{unitsSold} vendido{unitsSold > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </td>

                    {/* Categoria */}
                    <td>
                      <input
                        className={styles.cell}
                        value={item.category}
                        onChange={e => updateItem(idx, 'category', e.target.value)}
                      />
                    </td>

                    {/* Material */}
                    <td>
                      <input
                        className={styles.cell}
                        value={item.material}
                        onChange={e => updateItem(idx, 'material', e.target.value)}
                      />
                    </td>

                    {/* Fornecedor */}
                    <td>
                      <SelectField
                        value={item.supplierId}
                        onChange={v => updateItem(idx, 'supplierId', v)}
                        options={supplierOptions}
                        wide
                      />
                    </td>

                    {/* Loja */}
                    <td>
                      <SelectField
                        value={item.storeId}
                        onChange={v => updateItem(idx, 'storeId', v)}
                        options={storeOptions}
                        disabled={hasSales}
                      />
                    </td>

                    {/* Custo unit */}
                    <td>
                      <input
                        type="number"
                        className={styles.cell}
                        value={item.costPrice}
                        min={0}
                        step={0.01}
                        onChange={e => updateItem(idx, 'costPrice', parseFloat(e.target.value) || 0)}
                      />
                    </td>

                    {/* Preço venda */}
                    <td>
                      <input
                        type="number"
                        className={styles.cell}
                        value={item.salePrice}
                        min={0}
                        step={0.01}
                        onChange={e => updateItem(idx, 'salePrice', parseFloat(e.target.value) || 0)}
                      />
                    </td>

                    {/* Quantidade */}
                    <td>
                      <input
                        type="text"
                        inputMode="numeric"
                        className={styles.cell}
                        value={item.quantity}
                        onChange={e => {
                          const raw = e.target.value.replace(/[^0-9]/g, '')
                          updateItem(idx, 'quantity', raw === '' ? '' : parseInt(raw))
                        }}
                        onBlur={() => {
                          const v = Number(item.quantity) || 0
                          updateItem(idx, 'quantity', Math.max(unitsSold, v))
                        }}
                        onFocus={e => e.target.select()}
                        title={hasSales ? `Mínimo: ${unitsSold} (unidades vendidas)` : undefined}
                      />
                    </td>

                    {/* Etiqueta A/B */}
                    <td>
                      <div className={styles.labelToggle}>
                        {(['A', 'B'] as const).map(f => (
                          <button
                            key={f}
                            type="button"
                            className={`${styles.labelBtn} ${item.labelFormat === f ? styles.labelBtnActive : ''}`}
                            onClick={() => updateItem(idx, 'labelFormat', f)}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagamentos ─────────────────────────────────────────────────── */}
      {payments.length > 0 && (
        <div className={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className={styles.sectionTitle} style={{ marginBottom: 0 }}>Pagamentos</div>
            {!compra.hasAnySale && hasPaymentMismatch && (
              <button type="button" className={styles.recalcBtn} onClick={redistributePayments}>
                <RefreshCw size={12} /> Redistribuir ({fmt(totalCost)})
              </button>
            )}
          </div>

          {/* Subtotais por fornecedor — referência para o usuário */}
          {supplierSubtotals.length > 0 && (
            <div className={styles.supplierRef}>
              <span className={styles.supplierRefLabel}>Subtotal por fornecedor:</span>
              {supplierSubtotals.map(s => (
                <span key={s.name} className={styles.supplierRefItem}>
                  {s.name}: <strong>{fmt(s.total)}</strong>
                </span>
              ))}
            </div>
          )}

          {hasPaymentMismatch && (
            <div className={styles.diffBanner}>
              <AlertTriangle size={12} />
              Soma dos pagamentos ({fmt(totalPayments)}) difere do custo total ({fmt(totalCost)}).
              {!compra.hasAnySale && ' Clique em "Redistribuir" para ajustar.'}
            </div>
          )}

          <table className={styles.payTable}>
            <thead>
              <tr>
                <th>Método</th>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((pay, idx) => (
                <tr key={pay.id}>
                  <td>
                    <SelectField
                      value={pay.paymentMethod}
                      onChange={v => updatePayment(idx, 'paymentMethod', v)}
                      options={methodOptions}
                    />
                  </td>

                  <td className={styles.muted}>
                    {pay.installmentNumber ? `${pay.installmentNumber}x` : '—'}
                  </td>

                  <td>
                    <input
                      type="date"
                      className={styles.payInput}
                      value={pay.dueDate}
                      onChange={e => updatePayment(idx, 'dueDate', e.target.value)}
                    />
                  </td>

                  <td>
                    <input
                      type="number"
                      className={styles.payInput}
                      style={{ width: 100 }}
                      value={pay.amount}
                      min={0}
                      step={0.01}
                      onChange={e => updatePayment(idx, 'amount', parseFloat(e.target.value) || 0)}
                    />
                  </td>

                  <td>
                    {pay.status === 'completed'
                      ? <span className={styles.statusPaid}><CheckCircle size={11} /> Pago</span>
                      : <span className={styles.statusPending}><Clock size={11} /> Pendente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar alterações'}
        </Button>
      </div>

    </div>
  )
}
