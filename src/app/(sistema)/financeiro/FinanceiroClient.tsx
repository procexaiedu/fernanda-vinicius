'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import {
  ChevronDown, ChevronLeft, ChevronRight, Plus, Check, Pencil, Trash2, X,
  TrendingUp, TrendingDown, RefreshCw, DollarSign,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import styles from './FinanceiroClient.module.css'
import {
  buscarTransacoes, marcarComoPago, criarDespesaManual, editarDespesaManual,
  deletarDespesaManual, buscarPnl, buscarRecorrentes, criarRecorrente,
  editarRecorrente, toggleRecorrente, deletarRecorrente, gerarRecorrentesManual,
  type TransactionRow, type PnlData, type RecurrenteRow,
  type DespesaManualData, type RecurrenteData,
} from './actions'

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = s.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function monthStart(y: number, m: number) {
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function monthEnd(y: number, m: number) {
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${last}`
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro', pix: 'Pix', credit: 'Crédito', debit: 'Débito', transfer: 'Transferência',
}

const RECURRENCE_LABELS: Record<string, string> = {
  monthly: 'Mensal', weekly: 'Semanal', annual: 'Anual',
}

// ─── Dropdown genérico (position:fixed) ───────────────────────────────────────

interface DropdownOption { label: string; value: string }

function FilterDropdown({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  function toggle() {
    if (open) { setOpen(false); setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  const selected = options.find(o => o.value === value)

  return (
    <div className={styles.filterWrap}>
      <button
        type="button"
        ref={btnRef}
        className={`${styles.filterBtn} ${open ? styles.filterBtnOpen : ''} ${value ? styles.filterBtnActive : ''}`}
        onClick={toggle}
        onBlur={() => setTimeout(() => { setOpen(false); setPos(null) }, 150)}
      >
        {selected?.label ?? label}
        <ChevronDown size={12} />
      </button>
      {open && pos && (
        <div
          className={styles.filterDropdown}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          onMouseDown={e => e.preventDefault()}
        >
          {options.map(o => (
            <div
              key={o.value}
              className={`${styles.filterOption} ${o.value === value ? styles.filterOptionActive : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); setPos(null) }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Store { id: string; name: string }
interface User  { id: string; full_name: string }

interface Props {
  stores: Store[]
  users: User[]
  categories: string[]
  initialTransactions: TransactionRow[]
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FinanceiroClient({ stores, users, categories, initialTransactions }: Props) {
  const [activeTab, setActiveTab] = useState<'transactions' | 'pnl' | 'recorrentes'>('transactions')

  return (
    <div>
      <div className={styles.tabBar}>
        {([
          ['transactions', 'Transações'],
          ['pnl', 'Resumo P&L'],
          ['recorrentes', 'Recorrentes'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`${styles.tab} ${activeTab === key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'transactions' && (
        <TransacoesTab stores={stores} users={users} categories={categories} initialTransactions={initialTransactions} />
      )}
      {activeTab === 'pnl' && (
        <PnlTab stores={stores} />
      )}
      {activeTab === 'recorrentes' && (
        <RecorrentesTab stores={stores} />
      )}
    </div>
  )
}

// ─── Aba Transações ───────────────────────────────────────────────────────────

function TransacoesTab({ stores, users, categories, initialTransactions }: Props) {
  const now = new Date()
  const [transactions, setTransactions] = useState<TransactionRow[]>(initialTransactions)
  const [loading, setLoading] = useState(false)

  // Filtros
  const [fType,     setFType]     = useState('')
  const [fStatus,   setFStatus]   = useState('')
  const [fStore,    setFStore]    = useState('')
  const [fCategory, setFCategory] = useState('')
  const [fUser,     setFUser]     = useState('')
  const [fDateFrom, setFDateFrom] = useState(monthStart(now.getFullYear(), now.getMonth() + 1))
  const [fDateTo,   setFDateTo]   = useState(monthEnd(now.getFullYear(), now.getMonth() + 1))

  // Modal nova/editar despesa
  const [showModal, setShowModal]       = useState(false)
  const [editingTx, setEditingTx]       = useState<TransactionRow | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const res = await buscarTransacoes({
      type:     (fType     as any) || undefined,
      status:   (fStatus   as any) || undefined,
      storeId:  fStore     || undefined,
      category: fCategory  || undefined,
      userId:   fUser      || undefined,
      dateFrom: fDateFrom  || undefined,
      dateTo:   fDateTo    || undefined,
    })
    setTransactions(res.data)
    setLoading(false)
  }

  async function handleMarkPaid(id: string) {
    await marcarComoPago(id)
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, status: 'completed', paid_at: new Date().toISOString() } : t))
  }

  async function handleDelete(id: string) {
    await deletarDespesaManual(id)
    setTransactions(prev => prev.filter(t => t.id !== id))
    setDeleteConfirm(null)
  }

  // Stats
  const stats = useMemo(() => {
    const entradas = transactions.filter(t => t.type === 'income' && t.status === 'completed').reduce((s, t) => s + t.amount, 0)
    const saidas   = transactions.filter(t => t.type === 'expense' && t.status === 'completed').reduce((s, t) => s + t.amount, 0)
    const aPagar   = transactions.filter(t => t.type === 'expense' && t.status === 'pending').reduce((s, t) => s + t.amount, 0)
    return { entradas, saidas, saldo: entradas - saidas, aPagar }
  }, [transactions])

  const catOptions: DropdownOption[] = [
    { value: '', label: 'Categoria' },
    ...categories.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
  ]

  const storeOptions: DropdownOption[] = [
    { value: '', label: 'Todas as lojas' },
    ...stores.map(s => ({ value: s.id, label: s.name })),
  ]

  const userOptions: DropdownOption[] = [
    { value: '', label: 'Vendedor' },
    ...users.map(u => ({ value: u.id, label: u.full_name })),
  ]

  const typeOptions: DropdownOption[] = [
    { value: '', label: 'Tipo' },
    { value: 'income', label: 'Entradas' },
    { value: 'expense', label: 'Saídas' },
  ]

  const statusOptions: DropdownOption[] = [
    { value: '', label: 'Status' },
    { value: 'completed', label: 'Pago' },
    { value: 'pending', label: 'Pendente' },
  ]

  return (
    <div>
      {/* Stats */}
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Entradas</span>
          <span className={`${styles.statValue} ${styles.statIncome}`}>{fmt(stats.entradas)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Saídas</span>
          <span className={`${styles.statValue} ${styles.statExpense}`}>{fmt(stats.saidas)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Saldo</span>
          <span className={`${styles.statValue} ${stats.saldo >= 0 ? styles.statIncome : styles.statExpense}`}>
            {fmt(stats.saldo)}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>A Pagar</span>
          <span className={`${styles.statValue} ${styles.statPending}`}>{fmt(stats.aPagar)}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <FilterDropdown label="Tipo" value={fType} options={typeOptions} onChange={setFType} />
        <FilterDropdown label="Status" value={fStatus} options={statusOptions} onChange={setFStatus} />
        <FilterDropdown label="Loja" value={fStore} options={storeOptions} onChange={setFStore} />
        <FilterDropdown label="Categoria" value={fCategory} options={catOptions} onChange={setFCategory} />
        <FilterDropdown label="Vendedor" value={fUser} options={userOptions} onChange={setFUser} />

        <div className={styles.dateRangeWrap}>
          <DatePicker value={fDateFrom} onChange={setFDateFrom} />
          <span className={styles.dateSep}>→</span>
          <DatePicker value={fDateTo} onChange={setFDateTo} />
        </div>

        <button className={styles.btnSecondary} onClick={reload} disabled={loading}>
          <RefreshCw size={13} />
          {loading ? 'Carregando...' : 'Filtrar'}
        </button>

        <div className={styles.toolbarRight}>
          <button className={styles.btnPrimary} onClick={() => { setEditingTx(null); setShowModal(true) }}>
            <Plus size={14} />
            Nova Despesa
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Vencimento</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Loja</th>
              <th>Método</th>
              <th>Valor</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className={styles.empty}>Nenhuma transação encontrada.</div>
                </td>
              </tr>
            )}
            {transactions.map(tx => (
              <tr key={tx.id} className={styles.row}>
                <td className={styles.dateCell}>{fmtDate(tx.transaction_date)}</td>
                <td className={styles.dateCell}>{fmtDate(tx.due_date)}</td>
                <td>
                  <div style={{ fontWeight: 500 }}>{tx.description}</div>
                  {tx.user_name && <div className={styles.muted}>{tx.user_name}</div>}
                </td>
                <td><span className={styles.categoryBadge}>{tx.category}</span></td>
                <td className={styles.muted}>{tx.store_name ?? 'Geral'}</td>
                <td className={styles.muted}>{METHOD_LABELS[tx.payment_method ?? ''] ?? tx.payment_method ?? '—'}</td>
                <td>
                  <span className={tx.type === 'income' ? styles.amountIncome : styles.amountExpense}>
                    {tx.type === 'income' ? '+' : '−'} {fmt(tx.amount)}
                  </span>
                </td>
                <td>
                  <span className={`${styles.statusBadge} ${tx.status === 'completed' ? styles.statusCompleted : styles.statusPending}`}>
                    {tx.status === 'completed' ? 'Pago' : 'Pendente'}
                  </span>
                </td>
                <td>
                  <div className={styles.actionsCell}>
                    {tx.status === 'pending' && (
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnSuccess}`}
                        title="Marcar como pago"
                        onClick={() => handleMarkPaid(tx.id)}
                      >
                        <Check size={14} />
                      </button>
                    )}
                    {tx.reference_type === 'manual' && (
                      <>
                        <button
                          className={styles.iconBtn}
                          title="Editar"
                          onClick={() => { setEditingTx(tx); setShowModal(true) }}
                        >
                          <Pencil size={13} />
                        </button>
                        {deleteConfirm === tx.id ? (
                          <div className={styles.deleteConfirmWrap}>
                            <button className={styles.deleteBtnConfirm} onClick={() => handleDelete(tx.id)}>Sim</button>
                            <button className={styles.deleteBtnCancel} onClick={() => setDeleteConfirm(null)}>Não</button>
                          </div>
                        ) : (
                          <button
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            title="Deletar"
                            onClick={() => setDeleteConfirm(tx.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal despesa */}
      {showModal && (
        <DespesaModal
          tx={editingTx}
          stores={stores}
          categories={categories}
          onClose={() => setShowModal(false)}
          onSaved={(newTx) => {
            if (editingTx) {
              setTransactions(prev => prev.map(t => t.id === newTx.id ? newTx : t))
            } else {
              setTransactions(prev => [newTx, ...prev])
            }
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Modal Nova/Editar Despesa ────────────────────────────────────────────────

function DespesaModal({
  tx, stores, categories, onClose, onSaved,
}: {
  tx: TransactionRow | null
  stores: Store[]
  categories: string[]
  onClose: () => void
  onSaved: (t: TransactionRow) => void
}) {
  const [description, setDescription] = useState(tx?.description ?? '')
  const [amount,      setAmount]      = useState(tx ? String(tx.amount) : '')
  const [category,    setCategory]    = useState(tx?.category ?? '')
  const [catInput,    setCatInput]    = useState(tx?.category ?? '')
  const [storeId,     setStoreId]     = useState(tx?.store_id ?? '')
  const [date,        setDate]        = useState(tx?.transaction_date ?? today())
  const [dueDate,     setDueDate]     = useState(tx?.due_date ?? '')
  const [status,      setStatus]      = useState<'completed'|'pending'>(tx?.status ?? 'completed')
  const [costType,    setCostType]    = useState<'fixed'|'variable'>((tx?.cost_type as any) ?? 'variable')
  const [method,      setMethod]      = useState(tx?.payment_method ?? '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const catSuggestions = categories.filter(c => c.toLowerCase().includes(catInput.toLowerCase()) && c !== catInput)

  async function save() {
    if (!description.trim() || !amount || !catInput.trim() || !date) {
      setError('Preencha todos os campos obrigatórios.')
      return
    }
    setSaving(true)
    setError('')

    const data: DespesaManualData = {
      description: description.trim(),
      amount: parseFloat(amount.replace(',', '.')),
      category: catInput.trim().toLowerCase(),
      store_id: storeId || null,
      transaction_date: date,
      due_date: status === 'pending' ? dueDate || null : null,
      status,
      cost_type: costType,
      payment_method: method || undefined,
    }

    let result
    if (tx) {
      result = await editarDespesaManual(tx.id, data)
    } else {
      result = await criarDespesaManual(data)
    }

    if (!result.success) {
      setError(result.error ?? 'Erro ao salvar.')
      setSaving(false)
      return
    }

    // Optimistic update object
    const saved: TransactionRow = {
      id: tx?.id ?? crypto.randomUUID(),
      type: 'expense',
      amount: data.amount,
      category: data.category,
      description: data.description,
      reference_type: 'manual',
      reference_id: null,
      payment_method: data.payment_method ?? null,
      transaction_date: data.transaction_date,
      due_date: data.due_date,
      status: data.status,
      paid_at: data.status === 'completed' ? new Date().toISOString() : null,
      cost_type: data.cost_type,
      store_id: data.store_id,
      store_name: stores.find(s => s.id === data.store_id)?.name ?? null,
      user_id: null,
      user_name: null,
      recurring_expense_id: null,
    }

    onSaved(saved)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{tx ? 'Editar Despesa' : 'Nova Despesa'}</span>
          <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Descrição *</label>
            <input
              className={styles.input}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Aluguel loja, energia elétrica..."
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Valor (R$) *</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Categoria *</label>
              <div style={{ position: 'relative' }}>
                <input
                  className={styles.input}
                  value={catInput}
                  onChange={e => { setCatInput(e.target.value); setCategory(e.target.value) }}
                  placeholder="aluguel, salario..."
                  list="cat-suggestions"
                />
                <datalist id="cat-suggestions">
                  {catSuggestions.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Loja</label>
              <select
                className={styles.select}
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
              >
                <option value="">Geral (empresa)</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Método de Pagamento</label>
              <select
                className={styles.select}
                value={method}
                onChange={e => setMethod(e.target.value)}
              >
                <option value="">—</option>
                <option value="cash">Dinheiro</option>
                <option value="pix">Pix</option>
                <option value="transfer">Transferência</option>
                <option value="credit">Crédito</option>
                <option value="debit">Débito</option>
              </select>
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Data *</label>
              <DatePicker value={date} onChange={setDate} />
            </div>
            {status === 'pending' && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Vencimento</label>
                <DatePicker value={dueDate} onChange={setDueDate} />
              </div>
            )}
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Status</label>
            <div className={styles.radioGroup}>
              {(['completed', 'pending'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.radioBtn} ${status === s ? styles.radioBtnActive : ''}`}
                  onClick={() => setStatus(s)}
                >
                  {s === 'completed' ? 'Já paguei' : 'A pagar'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Tipo de Custo</label>
            <div className={styles.radioGroup}>
              {(['fixed', 'variable'] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.radioBtn} ${costType === c ? styles.radioBtnActive : ''}`}
                  onClick={() => setCostType(c)}
                >
                  {c === 'fixed' ? 'Fixo' : 'Variável'}
                </button>
              ))}
            </div>
          </div>

          {error && <p className={styles.errorMsg}>{error}</p>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
          <button className={styles.btnPrimary} onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : tx ? 'Salvar' : 'Criar Despesa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Aba P&L ──────────────────────────────────────────────────────────────────

function PnlTab({ stores }: { stores: Store[] }) {
  const now = new Date()
  const [month, setMonth]   = useState(now.getMonth() + 1)
  const [year,  setYear]    = useState(now.getFullYear())
  const [storeId, setStoreId] = useState('')
  const [data,  setData]    = useState<PnlData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded,  setLoaded]  = useState(false)

  async function load() {
    setLoading(true)
    const res = await buscarPnl(storeId || null, month, year)
    setData(res.data)
    setLoaded(true)
    setLoading(false)
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const storeOptions: DropdownOption[] = [
    { value: '', label: 'Todas as lojas' },
    ...stores.map(s => ({ value: s.id, label: s.name })),
  ]

  return (
    <div>
      {/* Filtros */}
      <div className={styles.pnlFilters}>
        <div className={styles.monthPickerWrap}>
          <button className={styles.monthNavBtn} onClick={prevMonth}><ChevronLeft size={14} /></button>
          <span className={styles.monthPickerLabel}>{MONTHS_PT[month - 1]} {year}</span>
          <button className={styles.monthNavBtn} onClick={nextMonth}><ChevronRight size={14} /></button>
        </div>
        <FilterDropdown label="Loja" value={storeId} options={storeOptions} onChange={setStoreId} />
        <button className={styles.btnPrimary} onClick={load} disabled={loading}>
          {loading ? 'Carregando...' : 'Calcular'}
        </button>
      </div>

      {!loaded && (
        <div className={styles.empty} style={{ padding: '60px 0', color: 'var(--text-muted)', textAlign: 'center', fontSize: 14 }}>
          Selecione o período e clique em Calcular.
        </div>
      )}

      {loaded && data && (
        <>
          {/* Cards resumo */}
          <div className={styles.pnlGrid}>
            <div className={styles.pnlCard}>
              <div className={styles.pnlLabel}>Receita Bruta</div>
              <div className={`${styles.pnlValue} ${styles.pnlValueGreen}`}>{fmt(data.receitaBruta)}</div>
              <div className={styles.pnlNote}>Vendas pagas no período</div>
            </div>
            <div className={styles.pnlCard}>
              <div className={styles.pnlLabel}>CMV (Custo de Vendas)</div>
              <div className={`${styles.pnlValue} ${styles.pnlValueRed}`}>{fmt(data.cmv)}</div>
              <div className={styles.pnlNote}>Custo das mercadorias vendidas</div>
            </div>
            <div className={`${styles.pnlCard} ${data.lucroBruto >= 0 ? styles.pnlCardHighlight : styles.pnlCardDanger}`}>
              <div className={styles.pnlLabel}>Lucro Bruto</div>
              <div className={`${styles.pnlValue} ${data.lucroBruto >= 0 ? styles.pnlValueGold : styles.pnlValueRed}`}>
                {fmt(data.lucroBruto)}
              </div>
              <div className={styles.pnlNote}>Receita Bruta − CMV</div>
            </div>
            <div className={`${styles.pnlCard} ${data.lucroLiquido >= 0 ? styles.pnlCardHighlight : styles.pnlCardDanger}`}>
              <div className={styles.pnlLabel}>Lucro Líquido</div>
              <div className={`${styles.pnlValue} ${data.lucroLiquido >= 0 ? styles.pnlValueGold : styles.pnlValueRed}`}>
                {fmt(data.lucroLiquido)}
              </div>
              <div className={styles.pnlNote}>Lucro Bruto − Despesas Op.</div>
            </div>
          </div>

          {/* DRE simplificado */}
          <div className={styles.pnlStatement}>
            <div className={styles.pnlLine}>
              <span>Receita Bruta</span>
              <span className={styles.pnlLineGreen}>{fmt(data.receitaBruta)}</span>
            </div>
            <div className={`${styles.pnlLine} ${styles.pnlLineNeg}`}>
              <span>(-) CMV</span>
              <span>{fmt(data.cmv)}</span>
            </div>
            <div className={`${styles.pnlLine} ${styles.pnlLineTotal}`}>
              <span>Lucro Bruto</span>
              <span className={data.lucroBruto >= 0 ? styles.pnlLineGold : styles.pnlLineNeg}>{fmt(data.lucroBruto)}</span>
            </div>
            <div className={`${styles.pnlLine} ${styles.pnlLineNeg}`}>
              <span>(-) Despesas Operacionais</span>
              <span>{fmt(data.despesasOp)}</span>
            </div>
            <div className={`${styles.pnlLine} ${styles.pnlLineTotal}`}>
              <span>Lucro Líquido</span>
              <span className={data.lucroLiquido >= 0 ? styles.pnlLineGold : styles.pnlLineNeg}>{fmt(data.lucroLiquido)}</span>
            </div>
            {data.aPagar > 0 && (
              <div className={styles.pnlLine} style={{ background: 'rgba(201,168,76,0.04)', color: 'var(--accent)' }}>
                <span>A Pagar (pendentes no período)</span>
                <span style={{ fontWeight: 700 }}>{fmt(data.aPagar)}</span>
              </div>
            )}
          </div>

          {/* Breakdown por categoria */}
          {data.breakdown.length > 0 && (
            <div>
              <div className={styles.sectionTitle}>Despesas por Categoria</div>
              <div className={styles.tableWrapper}>
                <table className={styles.breakdownTable}>
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Valor</th>
                      <th style={{ width: '200px' }}>% Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.breakdown.map(b => (
                      <tr key={b.category}>
                        <td><span className={styles.categoryBadge}>{b.category}</span></td>
                        <td style={{ color: '#E05252', fontWeight: 600 }}>{fmt(b.amount)}</td>
                        <td>
                          <div className={styles.pctBar}>
                            <div className={styles.pctBarTrack}>
                              <div className={styles.pctBarFill} style={{ width: `${Math.min(b.pct, 100)}%` }} />
                            </div>
                            <span className={styles.pctText}>{b.pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Aba Recorrentes ──────────────────────────────────────────────────────────

function RecorrentesTab({ stores }: { stores: Store[] }) {
  const [items, setItems]         = useState<RecurrenteRow[]>([])
  const [loaded, setLoaded]       = useState(false)
  const [loading, setLoading]     = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]     = useState<RecurrenteRow | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg]       = useState('')

  async function load() {
    setLoading(true)
    const res = await buscarRecorrentes()
    setItems(res.data)
    setLoaded(true)
    setLoading(false)
  }

  // Load on mount
  useState(() => { load() })

  async function handleToggle(id: string, current: boolean) {
    await toggleRecorrente(id, !current)
    setItems(prev => prev.map(r => r.id === id ? { ...r, is_active: !current } : r))
  }

  async function handleDelete(id: string) {
    await deletarRecorrente(id)
    setItems(prev => prev.filter(r => r.id !== id))
    setDeleteConfirm(null)
  }

  async function handleGenerate() {
    setGenerating(true)
    setGenMsg('')
    const res = await gerarRecorrentesManual()
    setGenMsg(res.success ? 'Gerado com sucesso!' : res.error ?? 'Erro ao gerar.')
    setGenerating(false)
    setTimeout(() => setGenMsg(''), 4000)
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <button className={styles.btnSecondary} onClick={handleGenerate} disabled={generating}>
          <RefreshCw size={13} />
          {generating ? 'Gerando...' : 'Gerar agora'}
        </button>
        {genMsg && <span style={{ fontSize: 13, color: genMsg.includes('sucesso') ? '#4CAF7D' : 'var(--danger)' }}>{genMsg}</span>}
        <div className={styles.toolbarRight}>
          <button className={styles.btnPrimary} onClick={() => { setEditing(null); setShowModal(true) }}>
            <Plus size={14} />
            Nova Recorrente
          </button>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Loja</th>
              <th>Valor</th>
              <th>Vence dia</th>
              <th>Recorrência</th>
              <th>Ativo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!loaded && (
              <tr><td colSpan={8} className={styles.muted} style={{ textAlign: 'center', padding: 20 }}>Carregando...</td></tr>
            )}
            {loaded && items.length === 0 && (
              <tr><td colSpan={8}><div className={styles.empty}>Nenhuma despesa recorrente cadastrada.</div></td></tr>
            )}
            {items.map(r => (
              <tr key={r.id} className={styles.row}>
                <td style={{ fontWeight: 500 }}>{r.description}</td>
                <td><span className={styles.categoryBadge}>{r.category}</span></td>
                <td className={styles.muted}>{r.store_name ?? 'Geral'}</td>
                <td style={{ fontWeight: 700, color: '#E05252' }}>{fmt(r.amount)}</td>
                <td className={styles.muted}>{r.day_of_month ? `Dia ${r.day_of_month}` : '—'}</td>
                <td><span className={styles.categoryBadge}>{RECURRENCE_LABELS[r.recurrence] ?? r.recurrence}</span></td>
                <td>
                  <button
                    className={`${styles.toggle} ${r.is_active ? styles.toggleActive : ''}`}
                    onClick={() => handleToggle(r.id, r.is_active)}
                    title={r.is_active ? 'Desativar' : 'Ativar'}
                  />
                </td>
                <td>
                  <div className={styles.actionsCell}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => { setEditing(r); setShowModal(true) }}
                    >
                      <Pencil size={13} />
                    </button>
                    {deleteConfirm === r.id ? (
                      <div className={styles.deleteConfirmWrap}>
                        <button className={styles.deleteBtnConfirm} onClick={() => handleDelete(r.id)}>Sim</button>
                        <button className={styles.deleteBtnCancel} onClick={() => setDeleteConfirm(null)}>Não</button>
                      </div>
                    ) : (
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => setDeleteConfirm(r.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <RecorrenteModal
          item={editing}
          stores={stores}
          onClose={() => setShowModal(false)}
          onSaved={(saved) => {
            if (editing) {
              setItems(prev => prev.map(r => r.id === saved.id ? saved : r))
            } else {
              setItems(prev => [...prev, saved])
            }
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Modal Recorrente ─────────────────────────────────────────────────────────

function RecorrenteModal({
  item, stores, onClose, onSaved,
}: {
  item: RecurrenteRow | null
  stores: Store[]
  onClose: () => void
  onSaved: (r: RecurrenteRow) => void
}) {
  const [description, setDescription] = useState(item?.description ?? '')
  const [amount,      setAmount]      = useState(item ? String(item.amount) : '')
  const [category,    setCategory]    = useState(item?.category ?? '')
  const [storeId,     setStoreId]     = useState(item?.store_id ?? '')
  const [costType,    setCostType]    = useState<'fixed'|'variable'>((item?.cost_type as any) ?? 'fixed')
  const [recurrence,  setRecurrence]  = useState<'monthly'|'weekly'|'annual'>((item?.recurrence as any) ?? 'monthly')
  const [dayOfMonth,  setDayOfMonth]  = useState(String(item?.day_of_month ?? 10))
  const [isActive,    setIsActive]    = useState(item?.is_active ?? true)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  async function save() {
    if (!description.trim() || !amount || !category.trim()) {
      setError('Preencha todos os campos obrigatórios.')
      return
    }
    setSaving(true)
    setError('')

    const data: RecurrenteData = {
      description: description.trim(),
      amount: parseFloat(amount.replace(',', '.')),
      category: category.trim().toLowerCase(),
      store_id: storeId || null,
      cost_type: costType,
      recurrence,
      day_of_month: parseInt(dayOfMonth) || 10,
      is_active: isActive,
    }

    let result
    if (item) {
      result = await editarRecorrente(item.id, data)
    } else {
      result = await criarRecorrente(data)
    }

    if (!result.success) {
      setError(result.error ?? 'Erro ao salvar.')
      setSaving(false)
      return
    }

    const saved: RecurrenteRow = {
      id: item?.id ?? crypto.randomUUID(),
      store_id: data.store_id,
      store_name: stores.find(s => s.id === data.store_id)?.name ?? null,
      description: data.description,
      amount: data.amount,
      category: data.category,
      cost_type: data.cost_type,
      recurrence: data.recurrence,
      day_of_month: data.day_of_month,
      is_active: data.is_active,
    }

    onSaved(saved)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{item ? 'Editar Recorrente' : 'Nova Despesa Recorrente'}</span>
          <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Descrição *</label>
            <input
              className={styles.input}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Aluguel Campinas, Energia elétrica..."
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Valor (R$) *</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Categoria *</label>
              <input
                className={styles.input}
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="aluguel, energia..."
              />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Loja</label>
              <select
                className={styles.select}
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
              >
                <option value="">Geral (empresa)</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Vence dia</label>
              <input
                className={styles.input}
                type="number"
                min="1"
                max="28"
                value={dayOfMonth}
                onChange={e => setDayOfMonth(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Recorrência</label>
            <div className={styles.radioGroup}>
              {(['monthly', 'weekly', 'annual'] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  className={`${styles.radioBtn} ${recurrence === r ? styles.radioBtnActive : ''}`}
                  onClick={() => setRecurrence(r)}
                >
                  {RECURRENCE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Tipo de Custo</label>
            <div className={styles.radioGroup}>
              {(['fixed', 'variable'] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.radioBtn} ${costType === c ? styles.radioBtnActive : ''}`}
                  onClick={() => setCostType(c)}
                >
                  {c === 'fixed' ? 'Fixo' : 'Variável'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Status</label>
            <div className={styles.radioGroup}>
              <button
                type="button"
                className={`${styles.radioBtn} ${isActive ? styles.radioBtnActive : ''}`}
                onClick={() => setIsActive(true)}
              >
                Ativo
              </button>
              <button
                type="button"
                className={`${styles.radioBtn} ${!isActive ? styles.radioBtnActive : ''}`}
                onClick={() => setIsActive(false)}
              >
                Inativo
              </button>
            </div>
          </div>

          {error && <p className={styles.errorMsg}>{error}</p>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
          <button className={styles.btnPrimary} onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : item ? 'Salvar' : 'Criar Recorrente'}
          </button>
        </div>
      </div>
    </div>
  )
}
