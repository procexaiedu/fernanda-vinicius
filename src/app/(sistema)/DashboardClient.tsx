'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceDot,
} from 'recharts'
import {
  ChevronLeft, ChevronRight, ChevronDown,
  TrendingUp, TrendingDown, Package, AlertTriangle, Users, Calendar,
  DollarSign, ShoppingCart, Award, Clock, ArrowRight, HandCoins,
} from 'lucide-react'

import ProdutoDetalheModal, { type ProdutoParaDetalhe } from '@/components/produto/ProdutoDetalheModal'
import VendedoraDetalheModal from '@/components/vendedora/VendedoraDetalheModal'
import DashboardDetalhe, { type ChaveDetalhe } from './DashboardDetalhe'
import {
  buscarKpis, buscarEstoque, buscarGrafico,
  buscarTopVendedoras, buscarProdutoParaDetalhe,
  buscarPecasParadas, buscarContasVencer, buscarAniversariantes,
  buscarVendasPorCategoria, buscarEvolucaoVendas,
  type StoreOption, type DashboardSettings, type DashboardKpis,
  type DashboardStock, type MonthChartData,
  type TopVendedora, type AlertPecaParada,
  type AlertConta, type AlertCobranca, type AlertAniversariante,
  type CategoryChartData, type EvolucaoChartData,
} from './actions'
import styles from './DashboardClient.module.css'
import { formatarTelefone } from '@/lib/telefone'
import { formatarDinheiro, formatarEixo } from '@/lib/dinheiro'
import PageHeader from '@/components/ui/PageHeader'
import Link from 'next/link'
import { posicionarDropdown, type PosicaoDropdown } from '@/lib/dropdown'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const fmt = formatarDinheiro

