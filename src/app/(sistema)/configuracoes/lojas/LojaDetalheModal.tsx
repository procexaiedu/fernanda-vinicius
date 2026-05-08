'use client'

import { useEffect, useState } from 'react'
import { Store as StoreIcon, Pencil, MapPin, Phone, Hash, Calendar, Users, Package, ShoppingCart, UserCheck, TrendingUp, TrendingDown, Minus, X } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import type { Store } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatPhone } from './LojasClient'
import styles from './LojaDetalheModal.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreUser {
  id: string
  full_name: string
  role: string
  is_active: boolean
}

interface StoreProduct {
  id: string
  code: string
  name: string
  category: string
  quantity_in_stock: number
  sale_price: number
}

interface StoreTransaction {
  id: string
  description: string
  type: 'income' | 'expense'
  amount: number
  status: string
  transaction_date: string
  category: string
}

interface StoreStats {
  usersCount: number
  productsCount: number
  salesCount: number
  customersCount: number
  consignmentsActive: number
  monthlyIncome: number
  monthlyExpense: number
}

interface StoreData {
  users: StoreUser[]
  products: StoreProduct[]
  transactions: StoreTransaction[]
  stats: StoreStats
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  store: Store
  onClose: () => void
  onEdit: (store: Store) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function getMonthStart(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ width, height = 16 }: { width?: string; height?: number }) {
  return (
    <div
      className={styles.skeleton}
      style={{ width: width ?? '100%', height }}
    />
  )
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function LojaDetalheModal({ store, onClose, onEdit }: Props) {
  const [activeTab, setActiveTab] = useState<'geral' | 'equipe' | 'estoque' | 'financeiro'>('geral')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<StoreData | null>(null)

  useEffect(() => {
    setLoading(true)
    setData(null)

    const supabase = createClient()
    const monthStart = getMonthStart()

    Promise.all([
      supabase.from('users').select('id, full_name, role, is_active').eq('store_id', store.id).order('full_name'),
      supabase.from('products').select('id, code, name, category, quantity_in_stock, sale_price').eq('store_id', store.id).eq('is_active', true).order('created_at', { ascending: false }).limit(10),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('is_active', true),
      supabase.from('sales').select('id', { count: 'exact', head: true }).eq('store_id', store.id).gte('sale_date', monthStart),
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('origin_store_id', store.id),
      supabase.from('transactions').select('type, amount, status').eq('store_id', store.id).gte('transaction_date', monthStart),
      supabase.from('transactions').select('id, description, type, amount, status, transaction_date, category').eq('store_id', store.id).order('transaction_date', { ascending: false }).limit(8),
      supabase.from('consignments').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'active'),
    ]).then(([
      usersRes,
      productsListRes,
      productsCountRes,
      salesCountRes,
      customersCountRes,
      transactionsMonthRes,
      transactionsListRes,
      consignmentsCountRes,
    ]) => {
      const txMonth = (transactionsMonthRes.data ?? []) as { type: string; amount: number; status: string }[]
      const monthlyIncome = txMonth.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
      const monthlyExpense = txMonth.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)

      setData({
        users: (usersRes.data ?? []) as StoreUser[],
        products: (productsListRes.data ?? []) as StoreProduct[],
        transactions: (transactionsListRes.data ?? []) as StoreTransaction[],
        stats: {
          usersCount: usersRes.data?.length ?? 0,
          productsCount: productsCountRes.count ?? 0,
          salesCount: salesCountRes.count ?? 0,
          customersCount: customersCountRes.count ?? 0,
          consignmentsActive: consignmentsCountRes.count ?? 0,
          monthlyIncome,
          monthlyExpense,
        },
      })
      setLoading(false)
    })
  }, [store.id])

  const tabs = [
    { key: 'geral',      label: 'Visão Geral' },
    { key: 'equipe',     label: 'Equipe' },
    { key: 'estoque',    label: 'Estoque' },
    { key: 'financeiro', label: 'Financeiro' },
  ] as const

  return (
    <Modal isOpen onClose={onClose} size="xl" hideHeader>
      {/* ── Cabeçalho customizado ─────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.storeIcon}>
            <StoreIcon size={20} />
          </div>
          <div>
            <div className={styles.storeName}>{store.name}</div>
            <div className={styles.storeMeta}>
              {store.city} / {store.state}
              {store.cnpj && <> &bull; {store.cnpj}</>}
            </div>
          </div>
          <div className={styles.statusBadge}>
            {store.is_active
              ? <Badge variant="success">Ativa</Badge>
              : <Badge variant="muted">Inativa</Badge>
            }
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.editBtn}
            onClick={() => onEdit(store)}
            title="Editar loja"
          >
            <Pencil size={14} />
            Editar
          </button>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Abas ─────────────────────────────────────────── */}
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Conteúdo ─────────────────────────────────────── */}
      <div className={styles.body}>

        {/* ABA: VISÃO GERAL */}
        {activeTab === 'geral' && (
          <div className={styles.tabContent}>
            {/* Stat cards */}
            <div className={styles.statsGrid}>
              <StatCard icon={<Users size={16} />} label="Operadoras" value={data?.stats.usersCount} loading={loading} />
              <StatCard icon={<Package size={16} />} label="Produtos ativos" value={data?.stats.productsCount} loading={loading} />
              <StatCard icon={<ShoppingCart size={16} />} label="Vendas no mês" value={data?.stats.salesCount} loading={loading} />
              <StatCard icon={<UserCheck size={16} />} label="Clientes" value={data?.stats.customersCount} loading={loading} />
            </div>

            {/* Cards financeiros do mês */}
            <div className={styles.sectionTitle}>Financeiro do mês</div>
            <div className={styles.financeGrid}>
              <FinanceCard
                icon={<TrendingUp size={16} />}
                label="Entradas"
                value={data?.stats.monthlyIncome}
                variant="income"
                loading={loading}
              />
              <FinanceCard
                icon={<TrendingDown size={16} />}
                label="Saídas"
                value={data?.stats.monthlyExpense}
                variant="expense"
                loading={loading}
              />
              <FinanceCard
                icon={<Minus size={16} />}
                label="Saldo líquido"
                value={data ? data.stats.monthlyIncome - data.stats.monthlyExpense : undefined}
                variant="neutral"
                loading={loading}
              />
            </div>

            {/* Info da loja */}
            <div className={styles.sectionTitle}>Informações</div>
            <div className={styles.infoGrid}>
              {store.address && (
                <div className={styles.infoItem}>
                  <MapPin size={13} className={styles.infoIcon} />
                  <span>{store.address}</span>
                </div>
              )}
              {store.phone && (
                <div className={styles.infoItem}>
                  <Phone size={13} className={styles.infoIcon} />
                  <span>{formatPhone(store.phone)}</span>
                </div>
              )}
              {store.cnpj && (
                <div className={styles.infoItem}>
                  <Hash size={13} className={styles.infoIcon} />
                  <span>{store.cnpj}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <Calendar size={13} className={styles.infoIcon} />
                <span>Cadastrada em {formatDate(store.created_at)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ABA: EQUIPE */}
        {activeTab === 'equipe' && (
          <div className={styles.tabContent}>
            {loading ? (
              <div className={styles.skeletonList}>
                {[1,2,3].map(i => <Skeleton key={i} height={44} />)}
              </div>
            ) : data?.users.length === 0 ? (
              <EmptyState message="Nenhuma operadora vinculada a esta loja." hint="Adicione usuários na seção Configurações → Usuários." />
            ) : (
              <div className={styles.userList}>
                {data?.users.map((u) => (
                  <div key={u.id} className={styles.userRow}>
                    <div className={styles.userAvatar}>
                      {u.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.userInfo}>
                      <span className={styles.userName}>{u.full_name}</span>
                      <span className={styles.userRole}>
                        {u.role === 'admin' ? 'Administrador' : 'Operadora'}
                      </span>
                    </div>
                    <Badge variant={u.is_active ? 'success' : 'muted'}>
                      {u.is_active ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ABA: ESTOQUE */}
        {activeTab === 'estoque' && (
          <div className={styles.tabContent}>
            {loading ? (
              <div className={styles.skeletonList}>
                <Skeleton height={32} width="60%" />
                {[1,2,3,4,5].map(i => <Skeleton key={i} height={40} />)}
              </div>
            ) : (
              <>
                <div className={styles.estoqueSummary}>
                  <span>
                    <strong>{data?.stats.productsCount ?? 0}</strong> produtos ativos
                  </span>
                  {(data?.stats.consignmentsActive ?? 0) > 0 && (
                    <Badge variant="accent">
                      {data?.stats.consignmentsActive} consignação{data!.stats.consignmentsActive > 1 ? 'ões' : ''} ativa{data!.stats.consignmentsActive > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                {data?.products.length === 0 ? (
                  <EmptyState message="Nenhum produto cadastrado nesta loja." hint="Os produtos serão exibidos aqui após o cadastro no módulo Produtos." />
                ) : (
                  <table className={styles.miniTable}>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Nome</th>
                        <th>Categoria</th>
                        <th className={styles.rightCol}>Estoque</th>
                        <th className={styles.rightCol}>Preço</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.products.map((p) => (
                        <tr key={p.id}>
                          <td className={styles.codeCell}>{p.code}</td>
                          <td>{p.name}</td>
                          <td className={styles.mutedCell}>{p.category}</td>
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

        {/* ABA: FINANCEIRO */}
        {activeTab === 'financeiro' && (
          <div className={styles.tabContent}>
            {loading ? (
              <div className={styles.skeletonList}>
                {[1,2,3,4,5].map(i => <Skeleton key={i} height={44} />)}
              </div>
            ) : data?.transactions.length === 0 ? (
              <EmptyState message="Nenhuma transação encontrada para esta loja." hint="As movimentações financeiras aparecerão aqui conforme as vendas e despesas forem registradas." />
            ) : (
              <table className={styles.miniTable}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th className={styles.rightCol}>Valor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className={styles.mutedCell}>{formatDate(t.transaction_date)}</td>
                      <td>{t.description}</td>
                      <td className={styles.mutedCell}>{t.category}</td>
                      <td className={`${styles.rightCol} ${t.type === 'income' ? styles.incomeText : styles.expenseText}`}>
                        {t.type === 'income' ? '+' : '-'} {formatCurrency(t.amount)}
                      </td>
                      <td>
                        <Badge variant={t.status === 'completed' ? 'success' : 'warning'}>
                          {t.status === 'completed' ? 'Pago' : 'Pendente'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </Modal>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value, loading }: {
  icon: React.ReactNode
  label: string
  value?: number
  loading: boolean
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statIcon}>{icon}</div>
      <div className={styles.statValue}>
        {loading ? <Skeleton width="40px" height={28} /> : (value ?? 0)}
      </div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  )
}

function FinanceCard({ icon, label, value, variant, loading }: {
  icon: React.ReactNode
  label: string
  value?: number
  variant: 'income' | 'expense' | 'neutral'
  loading: boolean
}) {
  return (
    <div className={`${styles.financeCard} ${styles[`finance_${variant}`]}`}>
      <div className={styles.financeIcon}>{icon}</div>
      <div className={styles.financeValue}>
        {loading ? <Skeleton width="80px" height={20} /> : formatCurrency(value ?? 0)}
      </div>
      <div className={styles.financeLabel}>{label}</div>
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
