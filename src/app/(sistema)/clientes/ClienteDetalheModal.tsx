'use client'

import { useEffect, useState } from 'react'
import {
  Pencil, X, ShoppingBag, Phone, Mail, Calendar,
  MapPin, Hash, Store, TrendingUp, DollarSign, Clock,
  ChevronDown, ChevronUp, Package,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import type { CustomerWithStats } from './page'
import styles from './ClienteDetalheModal.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SaleItem {
  id:               string
  quantity:         number
  unit_price:       number
  unit_cost:        number
  subtotal:         number
  product_name:     string
  product_code:     string
  product_category: string
}

interface Sale {
  id:              string
  sale_date:       string
  total:           number
  subtotal:        number
  total_cost:      number
  discount_type:   string | null
  discount_amount: number
  discount_pct:    number | null
  payment_summary: string | null
  status:          string
  store_name:      string
  items:           SaleItem[]
}

interface CustomerData {
  totalSales:    number
  totalSpent:    number
  lastSaleDate:  string | null
  sales:         Sale[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#C9A84C', '#4CAF7D', '#5B8DEF', '#E05252', '#9B59B6', '#E0A352', '#2196F3', '#FF7043',
]

function getAvatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('pt-BR')
}

function formatBirthday(s: string): string {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function isBirthdayThisMonth(birthday: string | null): boolean {
  if (!birthday) return false
  return parseInt(birthday.split('-')[1]) === new Date().getMonth() + 1
}

function isCustomerInactive(lastSaleDate: string | null, inactiveDays: number): boolean {
  if (!lastSaleDate) return true
  return (Date.now() - new Date(lastSaleDate).getTime()) / 86400000 >= inactiveDays
}

function discountLabel(type: string): string {
  const map: Record<string, string> = {
    pix:       'Desc. Pix',
    birthday:  'Desc. Aniversário',
    promotion: 'Promoção',
    manual:    'Desc. Manual',
  }
  return map[type] ?? type
}

function statusVariant(s: string): 'success' | 'warning' | 'danger' | 'muted' {
  if (s === 'completed') return 'success'
  if (s === 'exchanged') return 'warning'
  if (s === 'cancelled') return 'danger'
  return 'muted'
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    completed: 'Concluída',
    exchanged: 'Trocada',
    cancelled: 'Cancelada',
  }
  return map[s] ?? s
}

