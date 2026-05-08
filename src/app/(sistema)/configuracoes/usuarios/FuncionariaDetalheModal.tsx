'use client'

import { useEffect, useState } from 'react'
import { Pencil, X, TrendingUp, TrendingDown, Users, ShoppingCart, Repeat2, ClipboardList, ArrowLeftRight } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import type { UserWithMetrics } from './page'
import styles from './FuncionariaDetalheModal.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SaleRow {
  total: number
  total_cost: number
  discount_amount: number
  sale_date: string
  status: string
  customer_id: string | null
}

interface SaleDetail {
  id: string
  sale_date: string
  total: number
  discount_amount: number
  payment_summary: string | null
  status: string
  customers: { name: string } | null
}

interface ExchangeRow {
  id: string
  exchange_date: string
  reason: string | null
  price_difference: number
}

interface CashClosingRow {
  id: string
  closing_date: string
  total_sales: number
  sales_count: number
}

interface FuncionariaData {
  allSales: SaleRow[]
  recentSales: SaleDetail[]
  exchanges: ExchangeRow[]
  cashClosings: CashClosingRow[]
  transfersCount: number
}

interface Stats {
  totalSales: number
  monthSales: number
  prevMonthSales: number
  totalRevenue: number
  monthRevenue: number
  prevMonthRevenue: number
  avgTicket: number
  uniqueCustomers: number
  monthDiscounts: number
  monthMargin: number
  cancelledCount: number
  exchangedCount: number
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  user: UserWithMetrics
  onClose: () => void
  onEdit: (user: UserWithMetrics) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString('pt-BR')
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0)
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ width, height = 16 }: { width?: string; height?: number }) {
  return <div className={styles.skeleton} style={{ width: width ?? '100%', height }} />
}

