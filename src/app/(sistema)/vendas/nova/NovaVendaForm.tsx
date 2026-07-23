'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, AlertTriangle, ChevronDown, Cake, X, CreditCard,
  Banknote, Smartphone, ArrowLeftRight, RefreshCw, User, CheckCircle2,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import {
  salvarVenda, editarVenda, buscarVendasCliente, type VendaFormData,
  type SaleItem, type SalePaymentRow, type ExchangeItemSelected, type VendaParaTroca, type EditSaleData,
} from '../actions'
import { createCustomer, type CustomerFormData } from '../../clientes/actions'
import { normalize, matchText, onlyDigits } from '@/lib/normalize'
import styles from './NovaVendaForm.module.css'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ProductOption {
  id: string; name: string; code: string; barcode_number: string; category: string; store_id: string
  sale_price: number; promotional_price: number | null; promotional_active: boolean
  cost_price: number; quantity_in_stock: number; is_service: boolean
}

interface CustomerOption {
  id: string; name: string; phone: string; cpf: string | null; birthday: string | null
}

interface StoreOption { id: string; name: string; city: string }

interface Settings {
  pixDiscountPct: number
  birthdayDiscountPct: number
  installmentThreshold: number
  maxInstallmentsDefault: number   // parcelas s/ juros padrão (regra: 5x)
  maxInstallmentsAbove: number     // parcelas s/ juros acima do threshold (regra: 6x)
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
  isService: boolean       // item de serviço (conserto) — ignora estoque
}

interface PaymentRow {
  method: 'cash' | 'pix' | 'debit' | 'credit'
  amount: number
  installments: number
  cardBrand?: string | null   // bandeira (crédito/débito), opcional
}

// Bandeiras de cartão (crédito/débito). value = o que grava no banco.
const CARD_BRANDS = [
  { value: 'visa',      label: 'Visa',   color: '#4B6DDB' },
  { value: 'mastercard', label: 'Master', color: '#F79E1B' },
  { value: 'elo',       label: 'Elo',    color: '#EFB700' },
  { value: 'amex',      label: 'Amex',   color: '#2E9BD6' },
  { value: 'hipercard', label: 'Hiper',  color: '#E2544C' },
] as const

interface Props {
  stores: StoreOption[]
  products: ProductOption[]
  customers: CustomerOption[]
  settings: Settings
  userProfile: UserProfile
  users: UserOption[]
  editSale?: EditSaleData    // presente = modo edição de uma venda existente
  onSaved?: () => void       // presente (PDV) = após salvar, fica na tela e reseta em vez de navegar
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
  return { productId: null, productName: '', quantity: 1, unitPrice: 0, unitCost: 0, stockAvailable: 0, isService: false }
}

// Navegação por teclado no grid de itens (mesmo padrão da Nova Compra).
// Cols: 0 = produto, 1 = qtd, 2 = preço.
function focusGridCell(row: number, col: number) {
  document.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)?.focus()
}

// ─── Hook: dropdown fixo ──────────────────────────────────────────────────────

