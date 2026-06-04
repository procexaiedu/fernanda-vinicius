'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle, Clock, ShoppingBag } from 'lucide-react'
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

export default function EditCompraForm({ compra }: Props) {
  const router = useRouter()

  // ── Estado: campos do cabeçalho ──────────────────────────────────────────
  const [purchaseDate, setPurchaseDate] = useState(compra.purchaseDate)
  const [notes,        setNotes]        = useState(compra.notes)
  const [nfNumber,     setNfNumber]     = useState(compra.nfNumber)

  // ── Estado: itens ────────────────────────────────────────────────────────
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

  // ── Estado: pagamentos ───────────────────────────────────────────────────
  const [payments, setPayments] = useState<EditPaymentData[]>(
    compra.payments.map(p => ({ ...p }))
  )

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────

  function updateItem<K extends keyof FormItem>(idx: number, key: K, val: FormItem[K]) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it))
  }

  function updatePayment<K extends keyof EditPaymentData>(idx: number, key: K, val: EditPaymentData[K]) {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, [key]: val } : p))
  }

  // ── Submit ───────────────────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────

  const totalCost = items.reduce((s, i) => s + i.costPrice * (Number(i.quantity) || 0), 0)

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
                <th style={{ width: 150 }}>Fornecedor</th>
                <th style={{ width: 130 }}>Loja</th>
                <th style={{ width: 90 }}>Custo unit.</th>
                <th style={{ width: 90 }}>Preço venda</th>
                <th style={{ width: 70 }}>Qtd</th>
                <th style={{ width: 60 }}>Etiq.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const original   = compra.items[idx]
                const unitsSold  = original.unitsSold
                const hasSales   = unitsSold > 0
                const storeBlocked = hasSales

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
                      <select
                        className={styles.cell}
                        value={item.supplierId}
                        onChange={e => updateItem(idx, 'supplierId', e.target.value)}
                      >
                        {compra.suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>

                    {/* Loja */}
                    <td>
                      <select
                        className={styles.cell}
                        value={item.storeId}
                        onChange={e => updateItem(idx, 'storeId', e.target.value)}
                        disabled={storeBlocked}
                        title={storeBlocked ? 'Produto com vendas — loja bloqueada' : undefined}
                      >
                        {compra.stores.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
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
                        onBlur={e => {
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
                        {(['A', 'B'] as const).map(fmt => (
                          <button
                            key={fmt}
                            type="button"
                            className={`${styles.labelBtn} ${item.labelFormat === fmt ? styles.labelBtnActive : ''}`}
                            onClick={() => updateItem(idx, 'labelFormat', fmt)}
                          >
                            {fmt}
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
          <div className={styles.sectionTitle}>Pagamentos</div>
          <p className={styles.muted} style={{ marginBottom: 12 }}>
            Todos os pagamentos podem ser editados para correção de erros.
          </p>
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
                    {/* Método */}
                    <td>
                      <select
                        className={styles.payInput}
                        value={pay.paymentMethod}
                        onChange={e => updatePayment(idx, 'paymentMethod', e.target.value)}
                      >
                        <option value="cash">Dinheiro</option>
                        <option value="pix">PIX</option>
                        <option value="transfer">Transferência</option>
                        <option value="credit">Crédito</option>
                      </select>
                    </td>

                    {/* Parcela */}
                    <td className={styles.muted}>
                      {pay.installmentNumber ? `${pay.installmentNumber}x` : '—'}
                    </td>

                    {/* Vencimento */}
                    <td>
                      <input
                        type="date"
                        className={styles.payInput}
                        value={pay.dueDate}
                        onChange={e => updatePayment(idx, 'dueDate', e.target.value)}
                      />
                    </td>

                    {/* Valor */}
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

                    {/* Status */}
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