// ─── Delta Badge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return null
  const pos = delta >= 0
  return (
    <span className={`${styles.deltaBadge} ${pos ? styles.deltaPos : styles.deltaNeg}`}>
      {pos ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function FuncionariaDetalheModal({ user, onClose, onEdit }: Props) {
  const [activeTab, setActiveTab] = useState<'geral' | 'vendas' | 'atividade'>('geral')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<FuncionariaData | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    setLoading(true)
    setData(null)
    setStats(null)

    const supabase = createClient()
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    Promise.all([
      supabase.from('sales')
        .select('total, total_cost, discount_amount, sale_date, status, customer_id')
        .eq('user_id', user.id),

      supabase.from('sales')
        .select('id, sale_date, total, discount_amount, payment_summary, status, customers(name)')
        .eq('user_id', user.id)
        .order('sale_date', { ascending: false })
        .limit(10),

      supabase.from('exchanges')
        .select('id, exchange_date, reason, price_difference')
        .eq('user_id', user.id)
        .order('exchange_date', { ascending: false })
        .limit(6),

      supabase.from('cash_closings')
        .select('id, closing_date, total_sales, sales_count')
        .eq('user_id', user.id)
        .order('closing_date', { ascending: false })
        .limit(6),

      supabase.from('stock_transfers')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]).then(([allSalesRes, recentSalesRes, exchangesRes, cashRes, transfersRes]) => {
      const allSales = (allSalesRes.data ?? []) as SaleRow[]

      // Calcular stats em JS
      const isThisMonth = (d: string) => new Date(d) >= monthStart
      const isPrevMonth = (d: string) => {
        const date = new Date(d)
        return date >= prevMonthStart && date < monthStart
      }

      const activeSales = allSales.filter(s => s.status !== 'cancelled')
      const monthActiveSales = activeSales.filter(s => isThisMonth(s.sale_date))
      const prevMonthActiveSales = activeSales.filter(s => isPrevMonth(s.sale_date))

      const totalRevenue = sum(activeSales.map(s => Number(s.total)))
      const monthRevenue = sum(monthActiveSales.map(s => Number(s.total)))
      const prevMonthRevenue = sum(prevMonthActiveSales.map(s => Number(s.total)))
      const monthCost = sum(monthActiveSales.map(s => Number(s.total_cost)))

      setStats({
        totalSales: activeSales.length,
        monthSales: monthActiveSales.length,
        prevMonthSales: prevMonthActiveSales.length,
        totalRevenue,
        monthRevenue,
        prevMonthRevenue,
        avgTicket: activeSales.length > 0 ? totalRevenue / activeSales.length : 0,
        uniqueCustomers: new Set(allSales.map(s => s.customer_id).filter(Boolean)).size,
        monthDiscounts: sum(monthActiveSales.map(s => Number(s.discount_amount))),
        monthMargin: monthRevenue - monthCost,
        cancelledCount: allSales.filter(s => s.status === 'cancelled').length,
        exchangedCount: allSales.filter(s => s.status === 'exchanged').length,
      })

      setData({
        allSales,
        recentSales: (recentSalesRes.data ?? []) as unknown as SaleDetail[],
        exchanges: (exchangesRes.data ?? []) as ExchangeRow[],
        cashClosings: (cashRes.data ?? []) as CashClosingRow[],
        transfersCount: transfersRes.count ?? 0,
      })
      setLoading(false)
    })
  }, [user.id])

  const deltaRevenue = stats && stats.prevMonthRevenue > 0
    ? ((stats.monthRevenue - stats.prevMonthRevenue) / stats.prevMonthRevenue) * 100
    : null
  const deltaSales = stats && stats.prevMonthSales > 0
    ? ((stats.monthSales - stats.prevMonthSales) / stats.prevMonthSales) * 100
    : null

  const tabs = [
    { key: 'geral',      label: 'Visão Geral' },
    { key: 'vendas',     label: 'Vendas' },
    { key: 'atividade',  label: 'Atividade' },
  ] as const

  return (
    <Modal isOpen onClose={onClose} size="xl" hideHeader>
      {/* ── Cabeçalho ──────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.avatarLarge} data-role={user.role}>
            {user.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className={styles.userName}>{user.full_name}</div>
            <div className={styles.userMeta}>{user.email}</div>
          </div>
          <div className={styles.badges}>
            {user.store_name && (
              <Badge variant="accent">{user.store_name}</Badge>
            )}
            <Badge variant={user.role === 'admin' ? 'accent' : 'muted'}>
              {user.role === 'admin' ? 'Admin' : 'Operadora'}
            </Badge>
            <Badge variant={user.is_active ? 'success' : 'muted'}>
              {user.is_active ? 'Ativa' : 'Inativa'}
            </Badge>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.editBtn} onClick={() => onEdit(user)}>
            <Pencil size={14} />
            Editar
          </button>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Abas ───────────────────────────────────────────── */}
      <div className={styles.tabs}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Conteúdo ───────────────────────────────────────── */}
      <div className={styles.body}>

        {/* ABA: VISÃO GERAL */}
        {activeTab === 'geral' && (
          <div className={styles.tabContent}>

            {/* Stat Cards */}
            <div className={styles.statsGrid}>
              <StatCard
                icon={<ShoppingCart size={16} />}
                label="Vendas no mês"
                value={stats?.monthSales}
                loading={loading}
                delta={deltaSales}
              />
              <StatCard
                icon={<TrendingUp size={16} />}
                label="Faturamento no mês"
                value={stats?.monthRevenue}
                loading={loading}
                delta={deltaRevenue}
                isCurrency
              />
              <StatCard
                icon={<TrendingDown size={16} />}
                label="Ticket médio"
                value={stats?.avgTicket}
                loading={loading}
                isCurrency
              />
              <StatCard
                icon={<Users size={16} />}
                label="Clientes únicos"
                value={stats?.uniqueCustomers}
                loading={loading}
              />
            </div>

            {/* Finance Cards */}
            <div className={styles.sectionTitle}>Financeiro do mês</div>
            <div className={styles.financeGrid}>
              <FinanceCard
                icon={<TrendingDown size={16} />}
                label="Descontos concedidos"
                value={stats?.monthDiscounts}
                variant="expense"
                loading={loading}
              />
              <FinanceCard
                icon={<TrendingUp size={16} />}
                label="Margem bruta gerada"
                value={stats?.monthMargin}
                variant="income"
                loading={loading}
              />
            </div>

            {/* Info da usuária */}
            <div className={styles.sectionTitle}>Informações</div>
            <div className={styles.infoGrid}>
              <InfoItem label="E-mail" value={user.email} />
              <InfoItem label="Loja" value={user.store_name ?? 'Sem loja vinculada'} />
              <InfoItem label="Papel" value={user.role === 'admin' ? 'Administrador' : 'Operadora'} />
              <InfoItem
                label="Membro desde"
                value={new Date(user.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'long', year: 'numeric'
                })}
              />
              {stats && data && (
                <InfoItem
                  label="Total histórico"
                  value={`${stats.totalSales} vendas · ${stats.cancelledCount} canceladas · ${data.exchanges.length} trocas processadas`}
                />
              )}
            </div>
          </div>
        )}

        {/* ABA: VENDAS */}
        {activeTab === 'vendas' && (
          <div className={styles.tabContent}>
            {loading ? (
              <div className={styles.skeletonList}>
                <Skeleton height={28} width="50%" />
                {[1,2,3,4,5].map(i => <Skeleton key={i} height={40} />)}
              </div>
            ) : (
              <>
                {stats && (
                  <div className={styles.summaryBar}>
                    <span><strong>{stats.totalSales}</strong> vendas totais</span>
                    <span className={styles.dot}>·</span>
                    <span><strong>{formatCurrency(stats.totalRevenue)}</strong> faturamento</span>
                    <span className={styles.dot}>·</span>
                    <span><strong>{formatCurrency(stats.totalRevenue > 0 ? sum((data?.allSales ?? []).map(s => Number(s.discount_amount))) : 0)}</strong> em descontos</span>
                    {stats.cancelledCount > 0 && (
                      <>
                        <span className={styles.dot}>·</span>
                        <span className={styles.cancelledText}>{stats.cancelledCount} cancelada{stats.cancelledCount > 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                )}

                {data?.recentSales.length === 0 ? (
                  <EmptyState message="Nenhuma venda registrada." hint="As vendas desta funcionária aparecerão aqui." />
                ) : (
                  <table className={styles.miniTable}>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Cliente</th>
                        <th>Pagamento</th>
                        <th className={styles.rightCol}>Desconto</th>
                        <th className={styles.rightCol}>Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.recentSales.map(s => (
                        <tr key={s.id}>
                          <td className={styles.mutedCell}>{formatDate(s.sale_date)}</td>
                          <td>{s.customers?.name ?? <span className={styles.mutedCell}>—</span>}</td>
                          <td className={styles.mutedCell}>{s.payment_summary ?? '—'}</td>
                          <td className={`${styles.rightCol} ${styles.mutedCell}`}>
                            {Number(s.discount_amount) > 0 ? `-${formatCurrency(Number(s.discount_amount))}` : '—'}
                          </td>
                          <td className={`${styles.rightCol} ${styles.valueText}`}>
                            {formatCurrency(Number(s.total))}
                          </td>
                          <td>
                            <Badge variant={
                              s.status === 'completed' ? 'success' :
                              s.status === 'cancelled' ? 'danger' : 'warning'
                            }>
                              {s.status === 'completed' ? 'Concluída' :
                               s.status === 'cancelled' ? 'Cancelada' : 'Trocada'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}

        {/* ABA: ATIVIDADE */}
        {activeTab === 'atividade' && (
          <div className={styles.tabContent}>
            {loading ? (
              <div className={styles.skeletonList}>
                {[1,2,3].map(i => <Skeleton key={i} height={44} />)}
              </div>
            ) : (
              <>
                {/* Trocas */}
                <div className={styles.activitySection}>
                  <div className={styles.activityHeader}>
                    <Repeat2 size={14} className={styles.activityIcon} />
                    <span className={styles.activityTitle}>Trocas processadas</span>
                    <span className={styles.activityCount}>{data?.exchanges.length ?? 0}</span>
                  </div>
                  {(data?.exchanges.length ?? 0) === 0 ? (
                    <p className={styles.activityEmpty}>Nenhuma troca processada.</p>
                  ) : (
                    <table className={styles.miniTable}>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Motivo</th>
                          <th className={styles.rightCol}>Diferença</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.exchanges.map(e => (
                          <tr key={e.id}>
                            <td className={styles.mutedCell}>{formatDate(e.exchange_date)}</td>
                            <td>{e.reason ?? '—'}</td>
                            <td className={`${styles.rightCol} ${Number(e.price_difference) > 0 ? styles.incomeText : Number(e.price_difference) < 0 ? styles.expenseText : styles.mutedCell}`}>
                              {Number(e.price_difference) === 0 ? '—' :
                               `${Number(e.price_difference) > 0 ? '+' : ''}${formatCurrency(Number(e.price_difference))}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Fechamentos de Caixa */}
                <div className={styles.activitySection}>
                  <div className={styles.activityHeader}>
                    <ClipboardList size={14} className={styles.activityIcon} />
                    <span className={styles.activityTitle}>Fechamentos de caixa</span>
                    <span className={styles.activityCount}>{data?.cashClosings.length ?? 0}</span>
                  </div>
                  {(data?.cashClosings.length ?? 0) === 0 ? (
                    <p className={styles.activityEmpty}>Nenhum fechamento registrado.</p>
                  ) : (
                    <table className={styles.miniTable}>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th className={styles.rightCol}>Vendas</th>
                          <th className={styles.rightCol}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.cashClosings.map(c => (
                          <tr key={c.id}>
                            <td className={styles.mutedCell}>{formatDate(c.closing_date)}</td>
                            <td className={`${styles.rightCol} ${styles.mutedCell}`}>{c.sales_count}</td>
                            <td className={`${styles.rightCol} ${styles.valueText}`}>
                              {formatCurrency(Number(c.total_sales))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Transferências */}
                <div className={styles.activitySection}>
                  <div className={styles.activityHeader}>
                    <ArrowLeftRight size={14} className={styles.activityIcon} />
                    <span className={styles.activityTitle}>Transferências de estoque</span>
                    <span className={styles.activityCount}>{data?.transfersCount ?? 0}</span>
                  </div>
                  {(data?.transfersCount ?? 0) === 0 && (
                    <p className={styles.activityEmpty}>Nenhuma transferência registrada.</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </Modal>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value, loading, delta, isCurrency }: {
  icon: React.ReactNode
  label: string
  value?: number
  loading: boolean
  delta?: number | null
  isCurrency?: boolean
}) {
  const display = loading
    ? <Skeleton width="60px" height={26} />
    : (isCurrency ? formatCurrency(value ?? 0) : (value ?? 0))

  return (
    <div className={styles.statCard}>
      <div className={styles.statIcon}>{icon}</div>
      <div className={styles.statValueRow}>
        <div className={styles.statValue}>{display}</div>
        {!loading && delta !== undefined && <DeltaBadge delta={delta ?? null} />}
      </div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  )
}

function FinanceCard({ icon, label, value, variant, loading }: {
  icon: React.ReactNode
  label: string
  value?: number
  variant: 'income' | 'expense'
  loading: boolean
}) {
  return (
    <div className={`${styles.financeCard} ${styles[`finance_${variant}`]}`}>
      <div className={styles.financeIcon}>{icon}</div>
      <div className={styles.financeValue}>
        {loading ? <Skeleton width="80px" height={18} /> : formatCurrency(value ?? 0)}
      </div>
      <div className={styles.financeLabel}>{label}</div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.infoItem}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={styles.infoValue}>{value}</span>
    </div>
  )
}

function EmptyState({ message, hint }: { message: string; hint: string }) {
  return (
    <div className={styles.emptyState}>
      <span>{message}</span>
      <span className={styles.emptyHint}>{hint}</span>
    </div>
  )
}
