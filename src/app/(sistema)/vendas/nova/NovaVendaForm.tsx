'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import {
  Plus, Trash2, AlertTriangle, ChevronDown, Cake, X, CreditCard,
  Banknote, Smartphone, ArrowLeftRight, RefreshCw, User, CheckCircle2,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import {
  salvarVenda, editarVenda, type VendaFormData,
  type SaleItem, type SalePaymentRow, type ExchangeItemSelected, type EditSaleData,
} from '../actions'
import { clientesComMesmoTelefone, createCustomer, searchCustomers, type ClienteComMesmoTelefone, type CustomerFormData } from '../../clientes/actions'
import { matchText } from '@/lib/normalize'
import { todaySP } from '@/lib/date'
import styles from './NovaVendaForm.module.css'
import { formatarTelefone, mascararTelefone, normalizarTelefone, validarTelefone } from '@/lib/telefone'
import { formatarDinheiro } from '@/lib/dinheiro'
import { calcularTotalDaVenda } from '@/lib/vendas/total'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { posicionarDropdown, type PosicaoDropdown } from '@/lib/dropdown'

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
  /*
   * Peça que está VOLTANDO, não saindo.
   *
   * A cliente chega com a peça na mão e a etiqueta colada nela. Marcar a linha
   * é tudo: o valor passa a abater em vez de somar, o estoque sobe em vez de
   * descer, e a diferença entre o que volta e o que leva é o que ela paga —
   * ou recebe.
   */
  isTroca: boolean
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
  /**
   * `barcode_number` lido em outra tela do sistema. A venda abre já com essa peça
   * na primeira linha, preenchida com tudo que dá para deduzir do produto.
   */
  bipInicial?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/* Dinheiro: um formatador só para o sistema — ver src/lib/dinheiro.ts */
const fmt = formatarDinheiro

function today() {
  return todaySP()   // fuso de Brasília
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
  return { productId: null, productName: '', quantity: 1, unitPrice: 0, unitCost: 0, stockAvailable: 0, isService: false, isTroca: false }
}

/**
 * Monta a linha da venda a partir do produto. Tudo o que dá para deduzir do
 * cadastro entra aqui — preço (respeitando promoção ativa), custo, estoque
 * disponível e se é serviço. O que depende de decisão humana (cliente, forma de
 * pagamento, parcelas, desconto) fica em branco de propósito.
 */
function rowDoProduto(p: ProductOption): SaleRow {
  return {
    productId: p.id,
    productName: p.name,
    quantity: 1,
    unitPrice: p.promotional_active && p.promotional_price ? p.promotional_price : p.sale_price,
    unitCost: p.cost_price,
    stockAvailable: p.quantity_in_stock,
    isService: p.is_service,
    isTroca: false,
  }
}

// Navegação por teclado no grid de itens (mesmo padrão da Nova Compra).
// Cols: 0 = produto, 1 = qtd, 2 = preço.
function focusGridCell(row: number, col: number) {
  document.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)?.focus()
}

// ─── Hook: dropdown fixo ──────────────────────────────────────────────────────

