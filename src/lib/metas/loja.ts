/**
 * Meta da LOJA e comissão em faixas. Parte pura (sem Next nem Supabase), para
 * testar com `node --test`.
 *
 * Regra dita pela Eleandra na reunião de 06/10/2026:
 *
 *   - A meta é da LOJA, não da vendedora: R$ 60.000 por mês. Todas veem o
 *     mesmo número, porque ele decide a comissão de todas.
 *   - Bateu a meta: 4% de comissão para cada vendedora. Não bateu: 3%.
 *     (Sobre o mês inteiro dela: a faixa não é marginal.)
 *   - Conserto não entra (já era regra desde 09/09: a loja não ganha nele).
 *   - Troca: só a diferença entra. Cliente devolve uma peça de R$100 e leva uma
 *     de R$200: comissão sobre R$100.
 *
 * Campinas e Brasília são sistemas distintos: cada loja tem a sua meta, o seu
 * realizado e as suas faixas. Nada aqui soma as duas.
 *
 * O realizado da META usa a MESMA base da comissão (sem conserto, troca pela
 * diferença). Duas bases diferentes dariam dois "quanto falta" para a mesma
 * loja, e a vendedora não teria como saber qual vale.
 */

export interface ConfigMetaLoja {
  /** Meta padrão do mês, em R$. Vale para todo mês sem valor próprio. */
  meta: number
  /** % de comissão quando a loja bate a meta. */
  pctBateu: number
  /** % de comissão quando não bate. */
  pctNaoBateu: number
  /** Meta própria de um mês ('YYYY-MM' → R$), ex.: dezembro mais alto. */
  porMes: Record<string, number>
}

export const META_PADRAO: ConfigMetaLoja = {
  meta: 60000,
  pctBateu: 4,
  pctNaoBateu: 3,
  porMes: {},
}

/** Chave em `fv.settings`. Uma linha por loja: sem tabela nova, sem migration. */
export function chaveMetaLoja(storeId: string): string {
  return `meta_loja:${storeId}`
}

function numeroValido(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null
}

/**
 * Lê o jsonb de `settings.value`. Tolerante: campo ausente ou estragado volta
 * ao padrão daquele campo, e não derruba a tela de venda por causa de um painel.
 */
export function lerConfigMetaLoja(valor: unknown): ConfigMetaLoja {
  if (!valor || typeof valor !== 'object') return { ...META_PADRAO, porMes: {} }
  const v = valor as Record<string, unknown>
  const porMes: Record<string, number> = {}
  if (v.porMes && typeof v.porMes === 'object') {
    for (const [mes, valorMes] of Object.entries(v.porMes as Record<string, unknown>)) {
      const n = numeroValido(valorMes, 0, 1e9)
      if (isMesValido(mes) && n !== null) porMes[mes] = n
    }
  }
  return {
    meta: numeroValido(v.meta, 0, 1e9) ?? META_PADRAO.meta,
    pctBateu: numeroValido(v.pctBateu, 0, 100) ?? META_PADRAO.pctBateu,
    pctNaoBateu: numeroValido(v.pctNaoBateu, 0, 100) ?? META_PADRAO.pctNaoBateu,
    porMes,
  }
}

