'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import {
  ChevronLeft, ChevronRight, ChevronDown,
  TrendingUp, TrendingDown, Package, AlertTriangle, Users, Calendar,
  DollarSign, ShoppingCart, Gem, Award, Clock, ArrowRight,
} from 'lucide-react'

import ProdutoDetalheModal from '@/components/produto/ProdutoDetalheModal'
import VendedoraDetalheModal from '@/components/vendedora/VendedoraDetalheModal'
import {
  buscarKpis, buscarEstoque, buscarGrafico,
  buscarTopVendedoras,
  buscarPecasParadas, buscarContasVencer, buscarAniversariantes,
  buscarVendasPorCategoria, buscarEvolucaoVendas,
  type StoreOption, type DashboardSettings, type DashboardKpis,
  type DashboardStock, type MonthChartData,
  type TopVendedora, type AlertPecaParada,
  type AlertConta, type AlertAniversariante,
  type CategoryChartData, type EvolucaoChartData,
} from './actions'
import styles from './DashboardClient.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function fmtBirthday(s: string) {
  const [, m, d] = s.split('-')
  return `${d}/${m}`
}

function getAvatarColor(id: string) {
  const colors = ['#C9A84C','#4CAF7D','#5B8DEF','#E05252','#9B59B6','#E0A352']
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function getInitials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ─── Dropdown customizado (padrão do sistema) ─────────────────────────────────

function FilterDropdown({ label, value, options, onChange }: {
  label: string
  value: string
  options: { label: string; value: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen]   = useState(false)
  const [pos, setPos]     = useState<{ top: number; left: number; width: number } | null>(null)
  const ref               = useRef<HTMLDivElement>(null)
  const selected          = options.find(o => o.value === value)

  function toggle() {
    if (open) { setOpen(false); setPos(null); return }
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setPos(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className={styles.dropdown} onClick={toggle}>
      <span className={styles.dropdownLabel}>{label}:</span>
      <span className={styles.dropdownValue}>{selected?.label ?? label}</span>
      <ChevronDown size={13} className={`${styles.dropdownChevron} ${open ? styles.open : ''}`} />

      {open && pos && (
        <div
          className={styles.dropdownMenu}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
        >
          {options.map(o => (
            <div
              key={o.value}
              className={`${styles.dropdownItem} ${o.value === value ? styles.active : ''}`}
              onClick={e => { e.stopPropagation(); onChange(o.value); setOpen(false); setPos(null) }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tooltip customizado do gráfico ───────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.chartTooltip}>
      <div className={styles.chartTooltipTitle}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className={styles.chartTooltipRow}>
          <span className={styles.chartTooltipDot} style={{ background: p.color }} />
          <span className={styles.chartTooltipName}>{p.name}</span>
          <span className={styles.chartTooltipVal}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  isAdmin: boolean
  initialStoreId: string | null
  lojas: StoreOption[]
  settings: DashboardSettings
  inactiveDays: number
  initialKpis: DashboardKpis
  initialEstoque: DashboardStock
  initialGrafico: MonthChartData[]
  initialTopVendedoras: TopVendedora[]
  initialPecasParadas: AlertPecaParada[]
  initialContasVencer: AlertConta[]
  initialAniversariantes: AlertAniversariante[]
  initialCategorias: CategoryChartData[]
  initialEvolucao: EvolucaoChartData[]
  initialMonth: number
  initialYear: number
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function DashboardClient({
  isAdmin, initialStoreId, lojas, settings, inactiveDays,
  initialKpis, initialEstoque, initialGrafico,
  initialTopVendedoras,
  initialPecasParadas, initialContasVencer, initialAniversariantes,
  initialCategorias, initialEvolucao,
  initialMonth, initialYear,
}: Props) {
  const [storeId, setStoreId]       = useState<string | null>(initialStoreId)
  const [month, setMonth]           = useState(initialMonth)
  const [year, setYear]             = useState(initialYear)
  const [loading, setLoading]       = useState(false)

  const [kpis, setKpis]             = useState(initialKpis)
  const [estoque, setEstoque]       = useState(initialEstoque)
  const [grafico, setGrafico]       = useState(initialGrafico)
  const [topVendedoras, setTopVendedoras] = useState(initialTopVendedoras)
  const [pecasParadas, setPecasParadas]   = useState(initialPecasParadas)
  const [contasVencer, setContasVencer]   = useState(initialContasVencer)
  const [aniversariantes, setAniversariantes] = useState(initialAniversariantes)
  const [categorias, setCategorias]   = useState(initialCategorias)
  const [evolucao, setEvolucao]       = useState(initialEvolucao)

  const [grafMeses, setGrafMeses]   = useState(6)

  // Modais
  const [vendedoraModal, setVendedoraModal] = useState<TopVendedora | null>(null)

  const reload = useCallback(async (sid: string | null, m: number, y: number, meses: number) => {
    setLoading(true)
    const [newKpis, newEstoque, newGrafico, newVendedoras, newParadas, newContas, newAniv, newCats, newEvol] =
      await Promise.all([
        buscarKpis(sid, m, y, settings.purchaseReservePct),
        buscarEstoque(sid, settings.staleDays),
        buscarGrafico(sid, meses),
        buscarTopVendedoras(sid, m, y),
        buscarPecasParadas(sid, settings.staleDays),
        buscarContasVencer(sid),
        buscarAniversariantes(sid),
        buscarVendasPorCategoria(sid, m, y),
        buscarEvolucaoVendas(sid, meses),
      ])
    setKpis(newKpis)
    setEstoque(newEstoque)
    setGrafico(newGrafico)
    setTopVendedoras(newVendedoras)
    setPecasParadas(newParadas)
    setContasVencer(newContas)
    setAniversariantes(newAniv)
    setCategorias(newCats)
    setEvolucao(newEvol)
    setLoading(false)
  }, [settings])

  function changeStore(v: string) {
    const sid = v === '__all__' ? null : v
    setStoreId(sid)
    reload(sid, month, year, grafMeses)
  }

  function prevMonth() {
    const nm = month === 1 ? 12 : month - 1
    const ny = month === 1 ? year - 1 : year
    setMonth(nm); setYear(ny)
    reload(storeId, nm, ny, grafMeses)
  }

  function nextMonth() {
    const now = new Date()
    if (year === now.getFullYear() && month === now.getMonth() + 1) return
    const nm = month === 12 ? 1 : month + 1
    const ny = month === 12 ? year + 1 : year
    setMonth(nm); setYear(ny)
    reload(storeId, nm, ny, grafMeses)
  }

  function changeMeses(v: string) {
    const m = Number(v)
    setGrafMeses(m)
    reload(storeId, month, year, m)
  }

  const storeOptions = [
    { value: '__all__', label: 'Todas as lojas' },
    ...lojas.map(l => ({ value: l.id, label: l.name })),
  ]
  const isCurrentMonth = new Date().getMonth() + 1 === month && new Date().getFullYear() === year

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={`${styles.page} ${loading ? styles.loading : ''}`}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>Visão geral do seu negócio</p>
        </div>
        <div className={styles.controls}>
          {isAdmin && (
            <FilterDropdown
              label="Loja"
              value={storeId ?? '__all__'}
              options={storeOptions}
              onChange={changeStore}
            />
          )}
          <div className={styles.monthNav}>
            <button className={styles.monthBtn} onClick={prevMonth}><ChevronLeft size={16} /></button>
            <span className={styles.monthLabel}>{MONTHS_PT[month - 1]} {year}</span>
            <button className={styles.monthBtn} onClick={nextMonth} disabled={isCurrentMonth}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Seção 1: KPIs Financeiros ──────────────────────────────────────── */}
      <div className={styles.kpiGrid}>
        <KpiCard
          label="Receita Bruta"
          value={fmt(kpis.receitaBruta)}
          icon={<TrendingUp size={16} />}
          color="accent"
        />
        <KpiCard
          label="Custo (CMV)"
          value={fmt(kpis.cmv)}
          icon={<ShoppingCart size={16} />}
          color="danger"
          hint="Custo dos produtos vendidos"
        />
        <KpiCard
          label="Lucro Bruto"
          value={fmt(kpis.lucroBruto)}
          icon={<DollarSign size={16} />}
          color={kpis.lucroBruto >= 0 ? 'info' : 'danger'}
          hint={`${kpis.receitaBruta > 0 ? ((kpis.lucroBruto / kpis.receitaBruta) * 100).toFixed(1) : '0'}% da receita`}
        />
        <KpiCard
          label="Despesas Op."
          value={fmt(kpis.despesasOp)}
          icon={<TrendingDown size={16} />}
          color="warning"
          hint="Despesas pagas no mês"
        />
        <KpiCard
          label="Lucro Líquido"
          value={fmt(kpis.lucroLiquido)}
          icon={<Award size={16} />}
          color={kpis.lucroLiquido >= 0 ? 'success' : 'danger'}
          hint={`${kpis.receitaBruta > 0 ? ((kpis.lucroLiquido / kpis.receitaBruta) * 100).toFixed(1) : '0'}% da receita`}
        />
      </div>

      {/* ── Card de Disponível para Compra ─────────────────────────────────── */}
      <div className={styles.disponivelCard}>
        <div className={styles.disponivelIcon}><Gem size={20} /></div>
        <div className={styles.disponivelContent}>
          <div className={styles.disponivelTitle}>Disponível para Compra</div>
          <div className={styles.disponivelBreakdown}>
            <span>Lucro Líquido: <strong>{fmt(kpis.lucroLiquido)}</strong></span>
            <span className={styles.disponivelMinus}>−</span>
            <span>Reserva ({kpis.reservePct}%): <strong>{fmt(kpis.lucroLiquido * kpis.reservePct / 100)}</strong></span>
          </div>
        </div>
        <div className={`${styles.disponivelValue} ${kpis.disponivelCompra < 0 ? styles.disponivelNeg : ''}`}>
          {fmt(Math.max(0, kpis.disponivelCompra))}
        </div>
      </div>

      {/* ── Seções 2+3: Estoque + Gráfico ─────────────────────────────────── */}
      <div className={styles.midRow}>

        {/* Estoque */}
        <div className={styles.stockPanel}>
          <div className={styles.panelHeader}>
            <Package size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Estoque</span>
          </div>
          <div className={styles.stockGrid}>
            <StockCard label="Total de Peças" value={estoque.totalPecas.toLocaleString('pt-BR')} />
            <StockCard label="SKUs Únicos" value={estoque.totalSkus.toLocaleString('pt-BR')} />
            {isAdmin && (
              <StockCard label="Valor em Custo" value={fmt(estoque.valorEstoque)} small />
            )}
            {isAdmin && (
              <StockCard label="Valor em Venda" value={fmt(estoque.valorEstoqueVenda)} small />
            )}
            <StockCard
              label="Peças Paradas"
              value={estoque.pecasParadas.toLocaleString('pt-BR')}
              alert={estoque.pecasParadas > 0}
              hint={`+${estoque.staleDays} dias sem venda`}
            />
          </div>
        </div>

        {/* Gráfico */}
        <div className={styles.chartPanel}>
          <div className={styles.panelHeader}>
            <TrendingUp size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Vendas × Compras</span>
            <div className={styles.chartControls}>
              <FilterDropdown
                label="Período"
                value={String(grafMeses)}
                options={[
                  { value: '3', label: 'Últimos 3 meses' },
                  { value: '6', label: 'Últimos 6 meses' },
                  { value: '12', label: 'Últimos 12 meses' },
                ]}
                onChange={changeMeses}
              />
            </div>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={grafico} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v < -1000 ? `-${(Math.abs(v)/1000).toFixed(0)}k` : String(v)} width={42} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 2" />
                <Line dataKey="faturamento"  name="Faturamento"   stroke="#C9A84C" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#C9A84C' }} type="monotone" />
                <Line dataKey="custoCompras" name="Custo Compras" stroke="#E05252" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#E05252' }} type="monotone" />
                <Line dataKey="lucroLiquido" name="Lucro Líquido" stroke="#4CAF7D" strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 4, fill: '#4CAF7D' }} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Seção 4: Gráficos de desempenho + Ranking vendedoras ────────── */}
      <div className={styles.perfRow}>

        {/* Vendas por Categoria */}
        <div className={styles.perfPanel}>
          <div className={styles.panelHeader}>
            <Award size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Vendas por Categoria</span>
            <span className={styles.panelSub}>{MONTHS_PT[month - 1]}</span>
          </div>
          {categorias.length === 0 ? (
            <div className={styles.chartEmpty}>Nenhuma venda no período</div>
          ) : (
            <div className={styles.chartWrapSm}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={categorias} layout="vertical" margin={{ top: 2, right: 48, left: 4, bottom: 2 }} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                  <YAxis type="category" dataKey="category" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
                  <Tooltip
                    formatter={(v: any) => [fmt(Number(v)), 'Receita']}
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Bar dataKey="receita" fill="#C9A84C" radius={[0,3,3,0]} label={{ position: 'right', fill: 'var(--text-muted)', fontSize: 10, formatter: (v: any) => fmt(Number(v)) }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Evolução de Vendas */}
        <div className={styles.perfPanel}>
          <div className={styles.panelHeader}>
            <TrendingUp size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Evolução de Vendas</span>
            <span className={styles.panelSub}>Últimos {grafMeses} meses</span>
          </div>
          <div className={styles.chartWrapSm}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={evolucao} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="evolGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#C9A84C" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#C9A84C" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} width={38} />
                <Tooltip
                  formatter={(v: any) => [fmt(Number(v)), 'Faturamento']}
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Area dataKey="receita" name="Faturamento" stroke="#C9A84C" strokeWidth={2} fill="url(#evolGrad)" dot={{ fill: '#C9A84C', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Ranking Vendedoras */}
        <div className={styles.perfPanel}>
          <div className={styles.panelHeader}>
            <Users size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Vendedoras</span>
            <span className={styles.panelSub}>{MONTHS_PT[month - 1]}</span>
          </div>
          <RankTable
            headers={['#','Vendedora','Loja','Vendas','Total','']}
            rows={topVendedoras.map((v, i) => ({
              cells: [
                <RankPos key="pos" n={i+1} />,
                <div key="name" className={styles.rankAvatarRow}>
                  <div className={styles.rankAvatar} style={{ background: getAvatarColor(v.id) }}>{getInitials(v.name)}</div>
                  <span className={styles.rankName}>{v.name}</span>
                </div>,
                <span key="loja" className={styles.rankMuted}>{v.store_name ?? '—'}</span>,
                <span key="nr"   className={styles.rankBold}>{v.nrVendas}</span>,
                <span key="tot"  className={styles.rankAccent}>{fmt(v.totalVendido)}</span>,
                <ArrowRight key="arr" size={14} className={styles.rankArrow} />,
              ],
              onClick: () => setVendedoraModal(v),
            }))}
            empty="Nenhuma venda no período"
          />
        </div>

      </div>

      {/* ── Seção 5: Alertas ──────────────────────────────────────────────── */}
      <div className={styles.alertsGrid}>

        {/* Peças paradas */}
        <div className={styles.alertCard}>
          <div className={styles.alertHeader}>
            <AlertTriangle size={14} className={styles.alertIconDanger} />
            <span className={styles.alertTitle}>Peças Paradas</span>
            <span className={styles.alertBadge} data-variant={pecasParadas.length > 0 ? 'danger' : 'ok'}>
              {pecasParadas.length}
            </span>
          </div>
          <div className={styles.alertList}>
            {pecasParadas.length === 0 ? (
              <div className={styles.alertEmpty}>Nenhuma peça parada</div>
            ) : pecasParadas.map(p => (
              <div key={p.id} className={styles.alertRow}>
                <div className={styles.alertRowInfo}>
                  <span className={styles.alertRowName}>{p.name}</span>
                  <span className={styles.alertRowSub}>{p.category} · {p.code}</span>
                </div>
                <span className={styles.alertRowDays}>{p.diasParada}d</span>
                <ArrowRight size={13} className={styles.rankArrow} />
              </div>
            ))}
          </div>
        </div>

        {/* Contas a vencer */}
        <div className={styles.alertCard}>
          <div className={styles.alertHeader}>
            <Clock size={14} className={styles.alertIconWarning} />
            <span className={styles.alertTitle}>Vence em 15 dias</span>
            <span className={styles.alertBadge} data-variant={contasVencer.length > 0 ? 'warning' : 'ok'}>
              {contasVencer.length}
            </span>
          </div>
          <div className={styles.alertList}>
            {contasVencer.length === 0 ? (
              <div className={styles.alertEmpty}>Nenhuma conta a vencer</div>
            ) : contasVencer.map(c => (
              <div key={c.id} className={styles.alertRow}>
                <div className={styles.alertRowInfo}>
                  <span className={styles.alertRowName}>{c.description}</span>
                  <span className={styles.alertRowSub}>{c.category} · {fmtDate(c.due_date)}</span>
                </div>
                <span className={styles.alertRowAmount}>{fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Aniversariantes */}
        <div className={styles.alertCard}>
          <div className={styles.alertHeader}>
            <Calendar size={14} className={styles.alertIconAccent} />
            <span className={styles.alertTitle}>Aniversariantes do mês</span>
            <span className={styles.alertBadge} data-variant={aniversariantes.length > 0 ? 'accent' : 'ok'}>
              {aniversariantes.length}
            </span>
          </div>
          <div className={styles.alertList}>
            {aniversariantes.length === 0 ? (
              <div className={styles.alertEmpty}>Nenhuma aniversariante</div>
            ) : aniversariantes.map(a => (
              <div key={a.id} className={styles.alertRow}>
                <div className={styles.alertRowInfo}>
                  <span className={styles.alertRowName}>{a.name}</span>
                  <span className={styles.alertRowSub}>{a.phone} · {fmtBirthday(a.birthday)}</span>
                </div>
                <span className={styles.alertRowMuted}>
                  {a.last_sale_date ? fmtDate(a.last_sale_date) : 'Nunca'}
                </span>
                <ArrowRight size={13} className={styles.rankArrow} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Modais ─────────────────────────────────────────────────────────── */}
      {vendedoraModal && (
        <VendedoraDetalheModal
          vendedora={vendedoraModal}
          month={month}
          year={year}
          onClose={() => setVendedoraModal(null)}
        />
      )}
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, color, hint }: {
  label: string; value: string; icon: React.ReactNode
  color: 'accent' | 'success' | 'danger' | 'warning' | 'info'; hint?: string
}) {
  return (
    <div className={`${styles.kpiCard} ${styles[`kpi_${color}`]}`}>
      <div className={styles.kpiIcon}>{icon}</div>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      {hint && <div className={styles.kpiHint}>{hint}</div>}
    </div>
  )
}

function StockCard({ label, value, alert, hint, small }: {
  label: string; value: string; alert?: boolean; hint?: string; small?: boolean
}) {
  return (
    <div className={`${styles.stockCard} ${alert ? styles.stockAlert : ''}`}>
      <div className={styles.stockValue} style={{ fontSize: small ? 15 : undefined }}>{value}</div>
      <div className={styles.stockLabel}>{label}</div>
      {hint && <div className={styles.stockHint}>{hint}</div>}
    </div>
  )
}

function RankPos({ n }: { n: number }) {
  return <span className={`${styles.rankPos} ${n <= 3 ? styles[`pos${n}`] : ''}`}>{n}</span>
}

function RankTable({ headers, rows, empty }: {
  headers: string[]
  rows: { cells: React.ReactNode[]; onClick?: () => void }[]
  empty: string
}) {
  return (
    <div className={styles.rankTableWrap}>
      <table className={styles.rankTable}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={styles.rankTh}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className={styles.rankEmpty}>{empty}</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i} className={`${styles.rankTr} ${row.onClick ? styles.rankTrClickable : ''}`} onClick={row.onClick}>
              {row.cells.map((cell, j) => (
                <td key={j} className={styles.rankTd}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
