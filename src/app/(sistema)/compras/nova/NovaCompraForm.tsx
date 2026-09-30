'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, AlertTriangle, Upload, ChevronDown, RotateCcw, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import EtiquetasPrinter, { type EtiquetasPrinterItem } from '@/components/etiquetas/EtiquetasPrinter'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'
import { salvarCompra, getItensCompraParaEtiquetas } from '../actions'
import { novoIdDeRequisicao } from '@/lib/idempotencia'
import type { GridRow, PaymentRow } from '../actions'
import { validatePaymentGroups } from '@/lib/compras/validate-payments'
import { generateCode as buildCode } from '@/lib/productCode'
import QuickCreateCatalogModal, { type QuickCreateType } from './QuickCreateCatalogModal'
import ConfirmDeleteCatalogModal from './ConfirmDeleteCatalogModal'
import { excluirFornecedorRapido, excluirCategoriaRapida, excluirMaterialRapido } from '../catalog-actions'
import styles from './NovaCompraForm.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'
import { posicionarDropdown, type PosicaoDropdown } from '@/lib/dropdown'
import { normalizarNomeFornecedor } from '@/lib/nomeFornecedor'
import { mensagemConsignacaoMisturada } from '@/lib/compras/consignacao'

// ─── Tipos de props ────────────────────────────────────────────────────────────

interface SupplierOption { id: string; name: string; initials: string }
interface StoreOption    { id: string; name: string; city: string }
interface ProductOption  {
  id: string; name: string; code: string; category: string; material: string
  cost_price: number; sale_price: number; promotional_price: number | null
  supplier_id: string; store_id: string; ownership_type: string
}

interface Props {
  suppliers:        SupplierOption[]
  stores:           StoreOption[]
  products:         ProductOption[]
  categories:       string[]
  materials:        string[]
  defaultMarkupPct: number
  /** Dono do rascunho local — ver `chaveDoRascunho`. */
  userId:           string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(initials: string, month: number, costPrice: number): string {
  if (!initials || !month || !costPrice) return ''
  return buildCode(initials, month, costPrice)
}

/** Chave de comparação de fornecedor — a mesma no servidor e na tela. */
const chaveFornecedor = normalizarNomeFornecedor

function suggestInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2)
}

/* Dinheiro: um formatador só para o sistema — ver src/lib/dinheiro.ts */
const fmt = formatarDinheiro