export function isMesValido(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

/** A meta que vale no mês: a própria do mês, senão a padrão. */
export function metaDoMes(cfg: ConfigMetaLoja, mes: string): number {
  return cfg.porMes[mes] ?? cfg.meta
}

/**
 * Quanto de UMA venda conta para meta e comissão.
 *
 * `total` é o que a venda cobrou pelas peças que SAÍRAM; a peça devolvida na
 * troca entra como crédito (`exchange_items` returned), e o conserto está
 * dentro do total. Nunca negativa: troca em que a cliente leva menos do que
 * devolveu não tira comissão de ninguém.
 */
export function baseDaVenda(total: number, conserto: number, creditoTroca: number): number {
  return Math.max(0, arred(total - conserto - creditoTroca))
}

/**
 * Início e fim do mês em horário de Brasília, para filtrar `sale_date`.
 *
 * O `monthBounds` antigo usava o fuso do SERVIDOR (UTC no container): venda
 * depois das 21h do último dia caía no mês seguinte. O Brasil não tem horário
 * de verão desde 2019, então -03:00 é fixo.
 */
export function limitesDoMesSP(mes: string): { inicio: string; fim: string } {
  const [y, m] = mes.split('-').map(Number)
  const prox = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { inicio: `${mes}-01T00:00:00-03:00`, fim: `${prox}-01T00:00:00-03:00` }
}

export function diasNoMes(mes: string): number {
  const [y, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * Dias que ainda dá para vender, CONTANDO HOJE: no dia 31 resta 1 (o próprio
 * dia), não zero. `hoje` é 'YYYY-MM-DD' no fuso de Brasília (todaySP).
 * Mês que já passou: 0. Mês futuro: o mês inteiro.
 */
export function diasRestantes(mes: string, hoje: string): number {
  const mesHoje = hoje.slice(0, 7)
  if (mesHoje > mes) return 0
  if (mesHoje < mes) return diasNoMes(mes)
  return diasNoMes(mes) - Number(hoje.slice(8, 10)) + 1
}

export interface ProgressoLoja {
  mes: string
  meta: number
  realizado: number
  /** 0 quando já bateu. */
  falta: number
  /** % atingido; passa de 100 quando supera. 0 sem meta. */
  pct: number
  bateu: boolean
  diasRestantes: number
  /** Quanto vender por dia, de hoje ao fim do mês, para bater. 0 se já bateu ou o mês acabou. */
  mediaDiaria: number
  /** % de comissão que vale HOJE (a faixa pode mudar até o fim do mês). */
  pctComissao: number
  pctBateu: number
  pctNaoBateu: number
}

export function progressoDaLoja(cfg: ConfigMetaLoja, mes: string, realizado: number, hoje: string): ProgressoLoja {
  const meta = metaDoMes(cfg, mes)
  const real = arred(realizado)
  const bateu = meta > 0 && real >= meta
  const falta = meta > 0 ? Math.max(0, arred(meta - real)) : 0
  const dias = diasRestantes(mes, hoje)
  return {
    mes,
    meta,
    realizado: real,
    falta,
    pct: meta > 0 ? (real / meta) * 100 : 0,
    bateu,
    diasRestantes: dias,
    mediaDiaria: falta > 0 && dias > 0 ? arred(falta / dias) : 0,
    pctComissao: bateu ? cfg.pctBateu : cfg.pctNaoBateu,
    pctBateu: cfg.pctBateu,
    pctNaoBateu: cfg.pctNaoBateu,
  }
}

/** O que as telas de entrada recebem: o painel, ou o aviso de que falhou. */
export interface PainelMeta {
  progresso: ProgressoLoja | null
  erro: string | null
}

export interface VendaParaMeta {
  id: string
  seller_id: string | null
  total: number
}

export interface ComissaoVendedora {
  sellerId: string
  vendas: number
  base: number
  pct: number
  comissao: number
}

/**
 * Soma a loja e reparte a comissão. Venda sem vendedora conta para a meta da
 * loja (o dinheiro entrou), mas não gera comissão para ninguém.
 */
export function apurarMes(
  vendas: VendaParaMeta[],
  consertoPorVenda: Map<string, number>,
  creditoPorVenda: Map<string, number>,
  cfg: ConfigMetaLoja,
  mes: string,
  hoje: string,
): { progresso: ProgressoLoja; porVendedora: ComissaoVendedora[]; semVendedora: number } {
  let realizado = 0
  let semVendedora = 0
  const porSeller = new Map<string, { vendas: number; base: number }>()
  for (const v of vendas) {
    const base = baseDaVenda(Number(v.total), consertoPorVenda.get(v.id) ?? 0, creditoPorVenda.get(v.id) ?? 0)
    realizado += base
    if (!v.seller_id) { semVendedora += base; continue }
    const p = porSeller.get(v.seller_id) ?? { vendas: 0, base: 0 }
    porSeller.set(v.seller_id, { vendas: p.vendas + 1, base: p.base + base })
  }
  const progresso = progressoDaLoja(cfg, mes, realizado, hoje)
  const porVendedora = [...porSeller.entries()].map(([sellerId, p]) => ({
    sellerId,
    vendas: p.vendas,
    base: arred(p.base),
    pct: progresso.pctComissao,
    comissao: arred(p.base * progresso.pctComissao / 100),
  }))
  return { progresso, porVendedora, semVendedora: arred(semVendedora) }
}

function arred(n: number): number {
  return Math.round(n * 100) / 100
}