function Skeleton({ width, height = 16 }: { width?: string; height?: number }) {
  return <div className={styles.skeleton} style={{ width: width ?? '100%', height }} />
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  customer:    CustomerWithStats
  inactiveDays: number
  onClose:     () => void
  onEdit:      (c: CustomerWithStats) => void
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function ClienteDetalheModal({ customer, inactiveDays, onClose, onEdit }: Props) {
  const [loading, setLoading]       = useState(true)
  const [data, setData]             = useState<CustomerData | null>(null)
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const supabase = createClient()

    supabase
      .from('sales')
      .select(`
        id, sale_date, total, subtotal, total_cost, discount_type, discount_amount, discount_pct,
        payment_summary, status,
        stores(name),
        sale_items(
          id, quantity, unit_price, unit_cost, subtotal,
          products(name, code, category)
        )
      `)
      .eq('customer_id', customer.id)
      .order('sale_date', { ascending: false })
      .limit(15)
      .then(({ data: raw }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sales: Sale[] = (raw ?? []).map((s: any) => ({
          id:              s.id,
          sale_date:       s.sale_date,
          total:           Number(s.total),
          subtotal:        Number(s.subtotal),
          total_cost:      Number(s.total_cost ?? 0),
          discount_type:   s.discount_type,
          discount_amount: Number(s.discount_amount ?? 0),
          discount_pct:    s.discount_pct ? Number(s.discount_pct) : null,
          payment_summary: s.payment_summary,
          status:          s.status,
          store_name:      (s.stores as { name: string } | null)?.name ?? '—',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items: (s.sale_items ?? []).map((item: any) => ({
            id:               item.id,
            quantity:         item.quantity,
            unit_price:       Number(item.unit_price),
            unit_cost:        Number(item.unit_cost ?? 0),
            subtotal:         Number(item.subtotal),
            product_name:     (item.products as { name: string; code: string; category: string } | null)?.name     ?? '—',
            product_code:     (item.products as { name: string; code: string; category: string } | null)?.code     ?? '—',
            product_category: (item.products as { name: string; code: string; category: string } | null)?.category ?? '—',
          })),
        }))

        const completedSales = sales.filter(s => s.status === 'completed')
        const totalSpent     = completedSales.reduce((acc, s) => acc + s.total, 0)

        setData({
          totalSales:   sales.length,
          totalSpent,
          lastSaleDate: sales[0]?.sale_date ?? null,
          sales,
        })
        setLoading(false)
      })
  }, [customer.id])

  const avatarColor   = getAvatarColor(customer.id)
  const initials      = getInitials(customer.name)
  const isBirthday    = isBirthdayThisMonth(customer.birthday)
  const inactive      = !loading && isCustomerInactive(data?.lastSaleDate ?? null, inactiveDays)
  const ticketMedio   = data && data.totalSales > 0 ? data.totalSpent / data.totalSales : null

  return (
    <Modal isOpen onClose={onClose} size="xl" hideHeader>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.avatar} style={{ background: avatarColor }}>
            {initials}
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.customerName}>{customer.name}</div>
            <div className={styles.headerBadges}>
              {isBirthday && <Badge variant="accent">🎂 Aniversariante</Badge>}
              {!loading && inactive && <Badge variant="muted">Inativa</Badge>}
              <Badge variant="muted">{customer.origin_store_name}</Badge>
            </div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.editBtn} onClick={() => onEdit(customer)}>
            <Pencil size={14} /> Editar
          </button>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Info chips ─────────────────────────────────────── */}
      <div className={styles.infoRow}>
        <InfoChip icon={<Phone size={12} />} value={customer.phone} />
        {customer.email && <InfoChip icon={<Mail size={12} />} value={customer.email} />}
        {customer.birthday && (
          <InfoChip
            icon={<Calendar size={12} />}
            value={`Nasc. ${formatBirthday(customer.birthday)}`}
            highlight={isBirthday}
          />
        )}
        {customer.cpf && <InfoChip icon={<Hash size={12} />} value={customer.cpf} />}
        {(customer.city || customer.state) && (
          <InfoChip
            icon={<MapPin size={12} />}
            value={[customer.city, customer.state].filter(Boolean).join(' / ')}
          />
        )}
        {customer.address && (
          <InfoChip icon={<Store size={12} />} value={customer.address} />
        )}
      </div>

      {/* ── Stats ──────────────────────────────────────────── */}
      <div className={styles.statsRow}>
        <StatCard
          icon={<ShoppingBag size={15} />}
          label="Compras"
          value={loading ? undefined : data?.totalSales}
          loading={loading}
        />
        <StatCard
          icon={<DollarSign size={15} />}
          label="Total gasto"
          value={loading ? undefined : data?.totalSpent}
          loading={loading}
          currency
        />
        <StatCard
          icon={<TrendingUp size={15} />}
          label="Ticket médio"
          value={loading ? undefined : (ticketMedio ?? undefined)}
          loading={loading}
          currency
        />
        <StatCard
          icon={<Clock size={15} />}
          label="Última compra"
          raw={loading ? undefined : (data?.lastSaleDate ? formatDate(data.lastSaleDate) : '—')}
          loading={loading}
        />
      </div>

      {/* ── Observações ────────────────────────────────────── */}
      {customer.notes && (
        <div className={styles.notes}>
          <span className={styles.notesLabel}>Obs:</span> {customer.notes}
        </div>
      )}

      {/* ── Compras recentes ───────────────────────────────── */}
      <div className={styles.salesSection}>
        <div className={styles.sectionTitle}>
          Compras recentes
          {!loading && data && data.totalSales > 0 && (
            <span className={styles.sectionCount}>{data.totalSales} compra{data.totalSales !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loading ? (
          <div className={styles.skeletonList}>
            {[1, 2, 3].map(i => <Skeleton key={i} height={90} />)}
          </div>
        ) : !data?.sales.length ? (
          <div className={styles.emptyState}>
            <ShoppingBag size={28} />
            <span>Nenhuma compra registrada</span>
            <span className={styles.emptyHint}>
              As compras aparecem aqui após serem registradas no módulo de Vendas.
            </span>
          </div>
        ) : (
          <div className={styles.salesList}>
            {data.sales.map(sale => {
              const isExpanded = expandedSaleId === sale.id
              const profit     = sale.total - sale.total_cost
              const margin     = sale.total > 0 ? (profit / sale.total) * 100 : 0

              return (
                <div key={sale.id} className={`${styles.saleCard} ${isExpanded ? styles.saleCardExpanded : ''}`}>
                  {/* ── Cabeçalho do card (sempre visível, clicável) ── */}
                  <div
                    className={styles.saleHeader}
                    onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
                    role="button"
                    title={isExpanded ? 'Fechar detalhes' : 'Ver detalhes da compra'}
                  >
                    <div className={styles.saleLeft}>
                      <span className={styles.saleDate}>{formatDate(sale.sale_date)}</span>
                      <span className={styles.saleStore}>{sale.store_name}</span>
                      {sale.discount_type && sale.discount_amount > 0 && (
                        <span className={styles.saleDiscount}>
                          {discountLabel(sale.discount_type)} − {formatCurrency(sale.discount_amount)}
                        </span>
                      )}
                    </div>
                    <div className={styles.saleRight}>
                      <span className={styles.saleTotal}>{formatCurrency(sale.total)}</span>
                      <Badge variant={statusVariant(sale.status)}>{statusLabel(sale.status)}</Badge>
                      {isExpanded
                        ? <ChevronUp size={14} className={styles.saleChevron} />
                        : <ChevronDown size={14} className={styles.saleChevron} />}
                    </div>
                  </div>

                  {/* ── Resumo compacto (visível quando fechado) ── */}
                  {!isExpanded && (
                    <div className={styles.saleSummaryRow}>
                      {sale.payment_summary && (
                        <span className={styles.salePayment}>{sale.payment_summary}</span>
                      )}
                      {sale.items.length > 0 && (
                        <span className={styles.saleItemsPreview}>
                          <Package size={11} />
                          {sale.items.map(i => i.product_name).join(', ')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* ── Painel expandido ── */}
                  {isExpanded && (
                    <div className={styles.saleDetail}>
                      {/* Itens */}
                      {sale.items.length > 0 && (
                        <div className={styles.saleDetailSection}>
                          <div className={styles.saleDetailTitle}>Itens</div>
                          <table className={styles.saleDetailTable}>
                            <thead>
                              <tr>
                                <th>Código</th>
                                <th>Produto</th>
                                <th className={styles.numCol}>Qtd</th>
                                <th className={styles.numCol}>Custo unit.</th>
                                <th className={styles.numCol}>Preço unit.</th>
                                <th className={styles.numCol}>Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sale.items.map(item => (
                                <tr key={item.id}>
                                  <td className={styles.codeCell}>{item.product_code}</td>
                                  <td>{item.product_name}</td>
                                  <td className={styles.numCol}>{item.quantity}</td>
                                  <td className={styles.numCol}>{formatCurrency(item.unit_cost)}</td>
                                  <td className={styles.numCol}>{formatCurrency(item.unit_price)}</td>
                                  <td className={`${styles.numCol} ${styles.subtotalCell}`}>{formatCurrency(item.subtotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Financeiro + Pagamento */}
                      <div className={styles.saleDetailSection}>
                        <div className={styles.saleDetailTitle}>Resumo financeiro</div>
                        <div className={styles.finGrid}>
                          {sale.payment_summary && (
                            <FinRow label="Forma de pagamento" value={sale.payment_summary} />
                          )}
                          <FinRow label="Subtotal (sem desconto)" value={formatCurrency(sale.subtotal)} />
                          {sale.discount_amount > 0 && (
                            <FinRow
                              label={`${discountLabel(sale.discount_type!)} (${sale.discount_pct?.toFixed(0)}%)`}
                              value={`− ${formatCurrency(sale.discount_amount)}`}
                              color="var(--success)"
                            />
                          )}
                          <FinRow label="Total cobrado" value={formatCurrency(sale.total)} bold />
                          <FinRow label="Custo total" value={formatCurrency(sale.total_cost)} color="var(--text-muted)" />
                          <FinRow
                            label="Lucro bruto"
                            value={formatCurrency(profit)}
                            color="var(--success)"
                            bold
                          />
                          <FinRow
                            label="Margem"
                            value={`${margin.toFixed(1)}%`}
                            color={margin >= 30 ? 'var(--success)' : margin >= 10 ? 'var(--warning)' : 'var(--danger)'}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoChip({ icon, value, highlight }: {
  icon: React.ReactNode; value: string; highlight?: boolean
}) {
  return (
    <div className={`${styles.infoChip} ${highlight ? styles.infoChipHighlight : ''}`}>
      {icon}
      <span>{value}</span>
    </div>
  )
}

function FinRow({ label, value, bold, color }: {
  label: string; value: string; bold?: boolean; color?: string
}) {
  return (
    <div className={styles.finRow}>
      <span className={styles.finLabel}>{label}</span>
      <span className={styles.finValue} style={{ fontWeight: bold ? 700 : 500, color: color ?? 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}

function StatCard({ icon, label, value, raw, loading, currency }: {
  icon:      React.ReactNode
  label:     string
  value?:    number
  raw?:      string
  loading:   boolean
  currency?: boolean
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statIcon}>{icon}</div>
      <div className={styles.statValue}>
        {loading
          ? <Skeleton width="60px" height={22} />
          : raw !== undefined
            ? raw
            : value !== undefined
              ? currency ? formatCurrency(value) : String(value)
              : '—'}
      </div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  )
}