function fmtDate(s: string | null) {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function fmtBirthday(s: string) {
  const [, m, d] = s.split('-')
  return `${d}/${m}`
}

/*
 * Rótulo de dado é valor cheio, com centavos.
 *
 * Antes isto era `Math.round(v)` — "R$ 5.660" no lugar de "R$ 5.659,90". Num
 * sistema de controle financeiro, arredondar para caber no rótulo faz a barra
 * discordar do total que a mesma tela mostra logo abaixo, e a diferença de
 * centavos é justamente o que se procura quando a conta não fecha.
 *
 * O eixo continua abreviado, e só ele: marca de escala não é valor.
 */
const fmtCurto = formatarDinheiro
const fmtEixo = formatarEixo

/*
 * Ordem categórica FIXA das cores — a mesma do protótipo.
 *
 * Fixa porque a cor tem que seguir a posição no ranking de forma estável: se num
 * mês "Colar" é a primeira e no outro cai para terceira, ela troca de cor e o
 * olho entende que mudou de coisa. A ordem é sempre a mesma lista, sem ciclar.
 */
const CORES_CATEGORIA = [
  'var(--gem-esmeralda)',
  'var(--gem-safira)',
  'var(--gem-ametista)',
  'var(--gem-rubi)',
  'var(--gem-topazio)',
  'var(--gem-perola)',
]

// ─── Dropdown customizado (padrão do sistema) ─────────────────────────────────

function FilterDropdown({ label, value, options, onChange }: {
  label: string
  value: string
  options: { label: string; value: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen]   = useState(false)
  const [pos, setPos]     = useState<PosicaoDropdown | null>(null)
  const ref               = useRef<HTMLDivElement>(null)
  const selected          = options.find(o => o.value === value)

  function toggle() {
    if (open) { setOpen(false); setPos(null); return }
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos(posicionarDropdown(r, { altura: 280 }))
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
          style={{
            position: 'fixed', left: pos.left, width: Math.max(pos.width, 160), zIndex: 1000,
            ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
            maxHeight: pos.maxHeight, overflowY: 'auto',
          }}
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
  /** Vê mais de uma loja e portanto pode alternar. Só o admin global. */
  podeTrocarLoja: boolean
  initialStoreId: string | null
  lojas: StoreOption[]
  settings: DashboardSettings
  inactiveDays: number
  initialKpis: DashboardKpis
  initialEstoque: DashboardStock
  initialGrafico: MonthChartData[]
  initialTopVendedoras: TopVendedora[]
  initialPecasParadas: AlertPecaParada[]
  initialCobrancas: AlertCobranca[]
  initialContasVencer: AlertConta[]
  initialAniversariantes: AlertAniversariante[]
  initialCategorias: CategoryChartData[]
  initialEvolucao: EvolucaoChartData[]
  initialMonth: number
  initialYear: number
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function DashboardClient({
  isAdmin, podeTrocarLoja, initialStoreId, lojas, settings, inactiveDays,
  initialKpis, initialEstoque, initialGrafico,
  initialTopVendedoras,
  initialPecasParadas, initialContasVencer, initialCobrancas, initialAniversariantes,
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
  /* Sem setter: diferente dos KPIs, a lista de cobrança não muda com o mês
   * escolhido — quem prometeu pagar hoje é sempre hoje. Recarrega na navegação. */
  const [cobrancas] = useState(initialCobrancas)
  const [aniversariantes, setAniversariantes] = useState(initialAniversariantes)
  const [categorias, setCategorias]   = useState(initialCategorias)
  const [evolucao, setEvolucao]       = useState(initialEvolucao)

  const [grafMeses, setGrafMeses]   = useState(6)

  /* O melhor mês da série — o único ponto que já vem com o valor escrito. */
  const picoEvolucao = evolucao.reduce<EvolucaoChartData | null>(
    (melhor, p) => (p.receita > 0 && (!melhor || p.receita > melhor.receita) ? p : melhor),
    null,
  )

  // Modais
  const [vendedoraModal, setVendedoraModal] = useState<TopVendedora | null>(null)
  /*
   * Qual número está sendo destrinchado. Um só estado para todos os pontos
   * clicáveis — abrir um fecha o anterior, que é o comportamento esperado.
   *
   * O período viaja junto porque nem todo clique fala do mês da tela: o gráfico
   * de evolução mostra seis meses, e clicar em Mai/26 tem que abrir a receita de
   * MAIO, não a do mês selecionado lá em cima.
   */
  const [detalhe, setDetalhe] = useState<{ chave: ChaveDetalhe; mes: number; ano: number } | null>(null)

  /** Abre o detalhamento; sem período informado, usa o mês da tela. */
  function abrirDetalhe(chave: ChaveDetalhe, mes = month, ano = year) {
    setDetalhe({ chave, mes, ano })
  }
  const [produtoModal, setProdutoModal] = useState<ProdutoParaDetalhe | null>(null)

  /**
   * Abre a ficha do produto a partir de qualquer lista da dashboard.
   *
   * As listas daqui trazem só o que a tabela mostra — a ficha precisa de
   * fornecedor, loja, promoção e etiqueta, então o resto vem sob demanda.
   *
   * Sem useCallback: nenhum consumidor a usa como dependência, e o React Compiler
   * recusava a memoização manual (deduzia `setProdutoModal` na lista vazia), o que
   * fazia ele DESISTIR de otimizar o componente inteiro — caro para não ganhar nada.
   */
  async function abrirProduto(id: string) {
    const p = await buscarProdutoParaDetalhe(id)
    if (p) setProdutoModal(p as unknown as ProdutoParaDetalhe)
  }

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
    // Nunca null: o painel sempre olha uma loja. Ver storeOptions.
    if (!v) return
    setStoreId(v)
    reload(v, month, year, grafMeses)
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

  /*
   * SEM "TODAS AS LOJAS", de propósito.
   *
   * A opção somava Campinas e Brasília e produzia o número que ninguém
   * explicava: −R$86 mil no total, Campinas positiva, Brasília zerada. Não era
   * soma de nada — as despesas não tinham loja e só apareciam ali.
   *
   * Agora a despesa é rateada pela loja de destino das peças e cada loja fecha
   * sozinha. Uma loja de cada vez, que é como ela decide.
   */
  const storeOptions = lojas.map(l => ({ value: l.id, label: l.name }))
  /* Vazio de verdade: nenhum mês do período tem faturamento nem compra. Um
   * array com seis meses zerados não é "sem dados" para o Recharts — ele
   * desenha os eixos e some com as linhas. */
  const graficoVazio = grafico.length === 0
    || grafico.every(m => !m.faturamento && !m.custoCompras)

  const isCurrentMonth = new Date().getMonth() + 1 === month && new Date().getFullYear() === year

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={`${styles.page} ${loading ? styles.loading : ''}`}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral do seu negócio"
        actions={<>
          {/*
            O seletor só existe para quem pode trocar de loja. Quem está preso a
            uma via "Todas as lojas" ali e podia clicar — o dado vinha filtrado
            do servidor, mas a tela oferecia uma escolha que não existe.
          */}
          {podeTrocarLoja && (
            <FilterDropdown
              label="Loja"
              value={storeId ?? ''}
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
        </>}
      />

      {/*
        ── Seção 1: resultado do mês + indicadores ──────────────────────────
        Layout bento: o bloco do resultado ocupa 2 colunas e as 2 linhas, e os
        outros indicadores ficam em cartões menores ao lado. A hierarquia vem do
        TAMANHO — antes eram cinco cartões idênticos, e o lucro líquido (a única
        coisa que ela abre o sistema para ver) tinha o mesmo peso do CMV.
      */}
      <div className={styles.bentoKpis}>
        {isAdmin && (
          <ResultadoDoMes
            receita={kpis.receitaBruta}
            /* Saiu de verdade no mês: compra de peça + despesa. Era
               `cmv + despesasOp`, que contava a compra duas vezes — inteira ao
               entrar, e de novo peça a peça no CMV ao sair. */
            saidas={kpis.custoCompras + kpis.despesasOp}
            resultado={kpis.lucroLiquido}
            pctReceita={`${kpis.receitaBruta > 0 ? ((kpis.lucroLiquido / kpis.receitaBruta) * 100).toFixed(0) : '0'}%`}
            periodo={`${MONTHS_PT[month - 1]} ${year}`}
            onClick={() => abrirDetalhe('resultado')}
          />
        )}

        <KpiCard
          label="Receita Bruta"
          value={fmt(kpis.receitaBruta)}
          icon={<TrendingUp size={16} />}
          color="accent"
          hint="Vendas do mês"
          onClick={() => abrirDetalhe('receita')}
        />
        {isAdmin && (
          <KpiCard
            label="Custo (CMV)"
            value={fmt(kpis.cmv)}
            icon={<ShoppingCart size={16} />}
            color="danger"
            hint="Custo dos produtos vendidos"
            onClick={() => abrirDetalhe('cmv')}
          />
        )}
        {isAdmin && (
          <KpiCard
            label="Margem das Vendas"
            value={fmt(kpis.lucroBruto)}
            icon={<DollarSign size={16} />}
            color={kpis.lucroBruto >= 0 ? 'info' : 'danger'}
            /* Receita menos CMV. NÃO é o resultado do mês — não desconta a
               compra de estoque. Rotulado como margem para não ser lido como
               lucro, que era metade da confusão. */
            hint={`${kpis.receitaBruta > 0 ? ((kpis.lucroBruto / kpis.receitaBruta) * 100).toFixed(1) : '0'}% da receita`}
            onClick={() => abrirDetalhe('lucroBruto')}
          />
        )}
        {isAdmin && (
          <KpiCard
            label="Compra de Estoque"
            value={fmt(kpis.custoCompras)}
            icon={<Package size={16} />}
            color="warning"
            hint="Peças compradas e pagas no mês"
            onClick={() => abrirDetalhe('despesas')}
          />
        )}
        {isAdmin && (
          <KpiCard
            label="Despesas Op."
            value={fmt(kpis.despesasOp)}
            icon={<TrendingDown size={16} />}
            color="warning"
            hint="Aluguel, salário, luz — fora a compra de peça"
            onClick={() => abrirDetalhe('despesas')}
          />
        )}
      </div>

      {/* ── Seção 2: Disponível para compra + Estoque, lado a lado ────────── */}
      <div className={`${styles.midRow} ${isAdmin ? '' : styles.midRowSolo}`}>

        {/* Disponível para Compra */}
        {isAdmin && (
          <div className={styles.disponivelCard}>
            <div className={styles.disponivelTopo}>
              <span className={styles.disponivelTitle}>Disponível para compra</span>
              <span className={styles.disponivelTag}>Reserva {kpis.reservePct}%</span>
            </div>
            <div className={`${styles.disponivelValue} ${kpis.disponivelCompra <= 0 ? styles.disponivelNeg : ''}`}>
              {fmt(Math.max(0, kpis.disponivelCompra))}
            </div>
            {/* A conta em uma linha só. Antes eram três blocos com um ícone de
                diamante ocupando o canto — decoração no lugar do dado. */}
            <div className={styles.disponivelConta}>
              {kpis.disponivelCompra <= 0
                ? 'Sem caixa livre para reposição neste mês'
                : <>Lucro líquido {fmt(kpis.lucroLiquido)} menos {fmt(kpis.lucroLiquido * kpis.reservePct / 100)} de reserva</>}
            </div>
          </div>
        )}

        {/* Estoque */}
        <div className={styles.stockPanel}>
          <div className={styles.panelHeader}>
            <Package size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Estoque</span>
          </div>
          <div className={styles.stockGrid}>
            <StockCard label="Total de Peças" value={estoque.totalPecas.toLocaleString('pt-BR')}
              onClick={() => abrirDetalhe('pecas')} />
            <StockCard label="SKUs Únicos" value={estoque.totalSkus.toLocaleString('pt-BR')}
              onClick={() => abrirDetalhe('skus')} />
            {isAdmin && (
              <StockCard label="Valor em Custo" value={fmt(estoque.valorEstoque)} small
                onClick={() => abrirDetalhe('custo')} />
            )}
            {isAdmin && (
              <StockCard label="Valor em Venda" value={fmt(estoque.valorEstoqueVenda)} small
                onClick={() => abrirDetalhe('venda')} />
            )}
            <StockCard
              label="Peças Paradas"
              value={estoque.pecasParadas.toLocaleString('pt-BR')}
              alert={estoque.pecasParadas > 0}
              hint={`+${estoque.staleDays} dias sem venda`}
              onClick={() => abrirDetalhe('parados')}
            />
          </div>
        </div>

      </div>

      {/* ── Seção 3: Vendas × Compras, largura total ──────────────────────── */}
      {isAdmin && (
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
            {/*
              Sem movimento nenhum no período, o gráfico virava um retângulo
              preto de 260px: eixos sem escala, três linhas coladas no zero e
              nada escrito. Todo painel vizinho já dizia "Nenhuma venda no
              período"; este era o único que só sumia.
            */}
            {graficoVazio ? (
              <div className={styles.chartEmpty}>Nenhum movimento no período</div>
            ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={grafico}
                margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={fmtEixo} width={52} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 2" />
                <Line dataKey="faturamento"  name="Faturamento"   stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--accent)' }} type="monotone" />
                <Line dataKey="custoCompras" name="Custo Compras" stroke="var(--gem-rubi)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--gem-rubi)' }} type="monotone" />
                <Line dataKey="lucroLiquido" name="Lucro Líquido" stroke="var(--gem-esmeralda)" strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 4, fill: 'var(--gem-esmeralda)' }} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── Seção 4: Gráficos de desempenho + Ranking vendedoras ────────── */}
      <div className={styles.perfRow}>

        {/* Vendas por Categoria */}
        <div className={styles.perfPanel}>
          <div className={styles.panelHeader}>
            <Award size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Vendas por categoria</span>
            <span className={styles.panelSub}>{MONTHS_PT[month - 1]} {year}</span>
          </div>
          {categorias.length === 0 ? (
            <div className={styles.chartEmpty}>Nenhuma venda no período</div>
          ) : (
            /*
             * Barras em HTML, não em recharts.
             *
             * São cinco valores e um eixo — recharts trazia grade, eixo numérico e
             * rótulo flutuante para dizer o que cabe em "nome, barra, valor". Com o
             * valor SEMPRE visível ao lado da barra, some também a necessidade do
             * clique-para-fixar que existia aqui: não há mais nada escondido.
             */
            <CategoriaBarras dados={categorias} />
          )}
        </div>

        {/* Evolução de Vendas */}
        <div className={styles.perfPanel}>
          <div className={styles.panelHeader}>
            <TrendingUp size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Evolução de vendas</span>
            <span className={styles.panelSub}>Receita dos últimos {grafMeses} meses</span>
          </div>
          <div className={styles.chartWrapSm}>
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart
                data={evolucao}
                margin={{ top: 24, right: 14, left: 0, bottom: 0 }}
                /*
                 * `accessibilityLayer={false}` é o que mata a moldura branca de vez.
                 *
                 * O recharts 3 liga essa camada por padrão e põe tabIndex=0 no <svg>;
                 * o clique dá foco e o navegador desenha o anel dele — branco porque o
                 * projeto declara `color-scheme: dark`. Anular só o `:focus` no CSS não
                 * bastava: o Chrome ainda casava `:focus-visible` no clique e o anel
                 * voltava. Sem tabIndex não há foco, e sem foco não há anel.
                 *
                 * O custo é perder o Tab para dentro do gráfico. Aceitável aqui: o mesmo
                 * faturamento está no cartão "Receita Bruta", que é um <button> de
                 * verdade e abre a lista mês a mês pelo teclado.
                 */
                accessibilityLayer={false}
              >
                <defs>
                  <linearGradient id="evolGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--gem-safira)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--gem-safira)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Grade contínua e discreta, como no protótipo: o tracejado
                    competia por atenção com a própria série. */}
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.55} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10.5 }} axisLine={false} tickLine={false}
                  tickFormatter={fmtEixo} width={52} />
                <Tooltip
                  formatter={(v: any) => [fmt(Number(v)), 'Faturamento']}
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                {/*
                  Uma bolinha por mês, e o clique vai NA BOLINHA — não no gráfico.
                  O `onClick` do AreaChart depende de o recharts ter um
                  `activeTooltipIndex` no instante do clique, e ele nem sempre tem;
                  ficava sem responder sem erro nenhum no console. Preso ao próprio
                  <circle>, o alvo do clique é o que a pessoa está vendo e mirando.

                  Clicar abre a lista de lançamentos DAQUELE mês, não do mês
                  selecionado no topo da tela — o gráfico mostra seis.
                */}
                <Area dataKey="receita" name="Faturamento" stroke="var(--gem-safira)" strokeWidth={2}
                  fill="url(#evolGrad)"
                  dot={(props: { cx?: number; cy?: number; index?: number; payload?: EvolucaoChartData }) => {
                    const p = props.payload
                    return (
                      <g
                        key={`dot-${props.index}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => p && abrirDetalhe('receita', p.mes, p.ano)}
                      >
                        {/* Alvo invisível de 13px: a bolinha visível tem 3,5px de raio
                            e acertar isso com o trackpad é sorte, não mira. */}
                        <circle cx={props.cx} cy={props.cy} r={13} fill="transparent" />
                        <circle cx={props.cx} cy={props.cy} r={3.5} fill="var(--gem-safira)" />
                      </g>
                    )
                  }}
                  activeDot={{ r: 5.5, fill: 'var(--gem-safira)', stroke: 'var(--bg-elevated)', strokeWidth: 2 }} />
                {/*
                  Só o mês de pico vem com o valor escrito, e sempre o mesmo:
                  responde "qual foi o melhor mês e quanto" sem exigir clique. O
                  clique não mexe mais nos rótulos — ele abre a lista.
                */}
                {picoEvolucao && (
                  <ReferenceDot
                    x={picoEvolucao.label} y={picoEvolucao.receita} r={5}
                    fill="var(--gem-safira)" stroke="none"
                    label={{ value: fmtCurto(picoEvolucao.receita), position: 'top', offset: 10,
                             fill: 'var(--text-primary)', fontSize: 11.5, fontWeight: 600 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Ranking Vendedoras */}
        <div className={styles.perfPanel}>
          <div className={styles.panelHeader}>
            <Users size={15} className={styles.panelIcon} />
            <span className={styles.panelTitle}>Vendedoras</span>
            <span className={styles.panelSub}>{MONTHS_PT[month - 1]} {year}</span>
          </div>
          {/*
            Tabela seca: número, nome, loja, quantidade e total.
            Saíram o avatar colorido e a seta da direita — as duas colunas que não
            carregavam dado nenhum e que, somadas, empurravam a de "Total" para fora
            do painel, obrigando a rolar na horizontal para ver justamente o número
            pelo qual a tabela está ordenada.
          */}
          {topVendedoras.length === 0 ? (
            <div className={styles.chartEmpty}>Nenhuma venda no período</div>
          ) : (
            <table className={styles.vendTabela}>
              <thead>
                <tr>
                  <th className={styles.vendThPos}>#</th>
                  <th>Vendedora</th>
                  <th className={styles.vendColLoja}>Loja</th>
                  <th className={`${styles.vendNum} ${styles.vendColVendas}`}>Vendas</th>
                  <th className={`${styles.vendNum} ${styles.vendColTotal}`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {topVendedoras.map((v, i) => (
                  <tr key={v.id} onClick={() => setVendedoraModal(v)} title="Ver detalhes da vendedora">
                    <td><span className={`${styles.vendPos} ${i === 0 ? styles.vendPosTopo : ''}`}>{i + 1}</span></td>
                    <td className={styles.vendNome}>{v.name}</td>
                    <td className={styles.vendLoja} title={v.store_name ?? undefined}>{v.store_name ?? '—'}</td>
                    <td className={styles.vendNum}>{v.nrVendas}</td>
                    <td className={`${styles.vendNum} ${styles.vendTotal}`}>{fmt(v.totalVendido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
              /* A seta já estava aqui prometendo que dava para clicar, e não dava:
                 abrir a ficha do produto era exatamente o que se esperava da linha. */
              <button
                key={p.id}
                type="button"
                className={`${styles.alertRow} ${styles.alertRowBtn}`}
                onClick={() => abrirProduto(p.id)}
              >
                <div className={styles.alertRowInfo}>
                  <span className={styles.alertRowName}>{p.name}</span>
                  <span className={styles.alertRowSub}>{p.category} · {p.code}</span>
                </div>
                <span className={styles.alertRowDays}>{p.diasParada}d</span>
                <ArrowRight size={13} className={styles.rankArrow} />
              </button>
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

        {/*
          A receber — o espelho de "Vence em 15 dias".
          Aquele é o que a loja deve; este é quem deve para a loja, com a data
          que a cliente prometeu no balcão. Atrasada não sai da lista no dia
          seguinte: é justamente quem precisa ser cobrada.
        */}
        <div className={styles.alertCard}>
          <div className={styles.alertHeader}>
            <HandCoins size={14} className={styles.alertIconWarning} />
            <span className={styles.alertTitle}>A receber hoje</span>
            <span className={styles.alertBadge} data-variant={cobrancas.length > 0 ? 'warning' : 'ok'}>
              {cobrancas.length}
            </span>
          </div>
          <div className={styles.alertList}>
            {cobrancas.length === 0 ? (
              <div className={styles.alertEmpty}>Ninguém prometeu pagar hoje</div>
            ) : cobrancas.map(c => (
              <Link key={c.sale_id} href={`/vendas?busca=${encodeURIComponent(c.cliente)}`} className={styles.alertRow}>
                <div className={styles.alertRowInfo}>
                  <span className={`${styles.alertRowName} nome-cliente`}>{c.cliente}</span>
                  <span className={`${styles.alertRowSub} ${c.atraso > 0 ? styles.cobrancaAtrasada : ''}`}>
                    {c.atraso === 0 ? 'vence hoje' : `${c.atraso} dia${c.atraso > 1 ? 's' : ''} de atraso`}
                    {' · '}{fmtDate(c.previsao)}
                  </span>
                </div>
                <span className={styles.alertRowAmount}>{fmt(c.falta)}</span>
              </Link>
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
                  <span className={`${styles.alertRowName} nome-cliente`}>{a.name}</span>
                  <span className={styles.alertRowSub}>{formatarTelefone(a.phone)} · {fmtBirthday(a.birthday)}</span>
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
          isAdmin={isAdmin}
          onClose={() => setVendedoraModal(null)}
        />
      )}

      {detalhe && (
        <DashboardDetalhe
          chave={detalhe.chave}
          storeId={storeId}
          month={detalhe.mes}
          year={detalhe.ano}
          /* Os KPIs são SEMPRE os do mês da tela. Só as chaves que fecham conta
           * com eles ('resultado', 'cmv', 'lucroBruto') os usam, e essas só são
           * abertas pelos cartões do topo, que falam do mesmo mês. O clique no
           * gráfico de evolução abre 'receita', cujo resumo é somado da própria
           * lista — por isso funciona para qualquer um dos seis meses. */
          kpis={kpis}
          estoque={estoque}
          staleDays={estoque.staleDays}
          onClose={() => setDetalhe(null)}
          onProduto={abrirProduto}
        />
      )}

      {produtoModal && (
        <ProdutoDetalheModal
          produto={produtoModal}
          isAdmin={isAdmin}
          onClose={() => setProdutoModal(null)}
        />
      )}
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/*
 * Todo cartão que mostra um total é um botão.
 *
 * Um número sozinho não se confere: para saber de onde saíam os R$ 27.439,91 de
 * despesa era preciso sair da dashboard, ir ao financeiro, filtrar o mês e somar
 * de cabeça. Clicando, a lista que forma o número abre por cima.
 */
function KpiCard({ label, value, icon, color, hint, onClick }: {
  label: string; value: string; icon: React.ReactNode
  color: 'accent' | 'success' | 'danger' | 'warning' | 'info'; hint?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={`${styles.kpiCard} ${styles[`kpi_${color}`]}`}
      onClick={onClick}
      title={`Ver o que compõe ${label.toLocaleLowerCase('pt-BR')}`}
    >
      <div className={styles.kpiIcon}>{icon}</div>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      {hint && <div className={styles.kpiHint}>{hint}</div>}
    </button>
  )
}

/**
 * Vendas por categoria — barras em HTML, valor sempre visível.
 *
 * A escala é a maior categoria, não a soma: a pergunta aqui é "qual vende mais e
 * por quanto de diferença", e normalizar pelo total esmagaria todas as barras
 * contra a esquerda quando houver uma categoria dominante.
 */
function CategoriaBarras({ dados }: { dados: CategoryChartData[] }) {
  const maior = Math.max(...dados.map(d => d.receita), 1)
  return (
    <div className={styles.catLista}>
      {dados.map((c, i) => (
        <div key={c.category} className={styles.catLinha}
             title={`${c.category} — ${fmt(c.receita)} · ${c.qtd} ${c.qtd === 1 ? 'peça' : 'peças'}`}>
          <span className={styles.catNome}>{c.category}</span>
          <span className={styles.catTrilho}>
            <span
              className={styles.catBarra}
              style={{
                // Piso de 2%: categoria com venda pequena vira uma barra de zero
                // pixel e some, o que lê como "não vendeu nada" em vez de "vendeu pouco".
                width: `${Math.max((c.receita / maior) * 100, 2)}%`,
                background: CORES_CATEGORIA[i % CORES_CATEGORIA.length],
              }}
            />
          </span>
          <span className={styles.catValor}>{fmtCurto(c.receita)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Bloco de destaque do resultado do mês.
 *
 * É o maior da tela porque é a única pergunta que a dona do negócio faz antes de
 * qualquer outra: sobrou ou faltou. E, diferente de um cartão de indicador comum,
 * ele traz a CONTA dentro de si — duas barras comparando o que entrou com o que
 * saiu — para o número não precisar de fé: dá para ver de onde ele veio sem sair
 * da tela.
 *
 * As barras dividem a mesma escala (o maior dos dois valores), senão a comparação
 * mente. É por isso que não uso duas escalas independentes aqui.
 */
function ResultadoDoMes({ receita, saidas, resultado, pctReceita, periodo, onClick }: {
  receita: number; saidas: number; resultado: number; pctReceita: string; periodo: string
  onClick?: () => void
}) {
  /*
   * Três estados, não dois.
   *
   * Mês sem movimento nenhum não é "Lucro R$ 0,00" em verde — isso é o sistema
   * dando parabéns por não ter vendido nada, e foi o que a primeira versão fazia.
   * Sem movimento, o bloco fica neutro e diz o que de fato aconteceu.
   */
  const semMovimento = receita === 0 && saidas === 0
  const negativo = resultado < 0
  const escala = Math.max(receita, saidas, 1)
  const tom = semMovimento ? 'neutro' : negativo ? 'neg' : 'pos'

  return (
    <button
      type="button"
      className={`${styles.heroCard} ${tom === 'neg' ? styles.heroNeg : tom === 'pos' ? styles.heroPos : styles.heroNeutro}`}
      onClick={onClick}
      title="Ver os lançamentos que formam o resultado"
    >
      <div className={styles.heroTopo}>
        <div>
          <div className={styles.heroLabel}>Resultado do mês</div>
          <div className={styles.heroPeriodo}>{periodo}</div>
        </div>
        {!semMovimento && (
          <span className={`${styles.heroTag} ${negativo ? styles.heroTagNeg : styles.heroTagPos}`}>
            {negativo ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
            {negativo ? 'Prejuízo' : 'Lucro'}
          </span>
        )}
      </div>

      <div className={styles.heroValor}>{fmt(resultado)}</div>
      <div className={styles.heroPct}>
        {semMovimento ? 'Nenhuma venda ou despesa registrada neste mês' : `${pctReceita} da receita`}
      </div>

      {/* A conta, visível: entrou contra saiu, na mesma escala. */}
      <div className={styles.heroBarras}>
        <div className={styles.heroLinha}>
          <span className={styles.heroLinhaRotulo}>Entrou</span>
          <div className={styles.heroTrilho}>
            <div className={`${styles.heroBarra} ${styles.heroBarraEntrou}`} style={{ width: `${(receita / escala) * 100}%` }} />
          </div>
          <span className={styles.heroLinhaValor}>{fmt(receita)}</span>
        </div>
        <div className={styles.heroLinha}>
          <span className={styles.heroLinhaRotulo}>Saiu</span>
          <div className={styles.heroTrilho}>
            <div className={`${styles.heroBarra} ${styles.heroBarraSaiu}`} style={{ width: `${(saidas / escala) * 100}%` }} />
          </div>
          <span className={styles.heroLinhaValor}>{fmt(saidas)}</span>
        </div>
      </div>
    </button>
  )
}

function StockCard({ label, value, alert, hint, small, onClick }: {
  label: string; value: string; alert?: boolean; hint?: string; small?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={`${styles.stockCard} ${alert ? styles.stockAlert : ''}`}
      onClick={onClick}
      title={`Ver os produtos por trás de ${label.toLocaleLowerCase('pt-BR')}`}
    >
      <div className={styles.stockValue} style={{ fontSize: small ? 15 : undefined }}>{value}</div>
      {/*
        Rótulo e dica num bloco só. No cartão em pé isso não muda nada; no de
        "Peças Paradas", que é deitado de propósito para pesar mais, é o que
        tira o "+30 dias sem venda" de cima da mesma linha do rótulo — era onde
        ele ficava espremido e ilegível.
      */}
      <div className={styles.stockTextos}>
        <div className={styles.stockLabel}>{label}</div>
        {hint && <div className={styles.stockHint}>{hint}</div>}
      </div>
    </button>
  )
}

