'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, AlertTriangle, ChevronDown, Cake, X, CreditCard,
  Banknote, Smartphone, ArrowLeftRight, RefreshCw, User,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import {
  salvarVenda, buscarVendasCliente, type VendaFormData,
  type SaleItem, type SalePaymentRow, type ExchangeItemSelected, type VendaParaTroca,
} from '../actions'
import { createCustomer, type CustomerFormData } from '../../clientes/actions'
import styles from './NovaVendaForm.module.css'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ProductOption {
  id: string; name: string; code: string; category: string; store_id: string
  sale_price: number; promotional_price: number | null; promotional_active: boolean
  cost_price: number; quantity_in_stock: number
}

interface CustomerOption {
  id: string; name: string; phone: string; cpf: string | null; birthday: string | null
}

interface StoreOption { id: string; name: string; city: string }

interface Settings {
  pixDiscountPct: number
  birthdayDiscountPct: number
  installmentThreshold: number
}

interface UserProfile {
  role: 'admin' | 'operator'
  storeId: string | null
  storeName: string | null
  fullName: string
  userId: string
}

interface UserOption {
  id: string; full_name: string; store_id: string | null
}

interface SaleRow {
  productId: string | null
  productName: string
  quantity: number | ''   // '' permite apagar o campo livremente
  unitPrice: number
  unitCost: number
  stockAvailable: number
}

interface PaymentRow {
  method: 'cash' | 'pix' | 'debit' | 'credit'
  amount: number
  installments: number
}