function useFixedDropdown<T extends HTMLElement = HTMLInputElement>() {
  const inputRef = useRef<T>(null)
  const [pos, setPos] = useState<PosicaoDropdown | null>(null)

  /* A posição sai de `posicionarDropdown`: abre para cima quando não cabe
   * embaixo e limita a altura ao espaço da janela. Antes era sempre
   * `top: bottom + 4`, e perto do pé da tela a lista era cortada sem saída. */
  function measure() {
    if (!inputRef.current) return
    setPos(posicionarDropdown(inputRef.current.getBoundingClientRect()))
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
      setPos(posicionarDropdown(inputRef.current.getBoundingClientRect()))
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
        <div className={styles.comboDropdown} style={{
          position: 'fixed', left: pos.left, width: Math.max(pos.width, 160), zIndex: 9999,
          ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
          maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
        }}>
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
  /** Recebe o texto já digitado — ver CreateCustomerModal. */
  onCreateClick: (nomeDigitado: string) => void
  customers: CustomerOption[]
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const q = value.trim()
  const [serverResults, setServerResults] = useState<CustomerOption[]>([])
  const [searching, setSearching] = useState(false)

  // Busca server-side (debounce) — não carrega toda a base de clientes no front.
  useEffect(() => {
    if (q === '') { setServerResults([]); setSearching(false); return }
    let active = true
    setSearching(true)
    const t = setTimeout(async () => {
      const res = await searchCustomers(q)
      if (active) { setServerResults(res as CustomerOption[]); setSearching(false) }
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [q])

  // Termo vazio: primeiros do conjunto inicial (instantâneo). Digitando: servidor.
  const filtered = q === '' ? customers.slice(0, 8) : serverResults.slice(0, 8)

  // Opção destacada para navegar com ↑/↓ e escolher com Enter
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setHighlight(0) }, [value])

  const hi = Math.min(highlight, Math.max(0, filtered.length - 1))
  useEffect(() => {
    if (!pos) return
    listRef.current?.querySelector<HTMLElement>(`[data-opt="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hi, pos])

  function pick(c: CustomerOption) {
    onChange(c, c.name)
    close()
    setHighlight(0)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (pos && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return }
      if (e.key === 'Enter')     { e.preventDefault(); pick(filtered[hi]); return }
    }
    if (e.key === 'Escape')      { e.preventDefault(); close(); return }
    if (e.key === 'ArrowDown' && !pos) { e.preventDefault(); openAt(); setHighlight(0) }
  }

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
          onKeyDown={handleKeyDown}
          placeholder="Buscar por nome, CPF ou telefone..."
          autoComplete="off"
        />
      </div>
      {pos && (
        <div ref={listRef} className={styles.comboDropdown} style={{
          position: 'fixed', left: pos.left, width: Math.max(pos.width, 320), zIndex: 9999,
          ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
          maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
        }}>
          {filtered.map((c, idx) => (
            <div
              key={c.id}
              data-opt={idx}
              className={`${styles.comboOption} ${idx === hi ? styles.comboOptionActive : ''}`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={() => pick(c)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="nome-cliente" style={{ fontWeight: 600 }}>{c.name}</span>
                {isBirthdayMonth(c.birthday) && <Cake size={12} style={{ color: 'var(--accent)' }} />}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatarTelefone(c.phone)}{c.cpf ? ` · CPF: ${c.cpf}` : ''}</span>
            </div>
          ))}
          {filtered.length === 0 && q !== '' && (
            <div className={styles.comboEmpty}>
              {searching ? 'Buscando…' : `Nenhum cliente encontrado para "${value}"`}
            </div>
          )}
          <div className={styles.comboCreateBtn} onMouseDown={() => { close(); onCreateClick(value) }}>
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

  // Opção destacada para navegar com ↑/↓ e escolher com Enter
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setHighlight(0) }, [value])

  const hi = Math.min(highlight, Math.max(0, filtered.length - 1))
  const isOpen = !!pos && filtered.length > 0

  // Mantém a opção destacada visível ao rolar com o teclado
  useEffect(() => {
    if (!isOpen) return
    listRef.current?.querySelector<HTMLElement>(`[data-opt="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hi, isOpen])

  function pick(p: ProductOption) {
    onChange(p.name, p)
    close()
    setHighlight(0)
    if (rowIndex != null) setTimeout(() => focusGridCell(rowIndex, 1), 0)  // vai para a quantidade
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return }
      if (e.key === 'Enter')     { e.preventDefault(); pick(filtered[hi]); return }
      if (e.key === 'Escape')    { e.preventDefault(); close(); return }
    } else if (e.key === 'ArrowDown' && filtered.length > 0) {
      e.preventDefault(); openAt(); setHighlight(0); return    // ↓ abre o dropdown
    }
    // Sem dropdown aberto: navegação normal do grid (←/→/Enter)
    if (onGridKeyDown && rowIndex != null && colIndex != null) onGridKeyDown(e, rowIndex, colIndex)
  }

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        className={styles.cell}
        value={value}
        onChange={e => { onChange(e.target.value, null); openAt() }}
        onFocus={openAt}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={handleKeyDown}
        data-row={rowIndex}
        data-col={colIndex}
        placeholder="Nome ou código..."
        autoComplete="off"
      />
      {isOpen && (
        <div ref={listRef} className={styles.comboDropdown} style={{
          position: 'fixed', left: pos!.left, width: Math.max(pos!.width, 320), zIndex: 9999,
          ...(pos!.top !== undefined ? { top: pos!.top } : { bottom: pos!.bottom }),
          maxHeight: pos!.maxHeight, display: 'flex', flexDirection: 'column',
        }}>
          {filtered.map((p, idx) => (
            <div
              key={p.id}
              data-opt={idx}
              className={`${styles.comboOption} ${idx === hi ? styles.comboOptionActive : ''}`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={() => pick(p)}
            >
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

/* Quarta cópia de máscara de telefone, removida. Ela não escrevia o "+55" e o
 * cadastro rápido salvava "(19) 99567-2222" enquanto /clientes salvava
 * "+5519995672222" — duas telas alimentando a MESMA coluna em formatos
 * diferentes, que é como a base chegou a ter três formatos convivendo.
 * Ver src/lib/telefone.ts. */
const maskPhone = mascararTelefone

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3)  return d
  if (d.length <= 6)  return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9)  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

// ─── Modal criar cliente ──────────────────────────────────────────────────────

/**
 * `nomeInicial` vem do que a operadora já digitou na busca.
 *
 * No treinamento de 02/09 a dona digitou "Rosiane", não achou, clicou em criar
 * — e o formulário abriu em branco. "Ele já podia continuar de onde eu parei,
 * né?" Com cliente esperando no balcão, digitar o nome duas vezes é atrito
 * real, ainda mais para quem se declara lenta no computador.
 */
function CreateCustomerModal({ storeId, nomeInicial, onClose, onCreated }: {
  storeId: string
  nomeInicial?: string
  onClose: () => void
  onCreated: (c: CustomerOption) => void
}) {
  const [name, setName]         = useState(nomeInicial ?? '')
  const [phone, setPhone]       = useState('')
  const [cpf, setCpf]           = useState('')
  const [birthday, setBirthday] = useState('')
  const [email, setEmail]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  /* Mesmo aviso de /clientes: telefone repetido não bloqueia, mas aparece. */
  const [duplicatas, setDuplicatas] = useState<ClienteComMesmoTelefone[]>([])

  async function handleSave() {
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    // Mesma validação de /clientes: exige DDD + número, não só "tem alguma coisa".
    const erroTel = validarTelefone(phone)
    if (erroTel) { setError(erroTel); return }
    setSaving(true)
    setError('')
    const result = await createCustomer({
      // Grava na forma canônica (+5519995672222), como /clientes. Sem isso, o
      // cliente criado na venda não é achado depois pela busca por telefone.
      name, phone: normalizarTelefone(phone), cpf, email, birthday,
      address: '', city: '', state: '', zip_code: '',
      origin_store_id: storeId,
      notes: '',
    })
    setSaving(false)
    if (!result.success) { setError(result.error ?? 'Erro ao salvar.'); return }
    // result.id vem do banco — nunca vazio
    onCreated({ id: result.id!, name: name.trim(), phone: normalizarTelefone(phone), cpf: cpf.replace(/\D/g, '') || null, birthday: birthday || null })
  }

  return (
    <Modal isOpen title="Novo Cliente" onClose={onClose}>
      <div className={styles.createCustomerForm}>
        <div className={styles.createRow}>
          <div className={styles.createField}>
            <label>Nome <span className={styles.req}>*</span></label>
            {/* O foco vai para o NOME quando ele está vazio e para o TELEFONE
                quando o nome já veio da busca — que é o próximo campo a
                preencher, e evita o cursor parado num campo já certo. */}
            <input className={styles.createInput} value={name} onChange={e => setName(e.target.value)}
              placeholder="Nome completo" autoFocus={!nomeInicial} />
          </div>
        </div>
        <div className={styles.createRow}>
          <div className={styles.createField}>
            <label>Telefone <span className={styles.req}>*</span></label>
            <input
              className={styles.createInput}
              value={phone}
              onChange={e => {
                const v = maskPhone(e.target.value)
                setPhone(v)
                clientesComMesmoTelefone(v).then(setDuplicatas)
              }}
              autoFocus={!!nomeInicial}
              placeholder="+55 (11) 99999-9999"
              inputMode="numeric"
            />
            {duplicatas.length > 0 && (
              <div className={styles.duplicataAviso}>
                <AlertTriangle size={12} />
                <span>
                  Já cadastrada:{' '}
                  {duplicatas.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}<strong>{d.name}</strong>
                      {d.vendas > 0 && ` (${d.vendas} ${d.vendas === 1 ? 'venda' : 'vendas'})`}
                    </span>
                  ))}
                  . Cancele e busque acima se for a mesma pessoa.
                </span>
              </div>
            )}
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

export default function NovaVendaForm({ stores, products, customers: initialCustomers, settings, userProfile, users, editSale, onSaved, bipInicial }: Props) {
  const router = useRouter()
  const isEditing = !!editSale

  // Peça bipada em outra tela. A operadora só vende na própria loja, então só
  // aceita o pré-preenchimento se a peça for de lá.
  const produtoBipado = bipInicial && !editSale
    ? products.find(p =>
        p.barcode_number === bipInicial &&
        (!userProfile.storeId || p.store_id === userProfile.storeId))
    : undefined

  // ── Estado geral ──────────────────────────────────────────────────────────
  // Admin abre a venda já com a loja principal (Campinas) pré-selecionada — sem
  // hardcode de UUID: casa por nome/cidade e cai no primeiro da lista se não achar.
  const defaultAdminStore =
    stores.find(s => /campin/i.test(s.name) || /campin/i.test(s.city))?.id
    ?? stores[0]?.id ?? ''
  const [saleDate, setSaleDate]   = useState(editSale?.saleDate ?? today())
  // Admin que bipa uma peça de Brasília abre a venda já naquela loja
  const [storeId, setStoreId]     = useState(editSale?.storeId ?? userProfile.storeId ?? produtoBipado?.store_id ?? defaultAdminStore)
  const [sellerId, setSellerId]   = useState<string>(editSale?.sellerId ?? userProfile.userId)
  const [notes, setNotes]         = useState(editSale?.notes ?? '')

  // ── Cliente ───────────────────────────────────────────────────────────────
  const [customers, setCustomers]           = useState(initialCustomers)
  const [customerSearch, setCustomerSearch] = useState(editSale?.customer?.name ?? '')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(editSale?.customer ?? null)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)
  const [nomeNovoCliente, setNomeNovoCliente] = useState('')

  // ── Itens da venda ────────────────────────────────────────────────────────
  const [rows, setRows] = useState<SaleRow[]>(
    editSale && editSale.rows.length ? editSale.rows.map(r => ({ ...r, isTroca: false }))
      : produtoBipado ? [rowDoProduto(produtoBipado)]
      : [emptyRow()]
  )

  // ── Descontos ─────────────────────────────────────────────────────────────
  const [hasPix, setHasPix]           = useState(editSale?.hasPix ?? false)
  const [hasBirthday, setHasBirthday] = useState(editSale?.hasBirthday ?? false)
  /*
   * Desconto manual: a operadora digita em R$ OU em %.
   *
   * A loja trabalha em porcentagem — "30%", "5%" —, e antes só havia campo de
   * reais. Ela calculava de cabeça e digitava o resultado; numa venda de
   * 31/08 saiu R$2 a mais para a cliente por causa disso.
   *
   * O que vale é sempre o R$ (é o que grava no banco). Em modo %, ele é
   * DERIVADO do subtotal, então mudar um item recalcula sozinho — se
   * guardássemos o R$ congelado, a porcentagem viraria mentira ao adicionar
   * uma peça.
   */
  /*
   * Fiado: a cliente leva a peça e paga o resto depois. Acontece, e o sistema
   * precisa distinguir isso de erro de digitação — a diferença entre as duas
   * é só a intenção, e só quem está no balcão sabe qual é.
   */
  /*
   * CPF na nota, pedido no treinamento de 31/08.
   *
   * Fica na VENDA, não no cadastro da cliente: é o CPF que vai naquele
   * documento fiscal. A cliente pode pedir em uma compra e não pedir na
   * seguinte, e nem sempre o CPF é dela — às vezes é do marido, da mãe.
   * Gravar no cadastro faria a próxima nota sair com CPF de outra pessoa.
   *
   * Vem preenchido com o CPF do cadastro quando existe, porque é o caso comum,
   * e a operadora apaga se for outro.
   */
  const [destinatarioCpf, setDestinatarioCpf] = useState(editSale?.destinatarioCpf ?? '')
  const [cpfAberto, setCpfAberto] = useState(false)

  const [aceitouFiado, setAceitouFiado] = useState(false)
  const [previsaoPagamento, setPrevisaoPagamento] = useState('')

  const [manualModo, setManualModo]     = useState<'valor' | 'pct'>('valor')
  const [manualValor, setManualValor]   = useState(editSale?.manualDiscount ?? 0)
  const [manualPct, setManualPct]       = useState(0)

  // ── Pagamentos ────────────────────────────────────────────────────────────
  const [payments, setPayments] = useState<PaymentRow[]>(editSale?.payments ?? [])

  // ── Troca ─────────────────────────────────────────────────────────────────
  /*
   * O painel de "buscar a venda antiga e marcar itens" foi removido.
   *
   * Nunca funcionou na prática — `fv.exchanges` estava com zero linhas, e no
   * treinamento de 31/08 a troca não pôde ser registrada ao vivo por isso.
   * A própria dona desenhou o substituto: marcar a peça na linha do item.
   *
   * O crédito da troca agora nasce do subtotal: peça marcada abate. Não há
   * mais `exchangeCredit` separado — havia dois números para a mesma coisa.
   */

  // ── UI ────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // ── Scanner HID ───────────────────────────────────────────────────────────
  // A mecânica da captura (cadência, desfazer o que o leitor digitou no campo em
  // foco, cancelar o Enter) mora em useBarcodeScanner. Aqui fica só o que fazer
  // com o código lido.
  const [scanFeedback, setScanFeedback] = useState<{ text: string; ok: boolean } | null>(null)
  const scanStoreId  = useRef(storeId)
  const scanProducts = useRef(products)

  // ── Sync refs do scanner ──────────────────────────────────────────────────
  useEffect(() => { scanStoreId.current  = storeId   }, [storeId])
  useEffect(() => { scanProducts.current = products  }, [products])

  // ── Scanner HID: o que fazer com o código lido ────────────────────────────
  const aoBipar = useCallback((code: string) => {
    const storeProds = scanProducts.current.filter(p => p.store_id === scanStoreId.current)

    // O leitor lê o barcode_number impresso na etiqueta (ex: 10100), que é
    // único. O `code` (F+fornecedor+mês+custo) NÃO é único — 173 códigos
    // cobrem produtos diferentes, um deles com 4 peças de R$ 68 a R$ 698.
    // Por isso o fallback só resolve quando é inequívoco: escolher "o
    // primeiro" venderia a peça errada com o preço errado, em silêncio.
    let match = storeProds.find(p => p.barcode_number === code)
    if (!match) {
      const porCode = storeProds.filter(p => p.code.toUpperCase() === code.toUpperCase())
      if (porCode.length === 1) {
        match = porCode[0]
      } else if (porCode.length > 1) {
        setScanFeedback({
          text: `"${code}" é o código de ${porCode.length} produtos diferentes — bipe o código de barras ou busque pelo nome`,
          ok: false,
        })
        setTimeout(() => setScanFeedback(null), 4000)
        return
      }
    }

    if (match) {
      const achado = match
      let aviso: string | null = null

      setRows(prev => {
        // Mesma peça bipada de novo soma quantidade, em vez de criar outra
        // linha igual — comportamento esperado de PDV.
        const iExistente = prev.findIndex(r => r.productId === achado.id)
        if (iExistente >= 0) {
          // `quantity` aceita string vazia enquanto a operadora digita
          const qtdAtual = Number(prev[iExistente].quantity) || 0
          /* Linha de troca não tem teto de estoque: a peça está ENTRANDO. */
          const limite = (achado.is_service || prev[iExistente].isTroca)
            ? Infinity
            : achado.quantity_in_stock
          if (qtdAtual >= limite) {
            aviso = `${achado.name}: só há ${limite} em estoque`
            return prev
          }
          return prev.map((r, i) => i === iExistente ? { ...r, quantity: qtdAtual + 1 } : r)
        }

        const newRow = rowDoProduto(achado)
        const last = prev[prev.length - 1]
        // preenche última linha se vazia; senão adiciona nova
        if (!last.productId && !last.productName.trim()) {
          return [...prev.slice(0, -1), newRow]
        }
        return [...prev, newRow]
      })
      setScanFeedback(aviso ? { text: aviso, ok: false } : { text: `${achado.name} adicionado`, ok: true })
    } else {
      setScanFeedback({ text: `Código "${code}" não encontrado`, ok: false })
    }
    setTimeout(() => setScanFeedback(null), 2500)
  }, [])

  useBarcodeScanner({ onScan: aoBipar })

  // No modo edição, os descontos vêm da venda salva — não deixar os efeitos
  // auto-derivarem (e sobrescreverem) no primeiro render. Liberados após montar.
  const editInit = useRef(isEditing)

  /*
   * Uma vez que a operadora mexe no desconto, ele é DELA.
   *
   * O bug relatado no treinamento de 31/08: o desconto ligava sozinho, sem
   * ninguém clicar. Era o efeito abaixo — escolher PIX como pagamento marcava
   * os 5% automaticamente, e tirar o PIX desmarcava de volta, mesmo que ela
   * tivesse marcado de propósito.
   *
   * A sugestão continua (PIX ainda propõe os 5%, que é a política da loja),
   * mas só até alguém discordar. Desconto é concessão comercial: quem decide
   * é quem está atendendo, não o método de pagamento.
   */
  const aniversarioTocado = useRef(false)

  // ── Efeito: birthday discount ──────────────────────────────────────────────
  useEffect(() => {
    if (editInit.current || aniversarioTocado.current) return
    setHasBirthday(!!selectedCustomer && isBirthdayMonth(selectedCustomer.birthday))
  }, [selectedCustomer])

  /*
   * NÃO existe mais efeito ligando o desconto de PIX sozinho.
   *
   * Ele ligava ao escolher PIX como forma de pagamento, e foi isso que cobrou
   * R$14 a menos na troca da Magda, ao vivo, no treinamento de 02/09. O
   * `pixTocado` só protegia DEPOIS que a operadora mexesse no toggle — na
   * primeira vez ela não tinha como saber que tinha ligado.
   *
   * A dona resolveu na hora: "às vezes eu nem dou desconto". O toggle continua
   * ali; quem quiser dar desconto, marca.
   */

  // Libera os efeitos acima após o primeiro render (deve rodar DEPOIS deles).
  useEffect(() => { editInit.current = false }, [])

  // ── Totais ────────────────────────────────────────────────────────────────
  /*
   * A peça devolvida NÃO abate do subtotal: ela é uma forma de PAGAMENTO.
   *
   * A loja vendeu um colar de R$498; a cliente pagou R$428 em mercadoria e
   * R$70 em Pix. O total da venda é 498 — é o que ela levou. Tratar a troca
   * como desconto faria o faturamento do dia dizer R$70 numa venda de R$498.
   *
   * Isso também é o que o SERVIDOR faz: `createSale` calcula o subtotal a
   * partir de `items`, que já exclui as linhas de troca. Na primeira versão
   * eu abati aqui e não lá — a tela mostrava R$70 e o banco gravava R$498.
   * Mesmo erro do arredondamento, no mesmo dia. Enquanto os dois lados
   * tiverem regras próprias, eles vão divergir.
   */
  const subtotal       = rows.reduce((s, r) =>
    r.isTroca ? s : s + r.unitPrice * (r.quantity || 0), 0)

  /* O que a peça devolvida vale — cobre parte do total, como um pagamento. */
  const creditoTroca   = rows.reduce((s, r) =>
    r.isTroca ? s + r.unitPrice * (r.quantity || 0) : s, 0)
  /* Em modo %, o valor acompanha o subtotal; em modo R$, é o que foi digitado. */
  const manualDiscount = manualModo === 'pct'
    ? parseFloat((subtotal * manualPct / 100).toFixed(2))
    : manualValor
  const discountPct    = (hasPix ? settings.pixDiscountPct : 0) + (hasBirthday ? settings.birthdayDiscountPct : 0)
  /*
   * A conta é a MESMA que o servidor usa ao gravar — ver src/lib/vendas/total.ts.
   * Aqui é só espelho: quem calcula de verdade é `createSale`/`editarVenda`.
   * Enquanto os dois importarem daqui, tela e banco não podem divergir.
   */
  const { total, discountAmt } = calcularTotalDaVenda({
    subtotal, discountPct, manualDiscount,
  })
  const paidTotal      = payments.reduce((s, p) => s + p.amount, 0)
  /*
   * O QUE A CLIENTE PAGA — total da venda menos a mercadoria que ela devolveu.
   *
   * `total` continua sendo o faturamento (o que ela LEVOU) e é o que vai para o
   * banco. Mas quem está no balcão precisa de outro número: quanto cobrar. Eram
   * dois números diferentes espalhados em dois blocos, e a dona teve de fazer a
   * conta de cabeça — "aparece 182 + 152 e falta 30, fica confuso".
   */
  const aCobrar        = parseFloat((total - creditoTroca).toFixed(2))
  const coveredTotal   = paidTotal + creditoTroca
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
    /* Sugestão, não regra: se a cliente pedir a nota, o CPF dela já está ali. */
    setDestinatarioCpf(c?.cpf ? maskCpf(c.cpf) : '')
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

    /*
     * Troca exige cliente: `fv.exchanges.customer_id` é NOT NULL. Sem esta
     * checagem o erro só apareceria no banco, depois de a venda já ter sido
     * criada — deixando venda gravada e troca não.
     */
    if (rows.some(r => r.isTroca) && !selectedCustomer) {
      setError('Troca precisa de cliente identificado. Selecione a cliente acima.')
      return
    }
    if (rows.some(r => r.isTroca) && rows.every(r => r.isTroca)) {
      setError('Só há peças devolvidas. Adicione a peça que a cliente está levando.')
      return
    }
    /*
     * Devolveu mais do que levou: a loja fica devendo.
     *
     * `total` é clampado em zero (Math.max), então sem esta checagem a venda
     * fecharia em R$0 e o crédito da cliente sumiria — ninguém saberia que ela
     * tem valor a receber. Não existe vale no sistema; enquanto não existir, o
     * certo é resolver no balcão, não gravar torto.
     */
    if (creditoTroca - subtotal > 0.009) {
      setError(`As peças devolvidas valem ${fmt(creditoTroca - subtotal)} a mais que as levadas. Acerte no balcão ou adicione outra peça — o sistema ainda não emite vale.`)
      return
    }

    /*
     * Conferência do que foi pago contra o total.
     *
     * A regra antiga computava `paymentsOk` e depois só o usava se NÃO houvesse
     * pagamento nenhum — ou seja, com uma forma de pagamento qualquer, qualquer
     * valor passava calado. Três vendas reais entraram assim:
     *
     *   Graziela Amaral   total R$565,00   cobrado R$567,00   (+R$2)
     *   Juliana Benatti   total R$1.303,00 cobrado R$1.304,00 (+R$1)
     *   Bea Baroudi       total R$645,00   pago    R$300,00   (−R$345)
     *
     * Os dois primeiros são dinheiro cobrado a mais da cliente, sem ninguém
     * perceber. O terceiro é fiado legítimo — mas gravou como venda concluída,
     * então os R$345 sumiram de qualquer cobrança.
     *
     * Sobra e falta são coisas diferentes e passam a ser tratadas assim:
     * cobrar a mais é sempre erro; cobrar a menos é fiado, e precisa ser dito.
     */
    if (payments.length === 0 && creditoTroca <= 0 && total > 0.009) {
      setError('Adicione ao menos uma forma de pagamento.')
      return
    }
    if (balanceDiff > 0.009) {
      setError(`O pagamento está ${fmt(balanceDiff)} MAIOR que o total da venda. Confira os valores.`)
      return
    }
    if (balanceDiff < -0.009 && !aceitouFiado) {
      setError(`Faltam ${fmt(-balanceDiff)} para fechar a venda. Marque "fica devendo" se a cliente vai pagar depois.`)
      return
    }

    /*
     * A grade guarda as duas metades da troca. Aqui elas se separam: linha sem
     * marca é peça saindo (item de venda), linha marcada é peça voltando
     * (item de troca, que dá entrada no estoque).
     */
    const items: SaleItem[] = rows.filter(r => !r.isTroca).map(r => ({
      productId:   r.productId!,
      productName: r.productName,
      quantity:    (r.quantity as number) || 1,
      unitPrice:   r.unitPrice,
      unitCost:    r.unitCost,
    }))

    const devolvidos: ExchangeItemSelected[] = rows.filter(r => r.isTroca).map(r => ({
      originalSaleId: null,
      productId:      r.productId!,
      productName:    r.productName,
      quantity:       (r.quantity as number) || 1,
      unitPrice:      r.unitPrice,
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
      previsaoPagamento: aceitouFiado && previsaoPagamento ? previsaoPagamento : null,
      destinatarioCpf: destinatarioCpf.replace(/\D/g, '') || null,
      payments,
      exchangeItems: devolvidos,
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
                {selectedCustomer.phone && <span className={styles.selectedCustomerMeta}>{formatarTelefone(selectedCustomer.phone)}</span>}
                <button
                  type="button"
                  className={styles.cpfBtn}
                  onClick={() => setCpfAberto(v => !v)}
                  title="CPF para a nota fiscal"
                >
                  {destinatarioCpf ? `CPF ${destinatarioCpf}` : '+ CPF na nota'}
                </button>
                <button className={styles.clearCustomerBtn} onClick={() => selectCustomer(null, '')}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <CustomerCombobox
                value={customerSearch}
                onChange={selectCustomer}
                onCreateClick={nome => { setNomeNovoCliente(nome); setShowCreateCustomer(true) }}
                customers={customers}
              />
            )}
            {selectedCustomer && cpfAberto && (
              <div className={styles.cpfBox}>
                <label>
                  <span>CPF na nota fiscal</span>
                  <input
                    className={styles.createInput}
                    value={destinatarioCpf}
                    onChange={e => setDestinatarioCpf(maskCpf(e.target.value))}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    autoFocus
                  />
                </label>
                <span className={styles.cpfDica}>
                  Opcional. Só entra se a cliente pedir a nota no CPF dela.
                </span>
              </div>
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
                <th className={styles.thTroca}>Troca</th>
                <th className={`${styles.thQty} col-num`}>Qtd</th>
                <th className={styles.thPrice}>Preço Unit.</th>
                {/* "Total do item", não "Subtotal": havia dois "Subtotal" na
                    mesma tela querendo dizer coisas diferentes — o da LINHA e o
                    da VENDA. A dona disse duas vezes que a tela confundia. */}
                <th className={`${styles.thSub} col-num`}>Total do item</th>
                <th className={styles.thDel}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const qty = row.quantity || 0
                const rowSubtotal = row.unitPrice * qty
                /* Peça que volta não precisa ter estoque — ela É o estoque
                   chegando. Avisar "sem estoque" numa devolução seria ruído. */
                const stockWarn = row.productId && !row.isService && !row.isTroca && qty > row.stockAvailable && row.stockAvailable >= 0
                const noStock   = !row.isService && !row.isTroca && row.stockAvailable === 0 && row.productId

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

                    {/*
                      O marcador que a Fernanda desenhou no treinamento de
                      31/08: um clique na linha da peça diz se ela está saindo
                      ou voltando. Sem tela separada, sem buscar a venda antiga.
                    */}
                    <td className={styles.tdTroca}>
                      <button
                        type="button"
                        className={`${styles.trocaBtn} ${row.isTroca ? styles.trocaBtnAtivo : ''}`}
                        onClick={() => updateRow(i, { isTroca: !row.isTroca })}
                        disabled={!row.productId}
                        title={row.isTroca
                          ? 'Está voltando para o estoque. Clique para desfazer.'
                          : 'Marcar como peça devolvida pela cliente'}
                      >
                        <ArrowLeftRight size={13} />
                      </button>
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
                      <span className={`${styles.subtotalText} ${row.isTroca ? styles.subtotalTroca : ''}`}>
                        {rowSubtotal > 0
                          ? (row.isTroca ? `crédito ${fmt(rowSubtotal)}` : fmt(rowSubtotal))
                          : '—'}
                      </span>
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
            <input type="checkbox" checked={hasPix}
              onChange={e => setHasPix(e.target.checked)} />
            <span>PIX</span>
            <span className={styles.discountPct}>−{settings.pixDiscountPct}%</span>
            <span className={styles.discountAmt}>{subtotal > 0 ? fmt(subtotal * settings.pixDiscountPct / 100) : ''}</span>
          </label>

          <label className={styles.discountRow}>
            <input type="checkbox" checked={hasBirthday}
              onChange={e => { aniversarioTocado.current = true; setHasBirthday(e.target.checked) }}
              disabled={!selectedCustomer} />
            <span>Aniversário</span>
            <span className={styles.discountPct}>−{settings.birthdayDiscountPct}%</span>
            <span className={styles.discountAmt}>{subtotal > 0 ? fmt(subtotal * settings.birthdayDiscountPct / 100) : ''}</span>
          </label>

          <div className={styles.discountRow}>
            <input type="checkbox" checked={manualDiscount > 0}
              onChange={e => { if (!e.target.checked) { setManualValor(0); setManualPct(0) } }} />
            <span>Manual</span>

            {/* Alternador R$ / %. Trocar o modo NÃO converte o valor: são dois
                campos independentes, e converter na troca faria "30" virar
                "R$ 30,00" sem aviso. */}
            <div className={styles.manualModo}>
              <button type="button"
                className={manualModo === 'valor' ? styles.manualModoAtivo : ''}
                onClick={() => setManualModo('valor')}>R$</button>
              <button type="button"
                className={manualModo === 'pct' ? styles.manualModoAtivo : ''}
                onClick={() => setManualModo('pct')}>%</button>
            </div>

            {manualModo === 'valor' ? (
              <input
                type="number" min="0" step="0.01"
                className={styles.manualDiscInput}
                value={manualValor || ''}
                onChange={e => setManualValor(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0,00"
              />
            ) : (
              <input
                type="number" min="0" max="100" step="1"
                className={styles.manualDiscInput}
                value={manualPct || ''}
                /* Trava em 100: desconto maior que o subtotal viraria venda
                   com total negativo. */
                onChange={e => setManualPct(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                placeholder="0"
              />
            )}

            {/* Em modo %, mostra quanto dá em reais — é o número que a cliente
                vê na maquininha. */}
            {manualModo === 'pct' && manualDiscount > 0 && (
              <span className={styles.discountAmt}>{fmt(manualDiscount)}</span>
            )}
          </div>
        </div>

        {/*
          A CONTA INTEIRA, NUM LUGAR SÓ.
          Antes o valor da venda aparecia três vezes — "Subtotal" e "Total" aqui,
          e "Total da venda" no bloco de pagamento — enquanto a troca era abatida
          lá embaixo. A dona tinha de somar de cabeça para saber quanto cobrar:
          "aparece 182 + 152 e falta 30, fica confuso".

          Agora desce em linha reta: o que ela levou, o que abate, o que cobrar.
        */}
        <div className={styles.totalSummary}>
          {/* Só aparece quando há algo a abater — sem desconto e sem troca ele
              seria idêntico ao total logo abaixo, que é o que confundia. */}
          {(discountAmt > 0 || creditoTroca > 0) && (
            <div className={styles.summaryRow}>
              <span>Peças levadas</span>
              <span>{fmt(subtotal)}</span>
            </div>
          )}
          {discountAmt > 0 && (
            <div className={`${styles.summaryRow} ${styles.discountRow2}`}>
              <span>Desconto ({discountPct > 0 ? `${discountPct}%` : ''}{manualDiscount > 0 && discountPct > 0 ? ' + R$' : ''}{manualDiscount > 0 && discountPct === 0 ? 'R$' : ''}{manualDiscount > 0 ? fmt(manualDiscount) : ''})</span>
              <span>− {fmt(discountAmt)}</span>
            </div>
          )}
          {creditoTroca > 0 && (
            <div className={`${styles.summaryRow} ${styles.trocaRow}`}>
              <span>Peça devolvida na troca</span>
              <span>− {fmt(creditoTroca)}</span>
            </div>
          )}
          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>{creditoTroca > 0 ? 'A cobrar' : 'Total'}</span>
            <strong>{fmt(aCobrar)}</strong>
          </div>
          {/* O faturamento não some: é o que a loja vendeu, e o que vai para o
              banco e para a nota. Fica miúdo porque não é o número do balcão. */}
          {creditoTroca > 0 && (
            <div className={styles.vendaBruta}>venda de {fmt(total)}</div>
          )}
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
          </div>
        </div>

        {/* Lista de pagamentos */}
        {payments.length > 0 && (
          <div className={styles.paymentsList}>
            {payments.map((p, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className={styles.paymentRow}>
                  <SearchableSelect
                    value={p.method}
                    onChange={v => {
                      const m = v as PaymentRow['method']
                      updatePayment(i, {
                        method: m,
                        installments: 1,
                        cardBrand: (m === 'credit' || m === 'debit') ? (p.cardBrand ?? null) : null,
                      })
                    }}
                    options={[
                      { value: 'pix',    label: 'PIX' },
                      { value: 'cash',   label: 'Dinheiro' },
                      { value: 'debit',  label: 'Débito' },
                      { value: 'credit', label: 'Crédito' },
                    ]}
                    placeholder="Forma"
                    searchable={false}
                    permitirLimpar={false}
                  />

                  <input
                    type="number" min="0" step="0.01"
                    className={styles.payAmtInput}
                    value={p.amount || ''}
                    onChange={e => updatePayment(i, { amount: parseFloat(e.target.value) || 0 })}
                    placeholder="R$ 0,00"
                  />

                  {p.method === 'credit' ? (
                    <div className={styles.installmentsWrap}>
                      <SearchableSelect
                        value={String(p.installments)}
                        onChange={v => updatePayment(i, { installments: parseInt(v) || 1 })}
                        options={Array.from({ length: maxInstallments }, (_, k) => k + 1).map(n => ({
                          value: String(n), label: `${n}x`,
                        }))}
                        placeholder="1x"
                        searchable={false}
                        permitirLimpar={false}
                      />
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
                            border: `1px solid ${on ? 'var(--accent)' : 'var(--border, rgba(128,128,128,.35))'}`,
                            background: on ? 'rgba(var(--accent-rgb), .14)' : 'transparent',
                            color: on ? 'var(--accent)' : 'var(--text-muted)',
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


        {/* Resumo de pagamento */}
        {/* "Total da venda" e "Crédito da troca" saíram daqui: subiram para o
            bloco de totais, que agora é o único lugar onde a conta acontece.
            Aqui fica só o que foi recebido e o que ainda falta. */}
        <div className={styles.paymentSummary}>
          <div className={styles.summaryRow}>
            <span>A cobrar</span>
            <strong>{fmt(aCobrar)}</strong>
          </div>
          {paidTotal > 0 && (
            <div className={styles.summaryRow}>
              <span>Recebido</span>
              <span>{fmt(paidTotal)}</span>
            </div>
          )}
          {(payments.length > 0 || creditoTroca > 0) && (
            balanceDiff > 0.01 ? (
              <div className={styles.payStatusWarn}>
                <AlertTriangle size={13} /> Recebido {fmt(balanceDiff)} a mais — confira
              </div>
            ) : balanceDiff < -0.01 ? (
              <>
                <div className={styles.payStatusError}>
                  <AlertTriangle size={13} /> Falta receber {fmt(Math.abs(balanceDiff))}
                </div>
                {/*
                  Fiado é decisão de quem está no balcão, não do sistema. Sem
                  esta marca a venda não fecha — foi assim que R$345 da Bea
                  Baroudi gravaram como venda concluída e sumiram da cobrança.
                */}
                <label className={styles.fiadoRow}>
                  <input type="checkbox" checked={aceitouFiado}
                    onChange={e => setAceitouFiado(e.target.checked)} />
                  <span>A cliente fica devendo {fmt(Math.abs(balanceDiff))}</span>
                </label>
                {aceitouFiado && (
                  <label className={styles.fiadoData}>
                    <span>Prometeu pagar em</span>
                    <DatePicker value={previsaoPagamento} onChange={setPrevisaoPagamento} />
                  </label>
                )}
              </>
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
          nomeInicial={nomeNovoCliente}
          onClose={() => setShowCreateCustomer(false)}
          onCreated={handleCustomerCreated}
        />
      )}
    </div>
  )
}