function useFixedDropdown<T extends HTMLElement = HTMLInputElement>() {
  const inputRef = useRef<T>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  function measure() {
    if (!inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
  }

  function openAt() { measure() }
  function close() { setPos(null) }

  // Enquanto aberto, reposiciona colado ao campo ao rolar/redimensionar a tela.
  // Sem isso, o menu (position:fixed) fica cravado na coordenada antiga e "descola".
  const isOpen = pos !== null
  useEffect(() => {
    if (!isOpen) return
    function reposition() {
      if (!inputRef.current) return
      const r = inputRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    window.addEventListener('scroll', reposition, true) // capture: pega scroll de qualquer container
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [isOpen])

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
  const q = normalize(value)                 // sem acento + minúsculo
  const qDigits = onlyDigits(value)          // p/ telefone/CPF

  const filtered = q === ''
    ? customers.slice(0, 8)
    : customers.filter(c => {
        if (matchText(c.name, value)) return true   // trecho, ignora acento
        if (qDigits.length > 0) {
          if (c.phone && onlyDigits(c.phone).includes(qDigits)) return true
          if (c.cpf  && onlyDigits(c.cpf).includes(qDigits))  return true
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

function ProductCombobox({ value, onChange, products, rowIndex, colIndex, onGridKeyDown }: {
  value: string
  onChange: (name: string, product: ProductOption | null) => void
  products: ProductOption[]
  rowIndex?: number
  colIndex?: number
  onGridKeyDown?: (e: React.KeyboardEvent, row: number, col: number) => void
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const filtered = products.filter(p =>
    matchText(p.name, value) || matchText(p.code, value)   // trecho, ignora acento
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
        onKeyDown={e => { if (onGridKeyDown && rowIndex != null && colIndex != null) onGridKeyDown(e, rowIndex, colIndex) }}
        data-row={rowIndex}
        data-col={colIndex}
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
                  {p.is_service ? 'serviço' : p.quantity_in_stock <= 0 ? '(sem estoque)' : `${p.quantity_in_stock} em estoque`}
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

export default function NovaVendaForm({ stores, products, customers: initialCustomers, settings, userProfile, users, editSale, onSaved }: Props) {
  const router = useRouter()
  const isEditing = !!editSale

  // ── Estado geral ──────────────────────────────────────────────────────────
  // Admin abre a venda já com a loja principal (Campinas) pré-selecionada — sem
  // hardcode de UUID: casa por nome/cidade e cai no primeiro da lista se não achar.
  const defaultAdminStore =
    stores.find(s => /campin/i.test(s.name) || /campin/i.test(s.city))?.id
    ?? stores[0]?.id ?? ''
  const [saleDate, setSaleDate]   = useState(editSale?.saleDate ?? today())
  const [storeId, setStoreId]     = useState(editSale?.storeId ?? userProfile.storeId ?? defaultAdminStore)
  const [sellerId, setSellerId]   = useState<string>(editSale?.sellerId ?? userProfile.userId)
  const [notes, setNotes]         = useState(editSale?.notes ?? '')

  // ── Cliente ───────────────────────────────────────────────────────────────
  const [customers, setCustomers]           = useState(initialCustomers)
  const [customerSearch, setCustomerSearch] = useState(editSale?.customer?.name ?? '')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(editSale?.customer ?? null)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)

  // ── Itens da venda ────────────────────────────────────────────────────────
  const [rows, setRows] = useState<SaleRow[]>(
    editSale && editSale.rows.length ? editSale.rows.map(r => ({ ...r })) : [emptyRow()]
  )

  // ── Descontos ─────────────────────────────────────────────────────────────
  const [hasPix, setHasPix]           = useState(editSale?.hasPix ?? false)
  const [hasBirthday, setHasBirthday] = useState(editSale?.hasBirthday ?? false)
  const [manualDiscount, setManualDiscount] = useState(editSale?.manualDiscount ?? 0)

  // ── Pagamentos ────────────────────────────────────────────────────────────
  const [payments, setPayments] = useState<PaymentRow[]>(editSale?.payments ?? [])

  // ── Troca ─────────────────────────────────────────────────────────────────
  const [exchangeSales, setExchangeSales]     = useState<VendaParaTroca[]>([])
  const [exchangeLoading, setExchangeLoading] = useState(false)
  const [selectedExchangeItems, setSelectedExchangeItems] = useState<ExchangeItemSelected[]>([])

  // ── UI ────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // ── Scanner HID ───────────────────────────────────────────────────────────
  const [scanFeedback, setScanFeedback] = useState<{ text: string; ok: boolean } | null>(null)
  const scanBuffer   = useRef<{ chars: string[]; firstTs: number }>({ chars: [], firstTs: 0 })
  const scanStoreId  = useRef(storeId)
  const scanProducts = useRef(products)

  // ── Sync refs do scanner ──────────────────────────────────────────────────
  useEffect(() => { scanStoreId.current  = storeId   }, [storeId])
  useEffect(() => { scanProducts.current = products  }, [products])

  // ── Scanner HID: captura global de keydown ────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const buf = scanBuffer.current
      const now = Date.now()

      if (e.key === 'Enter') {
        const code    = buf.chars.join('')
        const elapsed = buf.firstTs ? now - buf.firstTs : 9999
        const nChars  = buf.chars.length
        buf.chars = []; buf.firstTs = 0

        // < 3 chars ou > 80ms/char = não é scanner
        if (nChars < 3 || (nChars > 1 && elapsed / nChars > 80)) return

        const storeProds = scanProducts.current.filter(p => p.store_id === scanStoreId.current)
        // O leitor lê o barcode_number impresso na etiqueta (ex: 10100).
        // Fallback no code (FV-MJ-C304) para entrada manual/digitada.
        const match      = storeProds.find(p => p.barcode_number === code)
                        ?? storeProds.find(p => p.code.toUpperCase() === code.toUpperCase())

        if (match) {
          const price = match.promotional_active && match.promotional_price
            ? match.promotional_price : match.sale_price
          const newRow: SaleRow = {
            productId: match.id, productName: match.name,
            quantity: 1, unitPrice: price,
            unitCost: match.cost_price, stockAvailable: match.quantity_in_stock,
            isService: match.is_service,
          }
          setRows(prev => {
            const last = prev[prev.length - 1]
            // preenche última linha se vazia; senão adiciona nova
            if (!last.productId && !last.productName.trim()) {
              return [...prev.slice(0, -1), newRow]
            }
            return [...prev, newRow]
          })
          setScanFeedback({ text: `${match.name} adicionado`, ok: true })
        } else {
          setScanFeedback({ text: `Código "${code}" não encontrado`, ok: false })
        }
        setTimeout(() => setScanFeedback(null), 2500)
        return
      }

      if (e.key.length === 1) {
        if (!buf.chars.length) buf.firstTs = now
        buf.chars.push(e.key)
      } else if (e.key !== 'Shift' && e.key !== 'CapsLock') {
        buf.chars = []; buf.firstTs = 0
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // No modo edição, os descontos vêm da venda salva — não deixar os efeitos
  // auto-derivarem (e sobrescreverem) no primeiro render. Liberados após montar.
  const editInit = useRef(isEditing)

  // ── Efeito: birthday discount ──────────────────────────────────────────────
  useEffect(() => {
    if (editInit.current) return
    if (selectedCustomer && isBirthdayMonth(selectedCustomer.birthday)) {
      setHasBirthday(true)
    } else {
      setHasBirthday(false)
    }
  }, [selectedCustomer])

  // ── Efeito: pix discount ───────────────────────────────────────────────────
  useEffect(() => {
    if (editInit.current) return
    const hasPixPayment = payments.some(p => p.method === 'pix')
    if (hasPixPayment && !hasPix) setHasPix(true)
    if (!hasPixPayment && hasPix) setHasPix(false)
  }, [payments])

  // Libera os efeitos acima após o primeiro render (deve rodar DEPOIS deles).
  useEffect(() => { editInit.current = false }, [])

  // ── Totais ────────────────────────────────────────────────────────────────
  const subtotal       = rows.reduce((s, r) => s + r.unitPrice * (r.quantity || 0), 0)
  const discountPct    = (hasPix ? settings.pixDiscountPct : 0) + (hasBirthday ? settings.birthdayDiscountPct : 0)
  // Desconto bruto → total arredondado para o inteiro mais próximo quando HÁ desconto
  // (≥0,50 sobe, <0,50 desce). O desconto é reconciliado p/ que subtotal − desconto = total.
  // Assim o valor exibido já é redondo e é exatamente o que grava no banco.
  const rawDiscount    = subtotal * discountPct / 100 + manualDiscount
  const rawTotal       = Math.max(0, subtotal - rawDiscount)
  const total          = rawDiscount > 0 ? Math.round(rawTotal) : parseFloat(rawTotal.toFixed(2))
  const discountAmt    = parseFloat((subtotal - total).toFixed(2))
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
    if (!p) { updateRow(i, { productId: null, productName: name, isService: false }); return }
    const price = p.promotional_active && p.promotional_price ? p.promotional_price : p.sale_price
    updateRow(i, {
      productId: p.id,
      productName: p.name,
      unitPrice: price,
      unitCost: p.cost_price,
      stockAvailable: p.quantity_in_stock,
      isService: p.is_service,
    })
  }

  // ── Navegação por teclado no grid (←/→ entre campos, Enter avança/cria linha) ──
  function handleGridKeyDown(e: React.KeyboardEvent, rowIndex: number, colIndex: number) {
    const input = e.target as HTMLInputElement
    const isNumeric = input.type === 'number'   // inputs number não expõem selectionStart
    const pos  = input.selectionStart ?? 0
    const posE = input.selectionEnd   ?? 0
    const len  = (input.value ?? '').length

    if (e.key === 'ArrowLeft') {
      if (isNumeric || (pos === 0 && posE === 0)) {
        e.preventDefault()
        if (colIndex > 0) focusGridCell(rowIndex, colIndex - 1)
      }
    } else if (e.key === 'ArrowRight') {
      if (isNumeric || (pos === len && posE === len)) {
        e.preventDefault()
        focusGridCell(rowIndex, colIndex + 1)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const nextInRow = document.querySelector<HTMLElement>(`[data-row="${rowIndex}"][data-col="${colIndex + 1}"]`)
      if (nextInRow) {
        nextInRow.focus()
      } else {
        const nextRowEl = document.querySelector<HTMLElement>(`[data-row="${rowIndex + 1}"][data-col="0"]`)
        if (nextRowEl) nextRowEl.focus()
        else { addRow(); setTimeout(() => focusGridCell(rowIndex + 1, 0), 30) }
      }
    }
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
    setPayments(prev => [...prev, { method, amount: 0, installments: 1, cardBrand: null }])
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
  // Lê o limite direto da config (sem hardcode): acima do threshold usa o limite
  // "acima de 3k" (6x), senão o padrão (5x). Mudar a config passa a refletir aqui.
  const maxInstallments = total >= settings.installmentThreshold
    ? settings.maxInstallmentsAbove
    : settings.maxInstallmentsDefault

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
    const result = isEditing ? await editarVenda(editSale!.id, formData) : await salvarVenda(formData)
    setSaving(false)

    if (!result.success) { setError(result.error ?? 'Erro ao salvar.'); return }
    if (onSaved) { onSaved(); return }   // PDV: fica na tela (o pai reseta o form)
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

        {scanFeedback && (
          <div className={scanFeedback.ok ? styles.scanToastOk : styles.scanToastErr}>
            {scanFeedback.ok
              ? <CheckCircle2 size={13} />
              : <AlertTriangle size={13} />}
            {scanFeedback.text}
          </div>
        )}

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
                const stockWarn = row.productId && !row.isService && qty > row.stockAvailable && row.stockAvailable >= 0
                const noStock   = !row.isService && row.stockAvailable === 0 && row.productId

                return (
                  <tr key={i} className={styles.row}>
                    <td className={styles.tdNum}>{i + 1}</td>

                    <td className={styles.tdProd}>
                      <ProductCombobox
                        value={row.productName}
                        onChange={(name, p) => handleProductSelect(i, name, p)}
                        products={products.filter(p => p.store_id === storeId)}
                        rowIndex={i}
                        colIndex={0}
                        onGridKeyDown={handleGridKeyDown}
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
                        data-row={i}
                        data-col={1}
                        onKeyDown={e => handleGridKeyDown(e, i, 1)}
                      />
                    </td>

                    <td className={styles.tdPrice}>
                      <input
                        type="number" min="0" step="0.01"
                        className={styles.cell}
                        value={row.unitPrice || ''}
                        onChange={e => updateRow(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                        placeholder="0,00"
                        data-row={i}
                        data-col={2}
                        onKeyDown={e => handleGridKeyDown(e, i, 2)}
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
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className={styles.paymentRow}>
                  <select
                    className={styles.payCell}
                    value={p.method}
                    onChange={e => {
                      const m = e.target.value as PaymentRow['method']
                      updatePayment(i, {
                        method: m,
                        installments: 1,
                        cardBrand: (m === 'credit' || m === 'debit') ? (p.cardBrand ?? null) : null,
                      })
                    }}
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

                {/* Bandeira do cartão — crédito e débito (opcional) */}
                {(p.method === 'credit' || p.method === 'debit') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Bandeira:</span>
                    {CARD_BRANDS.map(b => {
                      const on = p.cardBrand === b.value
                      return (
                        <button
                          type="button"
                          key={b.value}
                          onClick={() => updatePayment(i, { cardBrand: on ? null : b.value })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                            fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 6,
                            border: `1px solid ${on ? '#C9A84C' : 'var(--border, rgba(128,128,128,.35))'}`,
                            background: on ? 'rgba(201,168,76,.14)' : 'transparent',
                            color: on ? '#C9A84C' : 'var(--text-muted)',
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, display: 'inline-block' }} />
                          {b.label}
                        </button>
                      )
                    })}
                  </div>
                )}
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
          {isEditing ? 'Salvar alterações' : 'Salvar Venda →'}
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