interface Props {
  stores: StoreOption[]
  products: ProductOption[]
  customers: CustomerOption[]
  settings: Settings
  userProfile: UserProfile
  users: UserOption[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(s: string) {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function isBirthdayMonth(birthday: string | null): boolean {
  if (!birthday) return false
  const month = parseInt(birthday.slice(5, 7))
  return month === new Date().getMonth() + 1
}

function emptyRow(): SaleRow {
  return { productId: null, productName: '', quantity: 1, unitPrice: 0, unitCost: 0, stockAvailable: 0 }
}

// ─── Hook: dropdown fixo ──────────────────────────────────────────────────────

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

// ─── StoreSelect ──────────────────────────────────────────────────────────────

function StoreSelect({ value, onChange, stores }: {
  value: string; onChange: (id: string) => void; stores: StoreOption[]
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown<HTMLButtonElement>()
  const selected = stores.find(s => s.id === value)

  return (
    <div className={styles.comboWrap}>
      <button type="button" ref={inputRef} className={`${styles.headerInput} ${styles.storeBtn}`}
        onClick={() => pos ? close() : openAt()} onBlur={() => setTimeout(close, 150)}>
        <span>{selected?.name ?? 'Selecione...'}</span>
        <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.5 }} />
      </button>
      {pos && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 160), zIndex: 9999 }}>
          {stores.map(s => (
            <div key={s.id} className={`${styles.comboOption} ${s.id === value ? styles.comboOptionActive : ''}`}
              onMouseDown={() => { onChange(s.id); close() }}>
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── CustomerCombobox ─────────────────────────────────────────────────────────

function CustomerCombobox({ value, onChange, onCreateClick, customers }: {
  value: string
  onChange: (c: CustomerOption | null, text: string) => void
  onCreateClick: () => void
  customers: CustomerOption[]
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const q = value.trim().toLowerCase()
  const qDigits = q.replace(/\D/g, '')

  const filtered = q === ''
    ? customers.slice(0, 8)
    : customers.filter(c => {
        if (c.name.toLowerCase().includes(q)) return true
        if (qDigits.length > 0) {
          if (c.phone && c.phone.replace(/\D/g, '').includes(qDigits)) return true
          if (c.cpf  && c.cpf.replace(/\D/g, '').includes(qDigits))  return true
        }
        return false
      }).slice(0, 8)

  return (
    <div className={styles.comboWrap}>
      <div className={styles.customerInputWrap}>
        <User size={13} className={styles.customerIcon} />
        <input
          ref={inputRef}
          className={styles.customerInput}
          value={value}
          onChange={e => { onChange(null, e.target.value); openAt() }}
          onFocus={openAt}
          onBlur={() => setTimeout(close, 150)}
          placeholder="Buscar por nome, CPF ou telefone..."
          autoComplete="off"
        />
      </div>
      {pos && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 320), zIndex: 9999 }}>
          {filtered.map(c => (
            <div key={c.id} className={styles.comboOption} onMouseDown={() => { onChange(c, c.name); close() }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                {isBirthdayMonth(c.birthday) && <Cake size={12} style={{ color: '#C9A84C' }} />}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.phone}{c.cpf ? ` · CPF: ${c.cpf}` : ''}</span>
            </div>
          ))}
          {filtered.length === 0 && q !== '' && (
            <div className={styles.comboEmpty}>Nenhum cliente encontrado para "{value}"</div>
          )}
          <div className={styles.comboCreateBtn} onMouseDown={() => { close(); onCreateClick() }}>
            <Plus size={12} /> Criar novo cliente
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ProductCombobox (venda) ──────────────────────────────────────────────────

function ProductCombobox({ value, onChange, products }: {
  value: string
  onChange: (name: string, product: ProductOption | null) => void
  products: ProductOption[]
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const q = value.toLowerCase()
  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
  ).slice(0, 10)

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        className={styles.cell}
        value={value}
        onChange={e => { onChange(e.target.value, null); openAt() }}
        onFocus={openAt}
        onBlur={() => setTimeout(close, 150)}
        placeholder="Nome ou código..."
        autoComplete="off"
      />
      {pos && filtered.length > 0 && (
        <div className={styles.comboDropdown} style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 320), zIndex: 9999 }}>
          {filtered.map(p => (
            <div key={p.id} className={styles.comboOption} onMouseDown={() => { onChange(p.name, p); close() }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                  {p.quantity_in_stock <= 0 ? '(sem estoque)' : `${p.quantity_in_stock} em estoque`}
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {p.code} · {fmt(p.promotional_active && p.promotional_price ? p.promotional_price : p.sale_price)}
                {p.promotional_active && p.promotional_price && (
                  <span style={{ color: '#4CAF7D', marginLeft: 4 }}>promo</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Máscaras ─────────────────────────────────────────────────────────────────

function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2)  return d.length ? `(${d}` : ''
  if (d.length <= 7)  return `(${d.slice(0,2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3)  return d
  if (d.length <= 6)  return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9)  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

// ─── Modal criar cliente ──────────────────────────────────────────────────────

function CreateCustomerModal({ storeId, onClose, onCreated }: {
  storeId: string
  onClose: () => void
  onCreated: (c: CustomerOption) => void
}) {
  const [name, setName]         = useState('')
  const [phone, setPhone]       = useState('')
  const [cpf, setCpf]           = useState('')
  const [birthday, setBirthday] = useState('')
  const [email, setEmail]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    if (!phone.trim()) { setError('Telefone é obrigatório.'); return }
    setSaving(true)
    setError('')
    const result = await createCustomer({
      name, phone, cpf, email, birthday,
      address: '', city: '', state: '', zip_code: '',
      origin_store_id: storeId,
      notes: '',
    })
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Erro ao salvar.'); return }
    // result.id vem do banco — nunca vazio
    onCreated({ id: result.id!, name: name.trim(), phone: phone.trim(), cpf: cpf.replace(/\D/g, '') || null, birthday: birthday || null })
  }

  return (
    <Modal isOpen title="Novo Cliente" onClose={onClose}>
      <div className={styles.createCustomerForm}>
        <div className={styles.createRow}>
          <div className={styles.createField}>
            <label>Nome <span className={styles.req}>*</span></label>
            <input className={styles.createInput} value={name} onChange={e => setName(e.target.value)} placeholder="Nome completo" autoFocus />
          </div>
        </div>
        <div className={styles.createRow}>
          <div className={styles.createField}>
            <label>Telefone <span className={styles.req}>*</span></label>
            <input
              className={styles.createInput}
              value={phone}
              onChange={e => setPhone(maskPhone(e.target.value))}
              placeholder="(11) 99999-9999"
              inputMode="numeric"
            />
          </div>
          <div className={styles.createField}>
            <label>CPF</label>
            <input
              className={styles.createInput}
              value={cpf}
              onChange={e => setCpf(maskCpf(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
            />
          </div>
        </div>
        <div className={styles.createRow}>
          <div className={styles.createField}>
            <label>Aniversário</label>
            <DatePicker value={birthday} onChange={setBirthday} className={styles.createInput} />
          </div>
          <div className={styles.createField}>
            <label>E-mail</label>
            <input className={styles.createInput} value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com" />
          </div>
        </div>
        {error && <div className={styles.createError}><AlertTriangle size={13} /> {error}</div>}
        <div className={styles.createActions}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button loading={saving} onClick={handleSave}>Criar Cliente</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NovaVendaForm({ stores, products, customers: initialCustomers, settings, userProfile, users }: Props) {
  const router = useRouter()

  // ── Estado geral ──────────────────────────────────────────────────────────
  const [saleDate, setSaleDate]   = useState(today())
  const [storeId, setStoreId]     = useState(userProfile.storeId ?? stores[0]?.id ?? '')
  const [sellerId, setSellerId]   = useState<string>(userProfile.userId)
  const [notes, setNotes]         = useState('')

  // ── Cliente ───────────────────────────────────────────────────────────────
  const [customers, setCustomers]           = useState(initialCustomers)
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)

  // ── Itens da venda ────────────────────────────────────────────────────────
  const [rows, setRows] = useState<SaleRow[]>([emptyRow()])

  // ── Descontos ─────────────────────────────────────────────────────────────
  const [hasPix, setHasPix]           = useState(false)
  const [hasBirthday, setHasBirthday] = useState(false)
  const [manualDiscount, setManualDiscount] = useState(0)

  // ── Pagamentos ────────────────────────────────────────────────────────────
  const [payments, setPayments] = useState<PaymentRow[]>([])

  // ── Troca ─────────────────────────────────────────────────────────────────
  const [exchangeSales, setExchangeSales]     = useState<VendaParaTroca[]>([])
  const [exchangeLoading, setExchangeLoading] = useState(false)
  const [selectedExchangeItems, setSelectedExchangeItems] = useState<ExchangeItemSelected[]>([])

  // ── UI ────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // ── Efeito: birthday discount ──────────────────────────────────────────────
  useEffect(() => {
    if (selectedCustomer && isBirthdayMonth(selectedCustomer.birthday)) {
      setHasBirthday(true)
    } else {
      setHasBirthday(false)
    }
  }, [selectedCustomer])

  // ── Efeito: pix discount ───────────────────────────────────────────────────
  useEffect(() => {
    const hasPixPayment = payments.some(p => p.method === 'pix')
    if (hasPixPayment && !hasPix) setHasPix(true)
    if (!hasPixPayment && hasPix) setHasPix(false)
  }, [payments])

  // ── Totais ────────────────────────────────────────────────────────────────
  const subtotal       = rows.reduce((s, r) => s + r.unitPrice * (r.quantity || 0), 0)
  const discountPct    = (hasPix ? settings.pixDiscountPct : 0) + (hasBirthday ? settings.birthdayDiscountPct : 0)
  const discountAmt    = parseFloat((subtotal * discountPct / 100 + manualDiscount).toFixed(2))
  const total          = Math.max(0, parseFloat((subtotal - discountAmt).toFixed(2)))
  const exchangeCredit = selectedExchangeItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const paidTotal      = payments.reduce((s, p) => s + p.amount, 0)
  const coveredTotal   = paidTotal + exchangeCredit
  const balanceDiff    = parseFloat((coveredTotal - total).toFixed(2))

  // ── Row helpers ───────────────────────────────────────────────────────────
  function updateRow(i: number, patch: Partial<SaleRow>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function addRow() { setRows(prev => [...prev, emptyRow()]) }
  function removeRow(i: number) { setRows(prev => prev.filter((_, idx) => idx !== i)) }

  function handleProductSelect(i: number, name: string, p: ProductOption | null) {
    if (!p) { updateRow(i, { productId: null, productName: name }); return }
    const price = p.promotional_active && p.promotional_price ? p.promotional_price : p.sale_price
    updateRow(i, {
      productId: p.id,
      productName: p.name,
      unitPrice: price,
      unitCost: p.cost_price,
      stockAvailable: p.quantity_in_stock,
    })
  }

  // ── Customer helpers ──────────────────────────────────────────────────────
  function selectCustomer(c: CustomerOption | null, text: string) {
    setSelectedCustomer(c)
    setCustomerSearch(text)
    if (!c) {
      setSelectedExchangeItems([])
      setExchangeSales([])
    }
  }

  function handleCustomerCreated(c: CustomerOption) {
    // Re-fetch or optimistic: add to local list then select
    setCustomers(prev => [...prev, c])
    setSelectedCustomer(c)
    setCustomerSearch(c.name)
    if (isBirthdayMonth(c.birthday)) setHasBirthday(true)
    setShowCreateCustomer(false)
  }

  // ── Pagamento helpers ─────────────────────────────────────────────────────
  function addPayment(method: PaymentRow['method']) {
    setPayments(prev => [...prev, { method, amount: 0, installments: 1 }])
  }

  function updatePayment(i: number, patch: Partial<PaymentRow>) {
    setPayments(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  }

  function removePayment(i: number) {
    setPayments(prev => prev.filter((_, idx) => idx !== i))
  }

  function hasExchangePayment() {
    return selectedExchangeItems.length > 0
  }

  async function addExchange() {
    if (!selectedCustomer) { setError('Selecione um cliente para habilitar troca.'); return }
    setError('')
    setExchangeLoading(true)
    const sales = await buscarVendasCliente(selectedCustomer.id, storeId)
    setExchangeSales(sales)
    setExchangeLoading(false)
  }

  function toggleExchangeItem(sale: VendaParaTroca, item: VendaParaTroca['items'][0]) {
    const key = item.id
    const exists = selectedExchangeItems.find(e => e.saleItemId === key)
    if (exists) {
      setSelectedExchangeItems(prev => prev.filter(e => e.saleItemId !== key))
    } else {
      setSelectedExchangeItems(prev => [...prev, {
        saleItemId:     item.id,
        productId:      item.product_id,
        productName:    item.product_name,
        quantity:       1,  // começa com 1; usuário pode ajustar
        unitPrice:      item.effective_unit_price,  // preço real pago (com desconto)
        originalSaleId: sale.id,
      }])
    }
  }

  function updateExchangeQty(saleItemId: string, qty: number, maxQty: number) {
    const clamped = Math.max(1, Math.min(qty, maxQty))
    setSelectedExchangeItems(prev =>
      prev.map(e => e.saleItemId === saleItemId ? { ...e, quantity: clamped } : e)
    )
  }

  function clearExchange() {
    setSelectedExchangeItems([])
    setExchangeSales([])
  }

  // ── Parcelamento ──────────────────────────────────────────────────────────
  const maxInstallments = total >= settings.installmentThreshold ? 12 : 5

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setError('')

    const activeRows = rows.filter(r => r.productId || r.productName.trim())
    if (!activeRows.length) { setError('Adicione ao menos um produto.'); return }
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].productId) { setError(`Linha ${i + 1}: selecione um produto do catálogo.`); return }
      if (rows[i].unitPrice <= 0) { setError(`Linha ${i + 1}: preço inválido.`); return }
      if (!rows[i].quantity || (rows[i].quantity as number) < 1) { setError(`Linha ${i + 1}: quantidade deve ser ao menos 1.`); return }
    }
    if (!storeId) { setError('Selecione a loja.'); return }

    const paymentsOk = Math.abs(balanceDiff) < 0.01 || exchangeCredit > total
    if (!paymentsOk && payments.length === 0) {
      setError('Adicione ao menos uma forma de pagamento.')
      return
    }

    const items: SaleItem[] = rows.map(r => ({
      productId:   r.productId!,
      productName: r.productName,
      quantity:    (r.quantity as number) || 1,
      unitPrice:   r.unitPrice,
      unitCost:    r.unitCost,
    }))

    const formData: VendaFormData = {
      storeId,
      saleDate,
      customerId:            selectedCustomer?.id ?? null,
      customerBirthdayMonth: selectedCustomer?.birthday ? parseInt(selectedCustomer.birthday.slice(5, 7)) : null,
      sellerId:              sellerId || null,
      items,
      hasPix,
      hasBirthday,
      manualDiscount,
      payments,
      exchangeItems: selectedExchangeItems,
      notes,
    }

    setSaving(true)
    const result = await salvarVenda(formData)
    setSaving(false)

    if (!result.success) { setError(result.error ?? 'Erro ao salvar.'); return }
    router.push('/vendas')
    router.refresh()
  }

  // ─────────────────────────────────────────────────────────────────────────

  const paymentMethodOptions = [
    { value: 'pix',    label: 'PIX',     icon: <Smartphone size={13} /> },
    { value: 'cash',   label: 'Dinheiro', icon: <Banknote size={13} /> },
    { value: 'debit',  label: 'Débito',  icon: <CreditCard size={13} /> },
    { value: 'credit', label: 'Crédito', icon: <CreditCard size={13} /> },
  ] as const

  const effectiveStoreId = userProfile.role === 'operator' ? (userProfile.storeId ?? '') : storeId

  return (
    <div className={styles.wrapper}>

      {/* ── Seção 1: Informações Gerais ────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Informações Gerais</div>

        <div className={styles.headerGrid}>
          {/* Loja */}
          <div className={styles.field}>
            <label className={styles.label}>Loja</label>
            {userProfile.role === 'operator' ? (
              <div className={styles.headerInputLocked}>{userProfile.storeName ?? '—'}</div>
            ) : (
              <StoreSelect value={storeId} onChange={setStoreId} stores={stores} />
            )}
          </div>

          {/* Data */}
          <div className={styles.field}>
            <label className={styles.label}>Data da venda</label>
            <DatePicker value={saleDate} onChange={setSaleDate} className={styles.headerInput} />
          </div>

          {/* Cliente */}
          <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
            <label className={styles.label}>
              Cliente
              {selectedCustomer && isBirthdayMonth(selectedCustomer.birthday) && (
                <span className={styles.birthdayBadge}><Cake size={11} /> Aniversariante do mês!</span>
              )}
            </label>
            {selectedCustomer ? (
              <div className={styles.selectedCustomer}>
                <User size={13} />
                <span className={styles.selectedCustomerName}>{selectedCustomer.name}</span>
                {selectedCustomer.phone && <span className={styles.selectedCustomerMeta}>{selectedCustomer.phone}</span>}
                <button className={styles.clearCustomerBtn} onClick={() => selectCustomer(null, '')}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <CustomerCombobox
                value={customerSearch}
                onChange={selectCustomer}
                onCreateClick={() => setShowCreateCustomer(true)}
                customers={customers}
              />
            )}
          </div>

          {/* Vendedora */}
          {userProfile.role === 'admin' && (
            <div className={styles.field}>
              <label className={styles.label}>Vendedora</label>
              <StoreSelect
                value={sellerId}
                onChange={setSellerId}
                stores={users.map(u => ({ id: u.id, name: u.full_name, city: '' }))}
              />
            </div>
          )}

          {/* Observações */}
          <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
            <label className={styles.label}>Observações</label>
            <textarea className={styles.textarea} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas sobre a venda..." rows={2} />
          </div>
        </div>
      </div>

      {/* ── Seção 2: Itens da venda ────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Itens da Venda</div>
          <div className={styles.sectionStats}>
            {rows.length} {rows.length === 1 ? 'item' : 'itens'} · Subtotal: <strong>{fmt(subtotal)}</strong>
          </div>
        </div>

        <div className={styles.gridWrapper}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.thNum}>#</th>
                <th className={styles.thProd}>Produto</th>
                <th className={styles.thQty}>Qtd</th>
                <th className={styles.thPrice}>Preço Unit.</th>
                <th className={styles.thSub}>Subtotal</th>
                <th className={styles.thDel}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const qty = row.quantity || 0
                const rowSubtotal = row.unitPrice * qty
                const stockWarn = row.productId && qty > row.stockAvailable && row.stockAvailable >= 0
                const noStock   = row.stockAvailable === 0 && row.productId

                return (
                  <tr key={i} className={styles.row}>
                    <td className={styles.tdNum}>{i + 1}</td>

                    <td className={styles.tdProd}>
                      <ProductCombobox
                        value={row.productName}
                        onChange={(name, p) => handleProductSelect(i, name, p)}
                        products={products.filter(p => p.store_id === storeId)}
                      />
                      {stockWarn && (
                        <div className={styles.stockWarn}>
                          <AlertTriangle size={11} />
                          {noStock ? 'Sem estoque' : `Apenas ${row.stockAvailable} em estoque`}
                        </div>
                      )}
                    </td>

                    <td className={styles.tdQty}>
                      <input
                        type="number" min="1" step="1"
                        className={styles.cell}
                        value={row.quantity}
                        onChange={e => updateRow(i, { quantity: e.target.value === '' ? '' : parseInt(e.target.value) || 1 })}
                      />
                    </td>

                    <td className={styles.tdPrice}>
                      <input
                        type="number" min="0" step="0.01"
                        className={styles.cell}
                        value={row.unitPrice || ''}
                        onChange={e => updateRow(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                        placeholder="0,00"
                      />
                    </td>

                    <td className={styles.tdSub}>
                      <span className={styles.subtotalText}>{rowSubtotal > 0 ? fmt(rowSubtotal) : '—'}</span>
                    </td>

                    <td className={styles.tdDel}>
                      <button
                        type="button"
                        className={styles.delBtn}
                        onClick={() => removeRow(i)}
                        disabled={rows.length === 1}
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
          <Plus size={13} /> Adicionar produto
        </button>
      </div>

      {/* ── Seção 3: Descontos ─────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Descontos</div>

        <div className={styles.discountsGrid}>
          <label className={styles.discountRow}>
            <input type="checkbox" checked={hasPix} onChange={e => setHasPix(e.target.checked)} />
            <span>PIX</span>
            <span className={styles.discountPct}>−{settings.pixDiscountPct}%</span>
            <span className={styles.discountAmt}>{subtotal > 0 ? fmt(subtotal * settings.pixDiscountPct / 100) : ''}</span>
          </label>

          <label className={styles.discountRow}>
            <input type="checkbox" checked={hasBirthday} onChange={e => setHasBirthday(e.target.checked)}
              disabled={!selectedCustomer} />
            <span>Aniversário</span>
            <span className={styles.discountPct}>−{settings.birthdayDiscountPct}%</span>
            <span className={styles.discountAmt}>{subtotal > 0 ? fmt(subtotal * settings.birthdayDiscountPct / 100) : ''}</span>
          </label>

          <div className={styles.discountRow}>
            <input type="checkbox" checked={manualDiscount > 0} onChange={e => { if (!e.target.checked) setManualDiscount(0) }} readOnly={false} />
            <span>Manual</span>
            <span className={styles.discountPct}>R$</span>
            <input
              type="number" min="0" step="0.01"
              className={styles.manualDiscInput}
              value={manualDiscount || ''}
              onChange={e => setManualDiscount(parseFloat(e.target.value) || 0)}
              placeholder="0,00"
            />
          </div>
        </div>

        <div className={styles.totalSummary}>
          <div className={styles.summaryRow}>
            <span>Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
          {discountAmt > 0 && (
            <div className={`${styles.summaryRow} ${styles.discountRow2}`}>
              <span>Desconto ({discountPct > 0 ? `${discountPct}%` : ''}{manualDiscount > 0 && discountPct > 0 ? ' + R$' : ''}{manualDiscount > 0 && discountPct === 0 ? 'R$' : ''}{manualDiscount > 0 ? fmt(manualDiscount) : ''})</span>
              <span>− {fmt(discountAmt)}</span>
            </div>
          )}
          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>Total</span>
            <strong>{fmt(total)}</strong>
          </div>
        </div>
      </div>

      {/* ── Seção 4: Pagamento ─────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Pagamento</div>
          <div className={styles.paymentActions}>
            {paymentMethodOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={styles.addPayBtn}
                onClick={() => addPayment(opt.value as PaymentRow['method'])}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
            {exchangeSales.length === 0 && (
              <button type="button" className={styles.addPayBtnExchange} onClick={addExchange} disabled={exchangeLoading}>
                <ArrowLeftRight size={13} /> {exchangeLoading ? 'Carregando...' : 'Troca'}
              </button>
            )}
          </div>
        </div>

        {/* Lista de pagamentos */}
        {payments.length > 0 && (
          <div className={styles.paymentsList}>
            {payments.map((p, i) => (
              <div key={i} className={styles.paymentRow}>
                <select
                  className={styles.payCell}
                  value={p.method}
                  onChange={e => updatePayment(i, { method: e.target.value as PaymentRow['method'], installments: 1 })}
                >
                  <option value="pix">PIX</option>
                  <option value="cash">Dinheiro</option>
                  <option value="debit">Débito</option>
                  <option value="credit">Crédito</option>
                </select>

                <input
                  type="number" min="0" step="0.01"
                  className={styles.payAmtInput}
                  value={p.amount || ''}
                  onChange={e => updatePayment(i, { amount: parseFloat(e.target.value) || 0 })}
                  placeholder="R$ 0,00"
                />

                {p.method === 'credit' ? (
                  <div className={styles.installmentsWrap}>
                    <select
                      className={styles.payCell}
                      value={p.installments}
                      onChange={e => updatePayment(i, { installments: parseInt(e.target.value) })}
                    >
                      {Array.from({ length: maxInstallments }, (_, k) => k + 1).map(n => (
                        <option key={n} value={n}>{n}x</option>
                      ))}
                    </select>
                    {p.installments > 1 && p.amount > 0 && (
                      <span className={styles.installmentHint}>{fmt(p.amount / p.installments)}/parcela</span>
                    )}
                  </div>
                ) : (
                  <div style={{ flex: 1 }} />
                )}

                <button type="button" className={styles.delBtn} onClick={() => removePayment(i)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Painel de troca */}
        {exchangeSales.length > 0 && (
          <div className={styles.exchangePanel}>
            <div className={styles.exchangeHeader}>
              <ArrowLeftRight size={14} />
              <span>Troca — selecione os itens devolvidos pelo cliente</span>
              <button className={styles.clearExchangeBtn} onClick={clearExchange}><X size={12} /> Cancelar troca</button>
            </div>

            {exchangeSales.map(sale => {
              const totalUnits = sale.items.reduce((s, i) => s + i.quantity, 0)
              return (
                <div key={sale.id} className={styles.exchangeSale}>
                  <div className={styles.exchangeSaleHeader}>
                    📦 Compra {fmtDate(sale.sale_date)} · {sale.items.length} {sale.items.length === 1 ? 'produto' : 'produtos'} · {totalUnits} {totalUnits === 1 ? 'unidade' : 'unidades'} · {fmt(sale.total)}
                  </div>
                  {sale.items.map(item => {
                    const sel      = selectedExchangeItems.find(e => e.saleItemId === item.id)
                    const checked  = !!sel
                    const returned = item.already_returned
                    return (
                      <div
                        key={item.id}
                        className={`${styles.exchangeItem} ${returned ? styles.exchangeItemReturned : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={returned}
                          onChange={() => !returned && toggleExchangeItem(sale, item)}
                        />
                        <span className={styles.exchangeItemName}>{item.product_name}</span>
                        <span className={styles.exchangeItemCode}>{item.product_code}</span>
                        <span className={styles.exchangeItemPrice}>{fmt(item.effective_unit_price)}/un.</span>
                        {checked && item.quantity > 1 && (
                          <span className={styles.exchangeQtyWrap}>
                            <button
                              className={styles.exchangeQtyBtn}
                              onClick={() => updateExchangeQty(item.id, (sel?.quantity ?? 1) - 1, item.quantity)}
                              type="button"
                            >−</button>
                            <span className={styles.exchangeQtyVal}>{sel?.quantity ?? 1}</span>
                            <button
                              className={styles.exchangeQtyBtn}
                              onClick={() => updateExchangeQty(item.id, (sel?.quantity ?? 1) + 1, item.quantity)}
                              type="button"
                            >+</button>
                            <span className={styles.exchangeQtyMax}>/ {item.quantity}</span>
                          </span>
                        )}
                        {returned && <span className={styles.exchangeItemReturnedBadge}>já devolvido</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {selectedExchangeItems.length > 0 && (
              <div className={styles.exchangeCredit}>
                Crédito de troca: <strong>{fmt(exchangeCredit)}</strong>
              </div>
            )}
          </div>
        )}

        {/* Resumo de pagamento */}
        <div className={styles.paymentSummary}>
          <div className={styles.summaryRow}>
            <span>Total da venda</span>
            <strong>{fmt(total)}</strong>
          </div>
          {paidTotal > 0 && (
            <div className={styles.summaryRow}>
              <span>Cobrado</span>
              <span>{fmt(paidTotal)}</span>
            </div>
          )}
          {exchangeCredit > 0 && (
            <div className={styles.summaryRow}>
              <span>Crédito de troca</span>
              <span style={{ color: '#4CAF7D' }}>+ {fmt(exchangeCredit)}</span>
            </div>
          )}
          {(payments.length > 0 || exchangeCredit > 0) && (
            balanceDiff > 0.01 ? (
              <div className={styles.payStatusWarn}>
                <AlertTriangle size={13} /> {fmt(balanceDiff)} sobrando {exchangeCredit > total ? '(saldo de troca)' : '(a mais)'}
              </div>
            ) : balanceDiff < -0.01 ? (
              <div className={styles.payStatusError}>
                <AlertTriangle size={13} /> Falta {fmt(Math.abs(balanceDiff))} para cobrir o total
              </div>
            ) : (
              <div className={styles.payStatusOk}>
                ✓ Pagamento OK
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Erro e ações ─────────────────────────────────────────────────── */}
      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className={styles.formActions}>
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>
          Cancelar
        </Button>
        <Button loading={saving} onClick={handleSubmit}>
          Salvar Venda →
        </Button>
      </div>

      {/* ── Modal criar cliente ───────────────────────────────────────────── */}
      {showCreateCustomer && (
        <CreateCustomerModal
          storeId={effectiveStoreId}
          onClose={() => setShowCreateCustomer(false)}
          onCreated={handleCustomerCreated}
        />
      )}
    </div>
  )
}