// Impede que o scroll do mouse altere o valor de um input numérico focado
function blurOnWheel(e: React.WheelEvent<HTMLInputElement>) {
  e.currentTarget.blur()
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Linha de pagamento em branco ─────────────────────────────────────────────

/**
 * Situação nasce vazia (`''`), de propósito: antes nascia como 'completed' e
 * uma linha nunca preenchida ia para o banco como R$ 0,00 já pago, deixando a
 * despesa da compra fora do ledger. Agora salvar exige valor e situação.
 */
/**
 * Métodos que aceitam parcela.
 *
 * Cheque entrou em 03/09 a pedido da dona: ela compra em São Paulo e paga em
 * cheques pré-datados, um por mês. Pix, dinheiro, transferência e débito saem
 * de uma vez por natureza — parcelar ali seria oferecer o que não existe.
 */
const PARCELAVEL = new Set<PaymentRow['method']>(['credit', 'check'])

/** Algum pagamento do grupo já tem valor ou situação digitados? */
function pagamentosPreenchidos(ps: PaymentRow[] | undefined): boolean {
  return !!ps?.some(p => (p.totalAmount || 0) > 0 || p.status !== '')
}

function emptyPayment(): PaymentRow {
  return {
    method: 'pix',
    totalAmount: 0,
    installments: 1,
    firstDueDate: today(),
    status: '',
  }
}

// ─── Tipo local que permite quantity vazio durante digitação ──────────────────

type FormRow = Omit<GridRow, 'quantity'> & { quantity: number | '' }

// ─── Row inicial ───────────────────────────────────────────────────────────────

function emptyRow(defaultStoreId: string): FormRow {
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

// ─── Rascunho automático (localStorage) ─────────────────────────────────────────

/*
 * O RASCUNHO É POR USUÁRIO.
 *
 * A chave era uma só por navegador: no notebook da loja, quem abrisse "Nova
 * Compra" herdava o rascunho de outra pessoa — e, ao salvar ou descartar,
 * apagava o dela. Agora a chave leva o id de quem está logado.
 *
 * A chave ANTIGA continua sendo LIDA como reserva, e isso não é opcional:
 * existe um rascunho de consignação de 47 linhas, não salvo, gravado nela no
 * notebook da dona. Se a chave nova estiver vazia, o rascunho antigo é
 * carregado e passa a ser gravado na chave nova; a antiga só é apagada quando
 * ESSE rascunho for salvo como compra ou descartado de propósito.
 */
const DRAFT_KEY_ANTIGA = 'fv:nova-compra:draft:v1'

function chaveDoRascunho(userId: string): string {
  return userId ? `${DRAFT_KEY_ANTIGA}:${userId}` : DRAFT_KEY_ANTIGA
}

interface CompraDraft {
  v: 1
  savedAt: number
  purchaseDate: string
  notes: string
  isConsignment: boolean
  returnDeadline: string
  minPurchasePct: string
  rows: FormRow[]
  supplierPayments: Record<string, PaymentRow[]>
  supplierNFs: Record<string, { nfNumber: string; nfUrl: string; uploading: boolean }>
  /** Opcional: rascunhos gravados antes de 30/09 não têm o campo. */
  supplierDescontos?: Record<string, number>
  /**
   * O id desta compra para o servidor reconhecer um reenvio — ver
   * `clientRequestId` em compras/actions.ts. Opcional: rascunhos anteriores
   * (inclusive o de 47 linhas na chave antiga) não têm, e ganham um novo.
   */
  clientRequestId?: string
  /**
   * Este rascunho nasceu da chave ANTIGA. Sem a marca, bastava um F5 depois de
   * recuperá-lo (aí ele já vem da chave do usuário) para a tela esquecer a
   * origem — e salvar a compra deixava o rascunho antigo para trás, oferecendo
   * de novo uma compra que já existe.
   */
  daChaveAntiga?: boolean
}

function rowHasContent(r: FormRow): boolean {
  return !!(
    r.productName.trim() || r.supplierName.trim() ||
    r.category.trim() || r.material.trim() || (r.costPrice && r.costPrice > 0)
  )
}

function draftIsMeaningful(d: { rows: FormRow[]; notes: string }): boolean {
  return d.notes.trim().length > 0 || d.rows.some(rowHasContent)
}

// ─── Keyboard nav helper ───────────────────────────────────────────────────────

const LAST_COL = 8

function focusGridCell(row: number, col: number) {
  document.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)?.focus()
}

// ─── Hook: posição do dropdown fixo ───────────────────────────────────────────

function useFixedDropdown<T extends HTMLElement = HTMLInputElement>() {
  const inputRef = useRef<T>(null)
  const [pos, setPos] = useState<PosicaoDropdown | null>(null)

  /* Abre para cima quando não cabe embaixo e limita a altura ao espaço da
   * janela — antes era sempre para baixo, e no pé da tela a lista era cortada. */
  function openAt() {
    if (!inputRef.current) return
    setPos(posicionarDropdown(inputRef.current.getBoundingClientRect()))
  }

  function close() { setPos(null) }

  return { inputRef, pos, openAt, close }
}

// ─── Combobox genérico (categoria, material) ───────────────────────────────────

function Combobox({ value, onChange, options, placeholder, className, rowIndex, colIndex, onCellKeyDown, onCreate, onDelete }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
  className?: string
  rowIndex?: number
  colIndex?: number
  onCellKeyDown?: (e: React.KeyboardEvent) => void
  onCreate?: (value: string) => void
  onDelete?: (value: string) => void
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const [highlighted, setHighlighted] = useState(-1)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase())).slice(0, 50)
  const trimmed   = value.trim()
  const hasExact  = options.some(o => o.toLowerCase() === trimmed.toLowerCase())
  const showCreate = !!onCreate && trimmed.length > 0 && !hasExact
  const createIndex = filtered.length
  const totalItems  = filtered.length + (showCreate ? 1 : 0)

  useEffect(() => { setHighlighted(-1) }, [pos])

  function triggerCreate() {
    onCreate?.(trimmed)
    close()
    setHighlighted(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Navegação no dropdown com setas
    if (pos && totalItems > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted(h => Math.min(h + 1, totalItems - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted(h => Math.max(h - 1, -1))
        return
      }
      if (e.key === 'Enter' && highlighted >= 0) {
        e.preventDefault()
        if (showCreate && highlighted === createIndex) { triggerCreate(); return }
        onChange(filtered[highlighted])
        close()
        setHighlighted(-1)
        if (rowIndex !== undefined && colIndex !== undefined) {
          setTimeout(() => focusGridCell(rowIndex, colIndex + 1), 0)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        setHighlighted(-1)
        return
      }
    }
    // Navegação entre células (setas apenas na borda do texto)
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Enter') && onCellKeyDown) {
      onCellKeyDown(e)
    }
  }

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        className={`${styles.cell} ${className ?? ''}`}
        value={value}
        onChange={e => { onChange(e.target.value); openAt(); setHighlighted(-1) }}
        onFocus={openAt}
        onBlur={() => setTimeout(close, 150)}
        placeholder={placeholder}
        autoComplete="off"
        data-row={rowIndex}
        data-col={colIndex}
        onKeyDown={handleKeyDown}
      />
      {pos && totalItems > 0 && (
        <div className={styles.comboDropdown} style={{
          position: 'fixed', left: pos.left, width: Math.max(pos.width, 160), zIndex: 9999,
          ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
          maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
        }}>
          {filtered.map((o, idx) => (
            <div
              key={o}
              className={`${styles.comboOption} ${idx === highlighted ? styles.comboOptionActive : ''}`}
              onMouseDown={() => { onChange(o); close() }}
            >
              <span className={styles.comboOptionLabel}>{o}</span>
              {onDelete && (
                <button
                  type="button"
                  className={styles.comboDeleteBtn}
                  title="Excluir"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onDelete(o) }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          {showCreate && (
            <div
              className={`${styles.comboCreate} ${highlighted === createIndex ? styles.comboCreateActive : ''}`}
              onMouseDown={e => { e.preventDefault(); triggerCreate() }}
            >
              <Plus size={12} /> Registrar “{trimmed}”
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── SupplierCombobox ──────────────────────────────────────────────────────────

function SupplierCombobox({ value, onChange, suppliers, placeholder, rowIndex, colIndex, onCellKeyDown, onCreate, onDelete }: {
  value: string
  onChange: (name: string, supplier: SupplierOption | null) => void
  suppliers: SupplierOption[]
  placeholder: string
  rowIndex?: number
  colIndex?: number
  onCellKeyDown?: (e: React.KeyboardEvent) => void
  onCreate?: (value: string) => void
  onDelete?: (supplier: SupplierOption) => void
}) {
  const { inputRef, pos, openAt, close } = useFixedDropdown()
  const [highlighted, setHighlighted] = useState(-1)
  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(value.toLowerCase())).slice(0, 8)
  const trimmed   = value.trim()
  const hasExact  = suppliers.some(s => s.name.toLowerCase() === trimmed.toLowerCase())
  const showCreate = !!onCreate && trimmed.length > 0 && !hasExact
  const createIndex = filtered.length
  const totalItems  = filtered.length + (showCreate ? 1 : 0)

  useEffect(() => { setHighlighted(-1) }, [pos])

  function triggerCreate() {
    onCreate?.(trimmed)
    close()
    setHighlighted(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (pos && totalItems > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted(h => Math.min(h + 1, totalItems - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted(h => Math.max(h - 1, -1))
        return
      }
      if (e.key === 'Enter' && highlighted >= 0) {
        e.preventDefault()
        if (showCreate && highlighted === createIndex) { triggerCreate(); return }
        const s = filtered[highlighted]
        onChange(s.name, s)
        close()
        setHighlighted(-1)
        if (rowIndex !== undefined && colIndex !== undefined) {
          setTimeout(() => focusGridCell(rowIndex, colIndex + 1), 0)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        setHighlighted(-1)
        return
      }
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Enter') && onCellKeyDown) {
      onCellKeyDown(e)
    }
  }

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        className={styles.cell}
        value={value}
        onChange={e => { onChange(e.target.value, null); openAt(); setHighlighted(-1) }}
        onFocus={openAt}
        onBlur={() => setTimeout(close, 150)}
        placeholder={placeholder}
        autoComplete="off"
        data-row={rowIndex}
        data-col={colIndex}
        onKeyDown={handleKeyDown}
      />
      {pos && totalItems > 0 && (
        <div className={styles.comboDropdown} style={{
          position: 'fixed', left: pos.left, width: Math.max(pos.width, 240), zIndex: 9999,
          ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
          maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
        }}>
          {filtered.map((s, idx) => (
            <div
              key={s.id}
              className={`${styles.comboOption} ${idx === highlighted ? styles.comboOptionActive : ''}`}
              onMouseDown={() => { onChange(s.name, s); close() }}
            >
              <span className={styles.comboOptionLabel}>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{s.initials}</span>
              </span>
              {onDelete && (
                <button
                  type="button"
                  className={styles.comboDeleteBtn}
                  title="Excluir"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onDelete(s) }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          {showCreate && (
            <div
              className={`${styles.comboCreate} ${highlighted === createIndex ? styles.comboCreateActive : ''}`}
              onMouseDown={e => { e.preventDefault(); triggerCreate() }}
            >
              <Plus size={12} /> Registrar “{trimmed}”
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── PaySelect ─────────────────────────────────────────────────────────────────

const METHOD_OPTIONS = [
  { value: 'pix',      label: 'PIX' },
  { value: 'cash',     label: 'Dinheiro' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'credit',   label: 'Crédito' },
  { value: 'check',    label: 'Cheque' },
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
        <div className={styles.comboDropdown} style={{
          position: 'fixed', left: pos.left, width: Math.max(pos.width, 130), zIndex: 9999,
          ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
          maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
        }}>
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

// ─── StoreSelect ──────────────────────────────────────────────────────────────

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
        <div className={styles.comboDropdown} style={{
          position: 'fixed', left: pos.left, width: Math.max(pos.width, 160), zIndex: 9999,
          ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
          maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
        }}>
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

export default function NovaCompraForm({ suppliers: initialSuppliers, stores, products, categories: initialCategories, materials: initialMaterials, defaultMarkupPct, userId }: Props) {
  const router = useRouter()
  const defaultStoreId = stores.find(s => s.name.toLowerCase().includes('campinas'))?.id ?? stores[0]?.id ?? ''

  // Listas de catálogo (mutáveis: cadastro inline adiciona novas opções na hora)
  const [suppliers, setSuppliers]   = useState<SupplierOption[]>(initialSuppliers)
  const [categories, setCategories] = useState<string[]>(initialCategories)
  const [materials, setMaterials]   = useState<string[]>(initialMaterials)

  // Cadastro rápido (modal) disparado por um combobox de uma linha específica
  const [quickCreate, setQuickCreate] = useState<{ type: QuickCreateType; value: string; rowIndex: number } | null>(null)

  // Exclusão (soft-delete) de item de catálogo via dropdown
  const [catalogDelete, setCatalogDelete] = useState<{ type: QuickCreateType; label: string; supplierId?: string } | null>(null)
  const [deletingCatalog, setDeletingCatalog] = useState(false)
  const [deleteCatalogError, setDeleteCatalogError] = useState<string | null>(null)

  async function confirmCatalogDelete() {
    if (!catalogDelete) return
    setDeletingCatalog(true)
    setDeleteCatalogError(null)
    const cd = catalogDelete
    const res =
      cd.type === 'supplier'  ? await excluirFornecedorRapido(cd.supplierId!) :
      cd.type === 'category'  ? await excluirCategoriaRapida(cd.label) :
                                await excluirMaterialRapido(cd.label)
    setDeletingCatalog(false)
    if (!res.success) { setDeleteCatalogError(res.error ?? 'Erro ao excluir.'); return }

    if (cd.type === 'supplier')      setSuppliers(prev => prev.filter(s => s.id !== cd.supplierId))
    else if (cd.type === 'category') setCategories(prev => prev.filter(c => c !== cd.label))
    else                             setMaterials(prev => prev.filter(m => m !== cd.label))

    setCatalogDelete(null)
  }

  // Cabeçalho
  const [purchaseDate, setPurchaseDate]     = useState(today())
  const [notes, setNotes]                   = useState('')
  const [isConsignment, setIsConsignment]   = useState(false)
  const [returnDeadline, setReturnDeadline] = useState('')
  const [minPurchasePct, setMinPurchasePct] = useState('')

  // Grid de itens
  const [rows, setRows] = useState<FormRow[]>([emptyRow(defaultStoreId)])

  // Grupos de fornecedor derivados dos itens
  const supplierGroups = useMemo(() => {
    const map = new Map<string, { groupKey: string; supplierName: string; subtotal: number }>()
    for (const row of rows) {
      /* Só as linhas que VÃO para o servidor (com nome de produto — ver
         `validRows`). Antes contava também linha sem produto, que o salvar
         descarta: o subtotal da tela e o do servidor divergiam, e a compra era
         recusada com pagamento "a mais" que a tela dizia estar certo. */
      if (!row.productName.trim()) continue
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

  /*
   * Desconto que o FORNECEDOR deu, em % sobre o subtotal daquele fornecedor.
   *
   * Pedido da dona em 03/09: "tem compras que ela ganha cinco, dez por cento".
   * É desconto comercial na negociação, aplicado depois de somar as peças —
   * então entra aqui, no fechamento, e não no custo digitado item a item.
   */
  const [supplierDescontos, setSupplierDescontos] = useState<Record<string, number>>({})

  /**
   * `null` = pagamentos completos. Se não, a mensagem do que falta — usada para
   * deixar o botão Salvar com aparência de desabilitado e no title do botão.
   * Consignação não tem pagamento no ato, então não entra na conta.
   */
  const paymentsPending = useMemo(() => {
    if (isConsignment || supplierGroups.length === 0) return null
    return validatePaymentGroups(
      supplierGroups.map(g => ({
        label: g.supplierName,
        subtotal: g.subtotal,
        payments: (supplierPayments[g.groupKey] ?? []).map(p => ({ amount: p.totalAmount, status: p.status })),
      }))
    )
  }, [isConsignment, supplierGroups, supplierPayments])

  // NF por fornecedor
  const [supplierNFs, setSupplierNFs] = useState<Record<string, { nfNumber: string; nfUrl: string; uploading: boolean }>>({})
  const nfInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  /*
   * Sincronizar pagamentos e NFs quando os grupos mudam.
   *
   * NÃO APAGA MAIS O GRUPO QUE SAIU. O `groupKey` é o id do fornecedor quando a
   * linha está ligada ao cadastro e o nome digitado quando não está — então
   * apagar uma letra do fornecedor trocava a chave, e os pagamentos já
   * digitados daquele fornecedor sumiam em silêncio. Religando (redigitar a
   * letra), a chave voltava, mas os pagamentos não.
   *
   * Agora o grupo que sai fica guardado no estado (a tela e o salvar só olham
   * os grupos ativos, então ele não aparece nem vai para o banco) e reaparece
   * intacto quando a chave volta. E se exatamente UMA chave saiu e UMA entrou
   * — o caso de só o vínculo ter mudado —, o que estava digitado migra para a
   * chave nova, desde que ela ainda esteja em branco.
   */
  const chavesAnteriores = useRef<string[] | null>(null)

  useEffect(() => {
    const atuais = supplierGroups.map(g => g.groupKey)
    const activeKeys = new Set(atuais)
    const antes = chavesAnteriores.current
    chavesAnteriores.current = atuais

    const saiu   = antes ? antes.filter(k => !activeKeys.has(k)) : []
    const entrou = antes ? atuais.filter(k => !antes.includes(k)) : []
    const migrar = saiu.length === 1 && entrou.length === 1 ? { de: saiu[0], para: entrou[0] } : null

    setSupplierPayments(prev => {
      let changed = false
      const next = { ...prev }
      if (migrar && prev[migrar.de] && !pagamentosPreenchidos(prev[migrar.para])) {
        next[migrar.para] = prev[migrar.de]; changed = true
      }
      for (const key of activeKeys) {
        // Já abre uma linha de pagamento para o fornecedor. Antes nascia vazio
        // (`[]`) e era preciso clicar em "adicionar pagamento" em cada um dos
        // ~10 fornecedores de uma mala só para o salvar liberar.
        if (!next[key]) { next[key] = [emptyPayment()]; changed = true }
      }
      return changed ? next : prev
    })

    setSupplierNFs(prev => {
      let changed = false
      const next = { ...prev }
      if (migrar && prev[migrar.de] && !prev[migrar.para]?.nfNumber && !prev[migrar.para]?.nfUrl) {
        next[migrar.para] = prev[migrar.de]; changed = true
      }
      for (const key of activeKeys) {
        if (!next[key]) { next[key] = { nfNumber: '', nfUrl: '', uploading: false }; changed = true }
      }
      return changed ? next : prev
    })

    if (migrar) {
      setSupplierDescontos(prev =>
        prev[migrar.de] && !prev[migrar.para] ? { ...prev, [migrar.para]: prev[migrar.de] } : prev
      )
    }
  }, [supplierGroups])

  // Estado
  const [saving, setSaving]           = useState(false)
  /*
   * Trava síncrona do envio. `saving` só desabilita o botão no próximo render,
   * e depois de salvar o `finally` o liberava ANTES de buscar as etiquetas —
   * uma janela em que um segundo clique criava a compra de novo. O ref muda na
   * hora e, depois de um salvamento com sucesso, NÃO volta: a compra já existe,
   * reenviar só duplicaria.
   */
  const envioTravado = useRef(false)
  /** Depois do sucesso o autosave não pode regravar o rascunho da compra já salva. */
  const compraSalva = useRef(false)
  /*
   * O id DESTA compra, o mesmo em todo reenvio.
   *
   * Se a resposta do salvamento se perde, ela clica de novo — ou recarrega e
   * recupera o rascunho — e antes a compra entrava duas vezes. Com o id no
   * rascunho, o servidor reconhece a compra que já gravou e devolve a mesma.
   * Nasce na primeira vez que é pedido; só troca quando a compra grava ou o
   * rascunho é descartado (aí é outra compra).
   */
  const idDaCompra = useRef<string | null>(null)
  function idDaCompraAtual(): string {
    if (!idDaCompra.current) idDaCompra.current = novoIdDeRequisicao()
    return idDaCompra.current
  }
  const [error, setError]             = useState('')
  const [printerOpen, setPrinterOpen] = useState(false)
  const [printerItems, setPrinterItems] = useState<EtiquetasPrinterItem[]>([])

  // ── Rascunho automático ─────────────────────────────────────────────────────
  const [draftLoaded, setDraftLoaded]       = useState(false)
  const [draftRecovered, setDraftRecovered] = useState(false)

  const draftKey = chaveDoRascunho(userId)
  /** O rascunho desta tela veio da chave antiga (sem usuário)? Ver DRAFT_KEY_ANTIGA. */
  const veioDaChaveAntiga = useRef(false)

  /*
   * A chave ANTIGA só sai quando a compra que veio DELA é SALVA
   * (`compraSalva`). Descarte, limpar a grade ou o autosave com a tela vazia
   * apagam só a chave do usuário: um clique errado em "Descartar" no notebook
   * da dona levava junto o rascunho de 47 linhas, que não existe em nenhum
   * outro lugar. Se ela descartar, ele volta ao abrir de novo — incômodo, mas
   * recuperável; o contrário não é.
   */
  function clearDraft({ compraSalva: salva = false }: { compraSalva?: boolean } = {}) {
    try {
      localStorage.removeItem(draftKey)
      if (salva && veioDaChaveAntiga.current) localStorage.removeItem(DRAFT_KEY_ANTIGA)
    } catch { /* ignore */ }
    /* Salvou, descartou ou esvaziou: o que está na tela deixou de ser a compra
     * da chave antiga — salvar OUTRA compra depois não pode apagá-la. */
    veioDaChaveAntiga.current = false
  }

  function discardDraft() {
    clearDraft()
    idDaCompra.current = null   // descartou: o que vier agora é outra compra
    setPurchaseDate(today())
    setNotes('')
    setIsConsignment(false)
    setReturnDeadline('')
    setMinPurchasePct('')
    setRows([emptyRow(defaultStoreId)])
    setSupplierPayments({})
    setSupplierNFs({})
    setSupplierDescontos({})
    setDraftRecovered(false)
  }

  // Carrega o rascunho ao montar (pós-hidratação, evita mismatch SSR)
  useEffect(() => {
    try {
      let raw = localStorage.getItem(draftKey)
      if (!raw && draftKey !== DRAFT_KEY_ANTIGA) {
        raw = localStorage.getItem(DRAFT_KEY_ANTIGA)
        if (raw) veioDaChaveAntiga.current = true
      }
      if (raw) {
        const d = JSON.parse(raw) as CompraDraft
        if (d && d.v === 1 && Array.isArray(d.rows) && draftIsMeaningful(d)) {
          setPurchaseDate(d.purchaseDate || today())
          setNotes(d.notes || '')
          setIsConsignment(!!d.isConsignment)
          setReturnDeadline(d.returnDeadline || '')
          setMinPurchasePct(d.minPurchasePct || '')
          setRows(d.rows.length ? d.rows : [emptyRow(defaultStoreId)])
          setSupplierPayments(d.supplierPayments || {})
          const nfs: Record<string, { nfNumber: string; nfUrl: string; uploading: boolean }> = {}
          for (const [k, v] of Object.entries(d.supplierNFs || {})) {
            nfs[k] = { nfNumber: v.nfNumber ?? '', nfUrl: v.nfUrl ?? '', uploading: false }
          }
          setSupplierNFs(nfs)
          setSupplierDescontos(d.supplierDescontos || {})
          /* Recuperou o rascunho: continua com o id DELE. É exatamente o caso
           * "salvou, a resposta se perdeu, ela recarregou" — com o mesmo id o
           * servidor devolve a compra que já existe em vez de criar outra. */
          if (typeof d.clientRequestId === 'string' && d.clientRequestId) idDaCompra.current = d.clientRequestId
          if (d.daChaveAntiga) veioDaChaveAntiga.current = true
          setDraftRecovered(true)
        } else if (!veioDaChaveAntiga.current) {
          // Rascunho vazio/corrompido na chave DESTE usuário: pode sair. O da
          // chave antiga não é apagado aqui — ele pode ser de outra pessoa.
          localStorage.removeItem(draftKey)
        }
      }
    } catch { /* rascunho corrompido — ignora */ }
    setDraftLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave debounced — só depois de carregar, e nunca com form vazio
  useEffect(() => {
    if (!draftLoaded) return
    if (!draftIsMeaningful({ rows, notes })) {
      clearDraft()
      /* Grade esvaziada é outra compra. Sem trocar o id, a próxima compra
       * lançada nesta tela ia com o id de uma já salva (ou abandonada), e o
       * servidor a confundia com um reenvio. */
      idDaCompra.current = null
      return
    }
    const t = setTimeout(() => {
      // Um autosave agendado logo antes do clique ressuscitaria o rascunho de
      // uma compra que já existe — e ela a salvaria de novo amanhã.
      if (compraSalva.current) return
      const draft: CompraDraft = {
        v: 1,
        savedAt: Date.now(),
        purchaseDate, notes, isConsignment, returnDeadline, minPurchasePct,
        rows, supplierPayments, supplierNFs, supplierDescontos,
        clientRequestId: idDaCompraAtual(),
        daChaveAntiga: veioDaChaveAntiga.current || undefined,
      }
      try { localStorage.setItem(draftKey, JSON.stringify(draft)) } catch { /* quota/privado — ignora */ }
    }, 600)
    return () => clearTimeout(t)
    // `clearDraft` é recriada a cada render e só depende de `draftKey`, que já
    // está na lista — incluí-la faria o autosave rodar em todo render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded, draftKey, rows, notes, purchaseDate, isConsignment, returnDeadline, minPurchasePct, supplierPayments, supplierNFs, supplierDescontos])

  const purchaseMonth = parseInt(purchaseDate.slice(5, 7)) || new Date().getMonth() + 1

  // ── Grid helpers ──────────────────────────────────────────────────────────

  function updateRow(index: number, patch: Partial<FormRow>) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r))
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow(defaultStoreId)])
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  function handleProductNameChange(index: number, name: string) {
    const wasEmpty = rows[index].productName.trim() === ''
    updateRow(index, { productId: null, productName: name, productExistingCostDiffers: false })
    // Auto-cria nova linha quando o último campo sai do vazio
    if (index === rows.length - 1 && wasEmpty && name.trim() !== '') {
      addRow()
    }
  }

  /*
   * Cada tecla no campo de fornecedor chega aqui com `supplier = null` — o
   * combobox não sabe se o texto ainda é o de um cadastro. Antes isso
   * desligava a linha do cadastro e trocava as iniciais pelas sugeridas: ao
   * corrigir uma letra de "Santa Prata", a linha virava fornecedor NOVO e o
   * salvar criava um "Santa Prata" duplicado, com código de peça diferente.
   *
   * Agora, se o texto bate (nome normalizado) com EXATAMENTE UM fornecedor
   * cadastrado, a linha continua ligada a ele e com as iniciais DELE. O texto
   * digitado fica como está no campo — trocar pelo nome do cadastro no meio da
   * digitação comeria o espaço que ela acabou de teclar.
   */
  function handleSupplierSelect(index: number, name: string, supplier: SupplierOption | null) {
    if (supplier) {
      updateRow(index, { supplierId: supplier.id, supplierName: supplier.name, supplierInitials: supplier.initials })
      return
    }

    const chave = chaveFornecedor(name)
    const iguais = chave ? suppliers.filter(s => chaveFornecedor(s.name) === chave) : []
    if (iguais.length === 1) {
      updateRow(index, { supplierId: iguais[0].id, supplierName: name, supplierInitials: iguais[0].initials })
      return
    }

    /* Fornecedor novo: sugere iniciais só se as atuais eram automáticas (vazias,
       sugeridas do nome anterior, ou do cadastro que acabou de se desligar).
       Iniciais que ela digitou à mão não são sobrescritas a cada tecla. */
    const atual = rows[index]
    const eramAutomaticas = !atual.supplierInitials.trim()
      || !!atual.supplierId
      || atual.supplierInitials === suggestInitials(atual.supplierName)
    updateRow(index, {
      supplierId: null,
      supplierName: name,
      ...(eramAutomaticas ? { supplierInitials: suggestInitials(name) } : {}),
    })
  }

  function handleCostChange(index: number, cost: number) {
    const row = rows[index]
    const originalCost = products.find(p => p.id === row.productId)?.cost_price ?? 0
    const autoSalePrice = cost > 0 ? parseFloat((cost * (1 + defaultMarkupPct / 100)).toFixed(2)) : 0
    const prevAutoPrice = row.costPrice > 0 ? parseFloat((row.costPrice * (1 + defaultMarkupPct / 100)).toFixed(2)) : 0
    const salePriceWasAuto = row.salePrice === 0 || row.salePrice === prevAutoPrice
    updateRow(index, {
      costPrice: cost,
      productExistingCostDiffers: !!row.productId && originalCost !== 0 && cost !== originalCost,
      ...(salePriceWasAuto ? { salePrice: autoSalePrice } : {}),
    })
  }

  function getCode(row: FormRow): string {
    const initials = row.supplierInitials || suppliers.find(s => s.id === row.supplierId)?.initials || ''
    return generateCode(initials, purchaseMonth, row.costPrice)
  }

  // ── Navegação por teclado no grid ─────────────────────────────────────────

  function handleGridKeyDown(e: React.KeyboardEvent, rowIndex: number, colIndex: number) {
    const input = e.target as HTMLInputElement
    // Inputs numéricos não expõem selectionStart — sempre navega na seta
    const isNumeric = input.type === 'number'
    const pos  = input.selectionStart ?? 0
    const posE = input.selectionEnd   ?? 0
    const len  = (input.value ?? '').length

    if (e.key === 'ArrowLeft') {
      // Só vai para campo anterior se o cursor está no início (posição 0, sem seleção)
      if (isNumeric || (pos === 0 && posE === 0)) {
        e.preventDefault()
        if (colIndex > 0) focusGridCell(rowIndex, colIndex - 1)
      }
    } else if (e.key === 'ArrowRight') {
      // Só vai para próximo campo se o cursor está no final
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
        if (nextRowEl) {
          nextRowEl.focus()
        } else {
          addRow()
          setTimeout(() => focusGridCell(rowIndex + 1, 0), 30)
        }
      }
    }
  }

  // ── NF upload por fornecedor ──────────────────────────────────────────────

  async function handleNFUpload(groupKey: string, file: File) {
    setSupplierNFs(prev => ({ ...prev, [groupKey]: { ...prev[groupKey], uploading: true } }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.url) {
        setSupplierNFs(prev => ({ ...prev, [groupKey]: { ...prev[groupKey], nfUrl: json.url, uploading: false } }))
      }
    } catch {
      setSupplierNFs(prev => ({ ...prev, [groupKey]: { ...prev[groupKey], uploading: false } }))
    }
  }

  // ── Pagamentos por fornecedor ─────────────────────────────────────────────

  /*
   * A nova linha já nasce com O QUE FALTA para fechar.
   *
   * A dona disse em 03/09 que o sistema "só aceita uma forma de pagamento".
   * Aceitava — o botão "Adicionar pagamento" sempre esteve aqui. O que não
   * havia era motivo para acreditar nisso: a segunda linha nascia zerada, e
   * dividir R$640 entre Pix e cheque virava conta de cabeça a cada tentativa.
   *
   * Nascendo com o restante, o caminho fica óbvio: ela põe 300 no Pix, clica
   * em adicionar, e os 340 já estão lá esperando o método.
   */
  function addPaymentForSupplier(groupKey: string) {
    const grupo    = supplierGroups.find(g => g.groupKey === groupKey)
    const desconto = supplierDescontos[groupKey] ?? 0
    const aPagar   = grupo ? parseFloat((grupo.subtotal * (1 - desconto / 100)).toFixed(2)) : 0
    const jaLancado = (supplierPayments[groupKey] ?? []).reduce((s, p) => s + (p.totalAmount || 0), 0)
    const restante = parseFloat((aPagar - jaLancado).toFixed(2))

    setSupplierPayments(prev => ({
      ...prev,
      // Negativo (ela lançou a mais) não vira valor: melhor zero do que sugerir bobagem.
      [groupKey]: [...(prev[groupKey] ?? []), { ...emptyPayment(), totalAmount: Math.max(0, restante) }]
    }))
  }

  function updatePaymentForSupplier(groupKey: string, index: number, patch: Partial<PaymentRow>) {
    setSupplierPayments(prev => ({
      ...prev,
      [groupKey]: (prev[groupKey] ?? []).map((p, i) => i === index ? { ...p, ...patch } : p)
    }))
  }

  function removePaymentForSupplier(groupKey: string, index: number) {
    setSupplierPayments(prev => ({
      ...prev,
      [groupKey]: (prev[groupKey] ?? []).filter((_, i) => i !== index)
    }))
  }

  // ── Totais ────────────────────────────────────────────────────────────────

  const validRows: GridRow[] = rows
    .filter(r => r.productName.trim())
    .map(r => ({ ...r, quantity: Number(r.quantity) || 1 }))
  const totalCost = validRows.reduce((s, r) => s + (r.costPrice || 0) * (r.quantity || 1), 0)

  // ── Validação e submit ────────────────────────────────────────────────────

  async function handleSubmit() {
    setError('')

    if (!purchaseDate) { setError('Informe a data da compra.'); return }
    if (validRows.length === 0) { setError('Adicione ao menos um item.'); return }

    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i]
      if (!r.supplierName.trim()) { setError(`Linha ${i + 1}: informe o fornecedor.`); return }
      if (!r.supplierInitials.trim()) { setError(`Linha ${i + 1}: informe as iniciais do fornecedor.`); return }
      if (!r.category.trim()) { setError(`Linha ${i + 1}: informe a categoria.`); return }
      if (!r.material.trim()) { setError(`Linha ${i + 1}: informe o material.`); return }
      if (!r.costPrice || r.costPrice <= 0) { setError(`Linha ${i + 1}: informe o preço de custo.`); return }
      if (!r.salePrice || r.salePrice <= 0) { setError(`Linha ${i + 1}: informe o preço de venda.`); return }
      if (!r.storeId) { setError(`Linha ${i + 1}: selecione a loja destino.`); return }
    }

    if (isConsignment && !returnDeadline) { setError('Informe o prazo de devolução da consignação.'); return }

    /* O lote consignado tem um fornecedor e uma loja. Misturar virava um lote
       só, no nome do primeiro fornecedor. O servidor barra também. */
    if (isConsignment) {
      const fornecedores = new Set(validRows.map(r => chaveFornecedor(r.supplierName)))
      const lojas        = new Set(validRows.map(r => r.storeId))
      if (fornecedores.size > 1 || lojas.size > 1) {
        setError(mensagemConsignacaoMisturada(validRows, id => stores.find(s => s.id === id)?.name)); return
      }
    }

    if (!isConsignment) {
      if (supplierGroups.length === 0) { setError('Adicione itens com custo antes de salvar.'); return }

      // Valor e situação de todo pagamento são obrigatórios. Mesma função usada
      // pela server action, para o formulário e o servidor não divergirem.
      const payErr = validatePaymentGroups(
        supplierGroups.map(g => ({
          label: g.supplierName,
          // Com desconto do fornecedor, o que tem de fechar é o LÍQUIDO.
          subtotal: parseFloat((g.subtotal * (1 - (supplierDescontos[g.groupKey] ?? 0) / 100)).toFixed(2)),
          payments: (supplierPayments[g.groupKey] ?? []).map(p => ({ amount: p.totalAmount, status: p.status })),
        }))
      )
      if (payErr) { setError(payErr); return }

      for (const group of supplierGroups) {
        for (const p of supplierPayments[group.groupKey] ?? []) {
          if (p.method === 'check' && !p.firstDueDate) {
            setError(`"${group.supplierName}": informe a data de compensação do cheque (bom para).`); return
          }
          /* Parcelado sem data não tem como gerar os vencimentos — e é o que
             transforma "3x" em três contas a pagar de verdade. */
          if (PARCELAVEL.has(p.method) && p.installments > 1 && !p.firstDueDate) {
            setError(`"${group.supplierName}": informe a data da 1ª parcela.`); return
          }
        }
      }
    }

    if (envioTravado.current) return
    envioTravado.current = true
    setSaving(true)

    /*
     * O try/catch existe por causa de 03/09: a dona ficou com o botão girando
     * para sempre numa compra grande. `salvarCompra` estourou o tempo, a
     * promessa quebrou, e o `setSaving(false)` logo abaixo nunca rodou — sem
     * erro na tela, sem nada. Ela esperou, tentou de novo, e o risco real ali
     * era duplicar a compra.
     *
     * O `finally` é o que importa: aconteça o que acontecer, o botão volta.
     */
    let result: Awaited<ReturnType<typeof salvarCompra>>
    try {
      result = await salvarCompra({
        purchaseDate,
        notes,
        rows: validRows,
        supplierPayments: supplierGroups.map(g => ({
          groupKey: g.groupKey,
          payments: supplierPayments[g.groupKey] ?? [],
          nfNumber: supplierNFs[g.groupKey]?.nfNumber ?? '',
          nfUrl:    supplierNFs[g.groupKey]?.nfUrl    ?? '',
          descontoPct: supplierDescontos[g.groupKey] ?? 0,
        })),
        isConsignment,
        returnDeadline,
        minPurchasePct: minPurchasePct ? parseFloat(minPurchasePct) : null,
        clientRequestId: idDaCompraAtual(),
      })
    } catch (e) {
      // Rascunho INTACTO de propósito: o `clearDraft()` só roda no sucesso, lá
      // embaixo. Falhou, ela recarrega a página e recupera tudo que digitou.
      setError(mensagemDeErroAoSalvar(e, { temRascunho: true }))
      envioTravado.current = false
      setSaving(false)
      return
    }

    if (!result.success) {
      /* O id já era de OUTRA compra (o servidor não gravou nada): troca por um
       * novo, na tela e no rascunho, para que o próximo clique — ou o F5 que a
       * mensagem pede — lance esta compra em vez de bater no mesmo erro. */
      if (result.idReusado) {
        idDaCompra.current = novoIdDeRequisicao()
        try {
          const raw = localStorage.getItem(draftKey)
          if (raw) localStorage.setItem(draftKey, JSON.stringify({ ...JSON.parse(raw), clientRequestId: idDaCompra.current }))
        } catch { /* sem rascunho legível — o id novo da tela já basta */ }
      }
      setError(result.error ?? 'Erro ao salvar.')
      envioTravado.current = false
      setSaving(false)
      return
    }

    /*
     * SALVOU: daqui em diante o botão fica travado de vez (`saving` continua
     * true e o ref não é solto). Antes o `finally` liberava o botão antes da
     * busca de etiquetas, e um clique nessa janela criava a compra de novo.
     */

    // Compra salva de verdade — descarta o rascunho local
    compraSalva.current = true
    clearDraft({ compraSalva: true })
    idDaCompra.current = null   // a próxima compra (se esta tela continuar) é outra

    // Compra criada — oferece imprimir etiquetas antes de redirecionar
    if (result.purchaseId) {
      /*
       * A busca das etiquetas pode falhar (rede, deploy). A compra JÁ ESTÁ
       * salva: o que não pode acontecer é o erro escapar, o botão voltar e ela
       * salvar de novo. Então avisa no lugar de erro da tela e segue para a
       * lista, de onde a etiqueta se reimprime pelo botão da própria compra.
       * Lista vazia também é falha: compra salva sempre tem peça.
       */
      let itens: Awaited<ReturnType<typeof getItensCompraParaEtiquetas>> = []
      try {
        itens = await getItensCompraParaEtiquetas(result.purchaseId)
      } catch {
        itens = []
      }
      if (itens.length === 0) {
        setError('A COMPRA FOI SALVA, mas não consegui abrir as etiquetas. Imprima pela lista de Compras (botão de etiqueta da compra). Indo para a lista…')
        setTimeout(() => { router.push('/compras'); router.refresh() }, 4000)
        return
      }
      setPrinterItems(itens.map(it => ({
        id: it.id,
        name: it.name,
        supplier_reference: it.supplier_reference,
        sale_price: it.sale_price,
        barcode_number: it.barcode_number,
        label_format: it.label_format,
        quantity: it.quantity,
      })))
      setPrinterOpen(true)
      return
    }

    router.push('/compras')
    router.refresh()
  }

  function handleFecharImpressao() {
    setPrinterOpen(false)
    router.push('/compras')
    router.refresh()
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.wrapper}>

      {/* ── Aviso de rascunho recuperado ─────────────────────────────── */}
      {draftRecovered && (
        <div className={styles.draftBanner}>
          <RotateCcw size={15} />
          <span>Recuperamos um rascunho desta compra que não foi salvo. Continue de onde parou.</span>
          <button type="button" className={styles.draftDiscardBtn} onClick={discardDraft}>
            <X size={13} /> Descartar e começar do zero
          </button>
        </div>
      )}

      {/* ── Cabeçalho ────────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Informações Gerais</div>

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

          {isConsignment && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Prazo devolução <span className={styles.req}>*</span></label>
                <DatePicker value={returnDeadline} onChange={setReturnDeadline} className={styles.input} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>% mínimo de compra</label>
                <input
                  type="number" min="0" max="100" step="1" onWheel={blurOnWheel}
                  className={styles.input}
                  value={minPurchasePct}
                  onChange={e => setMinPurchasePct(e.target.value)}
                  placeholder="Ex: 50"
                />
              </div>
            </>
          )}

          <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
            <label className={styles.label}>Observações</label>
            <textarea
              className={styles.textarea}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notas sobre essa compra..."
              rows={2}
            />
          </div>
        </div>
      </div>

      {/* ── Grid de itens ────────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Itens da Compra</div>
          <div className={styles.sectionStats}>
            {validRows.length} {validRows.length === 1 ? 'item' : 'itens'} · Custo total: <strong>{fmt(totalCost)}</strong>
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
                <th className={`${styles.thNum2} col-num`}>Custo R$ <span className={styles.req}>*</span></th>
                <th className={`${styles.thNum2} col-num`}>Venda R$ <span className={styles.req}>*</span></th>
                <th className={`${styles.thNum2} col-num`}>Promo R$</th>
                <th className={styles.thEtiq}>Etiq.</th>
                <th className={`${styles.thQty} col-num`}>Qtd</th>
                <th className={styles.thLoja}>Loja <span className={styles.req}>*</span></th>
                <th className={styles.thCod}>Código</th>
                <th className={`${styles.thSub} col-num`}>Subtotal</th>
                <th className={styles.thDel}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const code     = getCode(row)
                const subtotal = (row.costPrice || 0) * (row.quantity || 1)
                const originalCost = products.find(p => p.id === row.productId)?.cost_price ?? 0
                const showDupWarning = row.productId && row.costPrice > 0 && row.costPrice !== originalCost
                const nav = (col: number) => (e: React.KeyboardEvent) => handleGridKeyDown(e, i, col)

                return (
                  <tr key={i} className={styles.row}>
                    <td className={styles.tdNum}>{i + 1}</td>

                    {/* Produto — input simples, sem autocomplete */}
                    <td className={styles.tdProd}>
                      <input
                        className={styles.cell}
                        value={row.productName}
                        onChange={e => handleProductNameChange(i, e.target.value)}
                        placeholder="Nome do produto..."
                        autoComplete="off"
                        data-row={i}
                        data-col={0}
                        onKeyDown={nav(0)}
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
                        rowIndex={i}
                        colIndex={1}
                        onCellKeyDown={nav(1)}
                        onCreate={v => setQuickCreate({ type: 'supplier', value: v, rowIndex: i })}
                        onDelete={s => setCatalogDelete({ type: 'supplier', label: s.name, supplierId: s.id })}
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
                        data-row={i}
                        data-col={2}
                        onKeyDown={nav(2)}
                      />
                    </td>

                    {/* Categoria */}
                    <td className={styles.tdCat}>
                      <Combobox
                        value={row.category}
                        onChange={v => {
                          const isBrinco = v.toLowerCase().includes('brinco')
                          updateRow(i, { category: v, labelFormat: isBrinco ? 'B' : 'A' })
                        }}
                        options={categories}
                        placeholder="brinco..."
                        rowIndex={i}
                        colIndex={3}
                        onCellKeyDown={nav(3)}
                        onCreate={v => setQuickCreate({ type: 'category', value: v, rowIndex: i })}
                        onDelete={v => setCatalogDelete({ type: 'category', label: v })}
                      />
                    </td>

                    {/* Material */}
                    <td className={styles.tdMat}>
                      <Combobox
                        value={row.material}
                        onChange={v => updateRow(i, { material: v })}
                        options={materials}
                        placeholder="prata..."
                        rowIndex={i}
                        colIndex={4}
                        onCellKeyDown={nav(4)}
                        onCreate={v => setQuickCreate({ type: 'material', value: v, rowIndex: i })}
                        onDelete={v => setCatalogDelete({ type: 'material', label: v })}
                      />
                    </td>

                    {/* Custo */}
                    <td className={`${styles.tdNum2} col-num`}>
                      <input
                        type="number" min="0" step="0.01" onWheel={blurOnWheel}
                        className={styles.cell}
                        value={row.costPrice || ''}
                        onChange={e => handleCostChange(i, parseFloat(e.target.value) || 0)}
                        placeholder="0,00"
                        data-row={i}
                        data-col={5}
                        onKeyDown={nav(5)}
                      />
                    </td>

                    {/* Venda */}
                    <td className={`${styles.tdNum2} col-num`}>
                      <input
                        type="number" min="0" step="0.01" onWheel={blurOnWheel}
                        className={styles.cell}
                        value={row.salePrice || ''}
                        onChange={e => updateRow(i, { salePrice: parseFloat(e.target.value) || 0 })}
                        placeholder="0,00"
                        data-row={i}
                        data-col={6}
                        onKeyDown={nav(6)}
                      />
                    </td>

                    {/* Promo */}
                    <td className={`${styles.tdNum2} col-num`}>
                      <input
                        type="number" min="0" step="0.01" onWheel={blurOnWheel}
                        className={styles.cell}
                        value={row.promoPrice ?? ''}
                        onChange={e => updateRow(i, { promoPrice: e.target.value ? parseFloat(e.target.value) : null })}
                        placeholder="—"
                        data-row={i}
                        data-col={7}
                        onKeyDown={nav(7)}
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
                    <td className={`${styles.tdQty} col-num`}>
                      <input
                        type="number" min="1" step="1" onWheel={blurOnWheel}
                        className={styles.cell}
                        value={row.quantity}
                        onChange={e => updateRow(i, { quantity: e.target.value === '' ? '' : parseInt(e.target.value) || 1 })}
                        onFocus={e => e.target.select()}
                        data-row={i}
                        data-col={8}
                        onKeyDown={nav(8)}
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
                    <td className={`${styles.tdSub} col-num`}>
                      <span className={styles.subtotalText}>{subtotal > 0 ? fmt(subtotal) : '—'}</span>
                    </td>

                    {/* Deletar */}
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
          <Plus size={13} /> Adicionar linha
        </button>
      </div>

      {/* ── Pagamentos por fornecedor ────────────────────────────── */}
      {!isConsignment && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Pagamento</div>

          {supplierGroups.length === 0 && (
            <p className={styles.emptyPay}>Adicione itens com fornecedor e custo no grid para configurar os pagamentos.</p>
          )}

          {supplierGroups.map(group => {
            const gp  = supplierPayments[group.groupKey] ?? []
            const nf  = supplierNFs[group.groupKey] ?? { nfNumber: '', nfUrl: '', uploading: false }
            const gpTotal = gp.reduce((s, p) => s + (p.totalAmount || 0), 0)
            const descontoPct = supplierDescontos[group.groupKey] ?? 0
            const descontoVal  = parseFloat((group.subtotal * descontoPct / 100).toFixed(2))
            /* O que ela vai PAGAR — é contra isto que os pagamentos precisam
               fechar, não contra o subtotal cheio. */
            const aPagar       = parseFloat((group.subtotal - descontoVal).toFixed(2))
            const diff         = gpTotal - aPagar

            return (
              <div key={group.groupKey} className={styles.supplierPayCard}>
                <div className={styles.supplierPayHeader}>
                  <div className={styles.supplierPayInfo}>
                    <span className={styles.supplierPayName}>{group.supplierName}</span>
                    <span className={styles.supplierPaySubtotal}>Subtotal: <strong>{fmt(group.subtotal)}</strong></span>
                    {/*
                      Desconto do fornecedor. Fica junto do subtotal porque é
                      sobre ele que incide, e o resultado aparece na mesma linha
                      — ela precisa ver quanto vai pagar, não fazer a conta.
                    */}
                    <label className={styles.descontoWrap}>
                      <span>Desconto</span>
                      <input
                        type="number" min="0" max="100" step="0.01" onWheel={blurOnWheel}
                        className={styles.descontoInput}
                        value={descontoPct || ''}
                        onChange={e => {
                          const v = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0))
                          setSupplierDescontos(prev => ({ ...prev, [group.groupKey]: v }))
                        }}
                        placeholder="0"
                      />
                      <span>%</span>
                    </label>
                    {descontoPct > 0 && (
                      <span className={styles.supplierPayLiquido}>
                        − {fmt(descontoVal)} · a pagar <strong>{fmt(aPagar)}</strong>
                      </span>
                    )}
                  </div>
                  <div className={styles.supplierPayActions}>
                    <input
                      className={styles.nfInput}
                      value={nf.nfNumber}
                      onChange={e => setSupplierNFs(prev => ({
                        ...prev,
                        [group.groupKey]: { ...prev[group.groupKey], nfNumber: e.target.value }
                      }))}
                      placeholder="NF Número..."
                    />
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ display: 'none' }}
                      ref={el => { nfInputRefs.current[group.groupKey] = el }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleNFUpload(group.groupKey, file)
                      }}
                    />
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      onClick={() => nfInputRefs.current[group.groupKey]?.click()}
                      disabled={nf.uploading}
                    >
                      <Upload size={12} />
                      {nf.uploading ? 'Enviando...' : nf.nfUrl ? 'NF ✓' : 'Anexar NF'}
                    </button>
                    <button type="button" className={styles.addPayBtn} onClick={() => addPaymentForSupplier(group.groupKey)}>
                      <Plus size={13} /> Adicionar pagamento
                    </button>
                  </div>
                </div>

                {gp.length > 0 && (
                  <div className={styles.paymentsTable}>
                    <div className={styles.payHeader}>
                      <span style={{ flex: '0 0 140px' }}>Método</span>
                      <span style={{ flex: '0 0 130px' }}>Valor total</span>
                      <span style={{ flex: '0 0 80px' }}>Parcelas</span>
                      <span style={{ flex: '0 0 150px' }}>1ª Data venc.</span>
                      <span style={{ flex: '0 0 120px' }}>Status</span>
                      <span style={{ flex: 1 }}></span>
                    </div>

                    {gp.map((p, i) => (
                      <div key={i} className={styles.payRow}>
                        <div style={{ flex: '0 0 140px' }}>
                          <PaySelect
                            value={p.method}
                            onChange={v => updatePaymentForSupplier(group.groupKey, i, {
                              method: v as PaymentRow['method'],
                              // Só zera a parcela se o método novo NÃO parcela — trocar
                              // crédito por cheque mantendo 3x é troca legítima.
                              ...(PARCELAVEL.has(v as PaymentRow['method']) ? {} : { installments: 1 }),
                              // Cheque entra como "A pagar" (compensação futura) por padrão
                              ...(v === 'check' ? { status: 'pending' as const } : {}),
                            })}
                            options={METHOD_OPTIONS}
                          />
                        </div>

                        <input
                          type="number" min="0" step="0.01" onWheel={blurOnWheel}
                          className={styles.payCell}
                          style={{ flex: '0 0 130px' }}
                          value={p.totalAmount || ''}
                          onChange={e => updatePaymentForSupplier(group.groupKey, i, { totalAmount: parseFloat(e.target.value) || 0 })}
                          placeholder="R$ 0,00"
                        />

                        {/*
                          CHEQUE TAMBÉM PARCELA.
                          Ela compra em São Paulo e paga em cheques pré-datados —
                          3 cheques, 3 datas de compensação. Estava travado em
                          cartão, o que não corresponde a como a loja compra.
                        */}
                        <div style={{ flex: '0 0 80px', opacity: PARCELAVEL.has(p.method) ? 1 : 0.3 }}>
                          <PaySelect
                            value={String(p.installments)}
                            onChange={v => updatePaymentForSupplier(group.groupKey, i, { installments: parseInt(v) })}
                            options={Array.from({ length: 12 }, (_, k) => ({ value: String(k + 1), label: `${k + 1}x` }))}
                            disabled={!PARCELAVEL.has(p.method)}
                          />
                        </div>

                        <div style={{ flex: '0 0 150px' }}>
                          <DatePicker
                            value={p.firstDueDate}
                            onChange={v => updatePaymentForSupplier(group.groupKey, i, { firstDueDate: v })}
                          />
                        </div>

                        <div style={{ flex: '0 0 120px' }}>
                          <PaySelect
                            value={p.status}
                            onChange={v => updatePaymentForSupplier(group.groupKey, i, { status: v as PaymentRow['status'] })}
                            options={STATUS_OPTIONS}
                          />
                        </div>

                        {PARCELAVEL.has(p.method) && p.installments > 1 && (
                          <span className={styles.installmentHint}>
                            {p.installments}x de {fmt(p.totalAmount / p.installments)}
                            {p.method === 'check' && ' · uma por mês a partir da 1ª data'}
                          </span>
                        )}

                        <button type="button" className={styles.delBtn} onClick={() => removePaymentForSupplier(group.groupKey, i)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}

                    <div className={styles.payTotals}>
                      <span>Total informado: <strong>{fmt(gpTotal)}</strong></span>
                      {Math.abs(diff) > 0.01 && (
                        <span className={styles.diffWarning}>
                          <AlertTriangle size={13} />
                          {diff < 0
                            ? <>Falta {fmt(Math.abs(diff))} para fechar {fmt(aPagar)}</>
                            : <>{fmt(diff)} a mais que os {fmt(aPagar)} a pagar</>}
                        </span>
                      )}
                      {Math.abs(diff) <= 0.01 && gpTotal > 0 && (
                        <span className={styles.diffOk}>✓ Pagamento completo</span>
                      )}
                    </div>
                  </div>
                )}

                {gp.length === 0 && (
                  <p className={styles.emptyPay}>Nenhum pagamento adicionado.</p>
                )}
              </div>
            )
          })}
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
        <Button
          loading={saving}
          onClick={handleSubmit}
          className={paymentsPending ? styles.saveIncomplete : ''}
          title={paymentsPending ?? undefined}
        >
          {isConsignment ? 'Salvar Consignação' : 'Salvar Compra'} →
        </Button>
      </div>

      <EtiquetasPrinter
        isOpen={printerOpen}
        onClose={handleFecharImpressao}
        initialItems={printerItems}
        title="Compra salva — imprimir etiquetas dos produtos"
      />

      {quickCreate && (
        <QuickCreateCatalogModal
          type={quickCreate.type}
          initialValue={quickCreate.value}
          existingSuppliers={suppliers}
          onClose={() => setQuickCreate(null)}
          onCreatedSupplier={s => {
            setSuppliers(prev => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)))
            updateRow(quickCreate.rowIndex, { supplierId: s.id, supplierName: s.name, supplierInitials: s.initials })
          }}
          onCreatedCategory={(name, labelFormat) => {
            setCategories(prev => [...new Set([...prev, name])].sort())
            updateRow(quickCreate.rowIndex, { category: name, labelFormat })
          }}
          onCreatedMaterial={name => {
            setMaterials(prev => [...new Set([...prev, name])].sort())
            updateRow(quickCreate.rowIndex, { material: name })
          }}
        />
      )}

      {catalogDelete && (
        <ConfirmDeleteCatalogModal
          type={catalogDelete.type}
          label={catalogDelete.label}
          deleting={deletingCatalog}
          error={deleteCatalogError}
          onCancel={() => { setCatalogDelete(null); setDeleteCatalogError(null) }}
          onConfirm={confirmCatalogDelete}
        />
      )}
    </div>
  )
}
