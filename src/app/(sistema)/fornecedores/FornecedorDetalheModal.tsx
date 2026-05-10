'use client'

import { useEffect, useState } from 'react'
import {
  Pencil, X, Package, MessageCircle, AtSign,
  Mail, MapPin, Hash, Calendar, Phone, TrendingUp, DollarSign,
  ShoppingBag, AlertCircle, Trash2, AlertTriangle,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import { deletarFornecedor } from './actions'
import type { SupplierWithCount } from './page'
import styles from './FornecedorDetalheModal.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SupplierProduct {
  id: string; code: string; name: string; category: string
  store_id: string; store_name: string; sale_price: number
  quantity_in_stock: number; ownership_type: string; is_active: boolean
}

interface PurchaseRow {
  id: string; purchase_date: string; total_cost: number; total_items: number
  payment_summary: string | null; nf_number: string | null
  notes: string | null; store_name: string
}

interface PendingPayment {
  id: string; purchase_id: string; amount: number
  due_date: string | null; installment_number: number | null; payment_method: string
}

interface SupplierData {
  products:        SupplierProduct[]
  totalProducts:   number
  consignedCount:  number
  totalInvested:   number
  pendingAmount:   number
  purchases:       PurchaseRow[]
  pendingPayments: PendingPayment[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('pt-BR')
}

function formatPurchaseDate(s: string) {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function formatDueDate(s: string) {
  const [y, m, d] = s.split('-')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due   = new Date(Number(y), Number(m) - 1, Number(d))
  const diff  = Math.ceil((due.getTime() - today.getTime()) / 86400000)
  return { label: `${d}/${m}/${y}`, overdue: diff < 0, daysLeft: diff }
}

function formatPaymentMethod(m: string): string {
  const map: Record<string, string> = {
    cash: 'Dinheiro', pix: 'PIX', transfer: 'Transferência', credit: 'Crédito',
  }
  return map[m] ?? m
}

const AVATAR_COLORS = [
  '#C9A84C', '#4CAF7D', '#5B8DEF', '#E05252', '#9B59B6', '#E0A352', '#2196F3', '#FF7043',
]

function getAvatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ width, height = 16 }: { width?: string; height?: number }) {
  return <div className={styles.skeleton} style={{ width: width ?? '100%', height }} />
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props {
  supplier:   SupplierWithCount
  onClose:    () => void
  onEdit:     (s: SupplierWithCount) => void
  onDeleted?: () => void
}

export default function FornecedorDetalheModal({ supplier, onClose, onEdit, onDeleted }: Props) {
  const [activeTab, setActiveTab]       = useState<'geral' | 'produtos' | 'financeiro'>('geral')
  const [loading, setLoading]           = useState(true)
  const [data, setData]                 = useState<SupplierData | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [deleteError, setDeleteError]   = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    const r = await deletarFornecedor(supplier.id)
    setDeleting(false)
    if (r.success) { onDeleted?.(); onClose() }
    else { setDeleteError(r.error ?? 'Erro ao excluir.'); setConfirmDelete(false) }
  }

  useEffect(() => {
    setLoading(true)
    setData(null)
    const supabase = createClient()

    Promise.all([
      supabase
        .from('products')
        .select('id, code, name, category, store_id, sale_price, quantity_in_stock, ownership_type, is_active, stores(name)')
        .eq('supplier_id', supplier.id).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('products').select('id', { count: 'exact', head: true })
        .eq('supplier_id', supplier.id).eq('is_active', true),
      supabase.from('products').select('id', { count: 'exact', head: true })
        .eq('supplier_id', supplier.id).eq('is_active', true).eq('ownership_type', 'consignment'),
      supabase
        .from('purchases')
        .select('id, purchase_date, total_cost, total_items, payment_summary, nf_number, notes, stores(name)')
        .eq('supplier_id', supplier.id)
        .order('purchase_date', { ascending: false }),
    ]).then(async ([productsRes, totalRes, consignedRes, purchasesRes]) => {
      const products = (productsRes.data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string, code: p.code as string, name: p.name as string,
        category: p.category as string, store_id: p.store_id as string,
        store_name: (p.stores as { name: string } | null)?.name ?? '—',
        sale_price: Number(p.sale_price), quantity_in_stock: Number(p.quantity_in_stock),
        ownership_type: p.ownership_type as string, is_active: p.is_active as boolean,
      }))

      const purchases: PurchaseRow[] = (purchasesRes.data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string, purchase_date: p.purchase_date as string,
        total_cost: Number(p.total_cost), total_items: Number(p.total_items),
        payment_summary: p.payment_summary as string | null,
        nf_number: p.nf_number as string | null, notes: p.notes as string | null,
        store_name: (p.stores as { name: string } | null)?.name ?? '—',
      }))

      const purchaseIds = purchases.map(p => p.id)
      let pendingPayments: PendingPayment[] = []

      if (purchaseIds.length > 0) {
        const ppRes = await supabase
          .from('purchase_payments')
          .select('id, purchase_id, amount, due_date, installment_number, payment_method')
          .eq('status', 'pending').in('purchase_id', purchaseIds)
          .order('due_date', { ascending: true })
        pendingPayments = (ppRes.data ?? []).map((pp: Record<string, unknown>) => ({
          id: pp.id as string, purchase_id: pp.purchase_id as string,
          amount: Number(pp.amount), due_date: pp.due_date as string | null,
          installment_number: pp.installment_number as number | null,
          payment_method: pp.payment_method as string,
        }))
      }

      setData({
        products,
        totalProducts:  totalRes.count ?? 0,
        consignedCount: consignedRes.count ?? 0,
        totalInvested:  purchases.reduce((s, p) => s + p.total_cost, 0),
        pendingAmount:  pendingPayments.reduce((s, p) => s + p.amount, 0),
        purchases,
        pendingPayments,
      })
      setLoading(false)
    })
  }, [supplier.id])

  const avatarColor = getAvatarColor(supplier.id)

  return (
    <Modal isOpen onClose={onClose} size="xl2" hideHeader>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.avatar} style={{ background: avatarColor }}>
            {supplier.initials.toUpperCase()}
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.supplierName}>{supplier.name}</div>
            <div className={styles.supplierMeta}>
              {supplier.city && <span>{supplier.city}{supplier.state ? ` / ${supplier.state}` : ''}</span>}
              {supplier.contact_name && <span>· {supplier.contact_name}</span>}
            </div>
            <div className={styles.headerBadges}>
              {supplier.is_active
                ? <Badge variant="success">Ativo</Badge>
                : <Badge variant="muted">Inativo</Badge>}
              {supplier.accepts_consignment && <Badge variant="accent">Consigna</Badge>}
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          {(() => {
            const phones  = supplier.phones ?? []
            const waPhone = phones.length === 1 ? phones[0] : phones.find(p => p.is_whatsapp)
            if (!waPhone?.number) return null
            return (
              <a href={`https://wa.me/55${waPhone.number.replace(/\D/g,'')}`}
                target="_blank" rel="noreferrer" className={styles.socialBtn} title="WhatsApp">
                <MessageCircle size={15} />
              </a>
            )
          })()}
          {supplier.instagram && (
            <a href={`https://instagram.com/${supplier.instagram.replace('@','')}`}
              target="_blank" rel="noreferrer" className={styles.socialBtn} title="Instagram">
              <AtSign size={15} />
            </a>
          )}
          <button className={styles.editBtn} onClick={() => onEdit(supplier)}>
            <Pencil size={14} /> Editar
          </button>
          {!confirmDelete ? (
            <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)} title="Excluir fornecedor">
              <Trash2 size={14} />
            </button>
          ) : (
            <div className={styles.deleteConfirm}>
              <AlertTriangle size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <span>Produtos ficam no catálogo sem fornecedor. Confirma?</span>
              <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                {deleting ? '...' : 'Sim'}
              </button>
              <button className={styles.deleteBtnCancel} onClick={() => setConfirmDelete(false)}>Não</button>
            </div>
          )}
          {deleteError && (
            <div className={styles.deleteError}>
              <AlertTriangle size={12} /> {deleteError}
            </div>
          )}
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Abas ───────────────────────────────────────────── */}
      <div className={styles.tabs}>
        {(['geral', 'produtos', 'financeiro'] as const).map(key => (
          <button
            key={key}
            className={`${styles.tab} ${activeTab === key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {key === 'geral' ? 'Visão Geral' : key === 'produtos' ? 'Produtos' : 'Financeiro'}
            {key === 'financeiro' && !loading && (data?.pendingAmount ?? 0) > 0 && (
              <span className={styles.tabAlert}><AlertCircle size={11} /></span>
            )}
          </button>
        ))}
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className={styles.body}>

        {/* VISÃO GERAL */}
        {activeTab === 'geral' && (
          <div className={styles.tabContent}>
            <div className={styles.statsGrid}>
              <StatCard icon={<Package size={16} />} label="Peças em estoque"
                value={data?.totalProducts} loading={loading} />
              <StatCard icon={<TrendingUp size={16} />} label="Total investido"
                value={data?.totalInvested} loading={loading} currency />
              <StatCard icon={<DollarSign size={16} />} label="Parcelas pendentes"
                value={data?.pendingAmount} loading={loading} currency
                danger={(data?.pendingAmount ?? 0) > 0} />
              <StatCard icon={<Package size={16} />} label="Consignados ativos"
                value={data?.consignedCount} loading={loading} />
              <StatCard icon={<ShoppingBag size={16} />} label="Compras realizadas"
                value={data?.purchases.length} loading={loading}
                sub={data?.purchases[0] ? `Última: ${formatPurchaseDate(data.purchases[0].purchase_date)}` : undefined} />
            </div>

            <div className={styles.sectionTitle}>Informações</div>
            <div className={styles.infoGrid}>
              {supplier.contact_name && (
                <InfoItem icon={<Phone size={13} />} value={supplier.contact_name} label="Responsável" />
              )}
              {(supplier.phones ?? []).map((p, i) => (
                <InfoItem key={i} icon={<MessageCircle size={13} />}
                  value={`${p.number}${(supplier.phones.length === 1 || p.is_whatsapp) ? ' (WhatsApp)' : ''}`}
                  label={`Telefone ${supplier.phones.length > 1 ? i + 1 : ''}`} />
              ))}
              {supplier.email && <InfoItem icon={<Mail size={13} />} value={supplier.email} label="E-mail" />}
              {supplier.cnpj  && <InfoItem icon={<Hash size={13} />} value={supplier.cnpj} label="CNPJ" />}
              {(supplier.address || supplier.city) && (
                <InfoItem icon={<MapPin size={13} />}
                  value={[supplier.address, supplier.neighborhood, supplier.city, supplier.state].filter(Boolean).join(', ')}
                  label="Endereço" />
              )}
              <InfoItem icon={<Calendar size={13} />}
                value={`Cadastrado em ${formatDate(supplier.created_at)}`} label="Desde" />
              {supplier.notes && (
                <InfoItem icon={<Hash size={13} />} value={supplier.notes} label="Observações" />
              )}
            </div>
          </div>
        )}

        {/* PRODUTOS */}
        {activeTab === 'produtos' && (
          <div className={styles.tabContent}>
            {loading ? (
              <div className={styles.skeletonList}>
                <Skeleton height={32} width="50%" />
                {[1,2,3,4].map(i => <Skeleton key={i} height={40} />)}
              </div>
            ) : (
              <>
                <div className={styles.summaryBar}>
                  <strong>{data?.totalProducts ?? 0}</strong> peças em estoque
                  {(data?.consignedCount ?? 0) > 0 && (
                    <> · <Badge variant="accent">{data!.consignedCount} consignada{data!.consignedCount > 1 ? 's' : ''}</Badge></>
                  )}
                </div>
                {!data?.products.length ? (
                  <EmptyState message="Nenhum produto ativo deste fornecedor."
                    hint="Os produtos aparecem aqui após o cadastro no módulo Produtos." />
                ) : (
                  <table className={styles.miniTable}>
                    <thead>
                      <tr>
                        <th>Código</th><th>Nome</th><th>Categoria</th>
                        <th>Loja</th>
                        <th className={styles.rightCol}>Estoque</th>
                        <th className={styles.rightCol}>Preço</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.products.map(p => (
                        <tr key={p.id}>
                          <td className={styles.codeCell}>{p.code}</td>
                          <td>
                            {p.name}
                            {p.ownership_type === 'consignment' && (
                              <span className={styles.consigBadge}><Badge variant="accent">Consig.</Badge></span>
                            )}
                          </td>
                          <td className={styles.mutedCell}>{p.category}</td>
                          <td className={styles.mutedCell}>{p.store_name}</td>
                          <td className={`${styles.mutedCell} ${styles.rightCol}`}>{p.quantity_in_stock}</td>
                          <td className={`${styles.mutedCell} ${styles.rightCol}`}>{formatCurrency(p.sale_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}

        {/* FINANCEIRO */}
        {activeTab === 'financeiro' && (
          <div className={styles.tabContent}>
            {loading ? (
              <div className={styles.skeletonList}>
                <Skeleton height={28} width="40%" />
                {[1,2,3].map(i => <Skeleton key={i} height={40} />)}
              </div>
            ) : !data?.purchases.length ? (
              <EmptyState message="Nenhuma compra registrada com este fornecedor."
                hint="As compras aparecerão aqui após o registro no módulo Compras." />
            ) : (
              <>
                <div className={styles.summaryBar}>
                  <strong>{data.purchases.length}</strong> compra{data.purchases.length > 1 ? 's' : ''} ·
                  {' '}Total <strong>{formatCurrency(data.totalInvested)}</strong>
                  {data.pendingAmount > 0 && (
                    <> · <span className={styles.pendingChip}>{formatCurrency(data.pendingAmount)} em aberto</span></>
                  )}
                </div>

                <div className={styles.sectionTitle}>Histórico de compras</div>
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th>Data</th><th>Loja</th>
                      <th className={styles.rightCol}>Peças</th>
                      <th className={styles.rightCol}>Total</th>
                      <th>Pagamento</th><th>NF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.purchases.map(p => (
                      <tr key={p.id}>
                        <td>{formatPurchaseDate(p.purchase_date)}</td>
                        <td className={styles.mutedCell}>{p.store_name}</td>
                        <td className={`${styles.mutedCell} ${styles.rightCol}`}>{p.total_items}</td>
                        <td className={styles.rightCol} style={{ fontWeight: 600 }}>
                          {formatCurrency(p.total_cost)}
                        </td>
                        <td className={styles.mutedCell}>{p.payment_summary || '—'}</td>
                        <td className={styles.mutedCell}>{p.nf_number || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {data.pendingPayments.length > 0 && (
                  <>
                    <div className={styles.sectionTitle} style={{ color: 'var(--danger)' }}>
                      Parcelas em aberto — {formatCurrency(data.pendingAmount)}
                    </div>
                    <table className={styles.miniTable}>
                      <thead>
                        <tr>
                          <th>Vencimento</th><th>Parcela</th>
                          <th>Método</th>
                          <th className={styles.rightCol}>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pendingPayments.map(pp => {
                          const due = pp.due_date ? formatDueDate(pp.due_date) : null
                          return (
                            <tr key={pp.id}>
                              <td>
                                {due ? (
                                  <span className={due.overdue ? styles.overdueDate : ''}>
                                    {due.label}
                                    {due.overdue && <span className={styles.overdueBadge}> vencida</span>}
                                    {!due.overdue && due.daysLeft <= 7 && (
                                      <span className={styles.soonBadge}> {due.daysLeft}d</span>
                                    )}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className={styles.mutedCell}>
                                {pp.installment_number ? `Parcela ${pp.installment_number}` : 'À vista'}
                              </td>
                              <td className={styles.mutedCell}>{formatPaymentMethod(pp.payment_method)}</td>
                              <td className={styles.rightCol}
                                style={{ fontWeight: 600, color: 'var(--danger)' }}>
                                {formatCurrency(pp.amount)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value, loading, currency, danger, sub }: {
  icon: React.ReactNode; label: string; value?: number
  loading: boolean; currency?: boolean; danger?: boolean; sub?: string
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statIcon}>{icon}</div>
      <div className={styles.statValue} style={danger ? { color: 'var(--danger)' } : undefined}>
        {loading
          ? <Skeleton width="50px" height={28} />
          : value !== undefined
            ? currency ? formatCurrency(value) : value
            : <span className={styles.statEmpty}>—</span>}
      </div>
      <div className={styles.statLabel}>{label}</div>
      {!loading && sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  )
}

function InfoItem({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className={styles.infoItem}>
      <span className={styles.infoIcon}>{icon}</span>
      <div className={styles.infoContent}>
        <span className={styles.infoLabel}>{label}</span>
        <span className={styles.infoValue}>{value}</span>
      </div>
    </div>
  )
}

function EmptyState({ message, hint }: { message: string; hint: string }) {
  return (
    <div className={styles.emptyState}>
      <ShoppingBag size={32} style={{ color: 'var(--text-disabled)', marginBottom: 8 }} />
      <span>{message}</span>
      <span className={styles.emptyHint}>{hint}</span>
    </div>
  )
}
