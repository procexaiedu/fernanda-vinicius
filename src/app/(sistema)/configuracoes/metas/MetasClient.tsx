'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Check, RotateCcw, Coins, Loader2 } from 'lucide-react'
import { monthLabel } from '@/lib/metas/compute'
import type { ConfigMetaLoja } from '@/lib/metas/loja'
import { salvarMetaDaLoja, salvarMetaDoMes, gerarComissoesDoMes } from './actions'
import styles from './MetasClient.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'

export interface LinhaComissao {
  sellerId: string
  nome: string
  vendas: number
  /** Base da comissão: vendas sem conserto, troca pela diferença. */
  base: number
  pct: number
  comissao: number
  /** Já lançada no Financeiro neste mês, e se já foi paga. */
  lancada: { valor: number; paga: boolean } | null
}

interface Props {
  mes: string
  mesAtual: string
  config: ConfigMetaLoja
  metaDoMes: number
  temMetaPropria: boolean
  linhas: LinhaComissao[]
  semVendedora: number
  bateu: boolean
}

function deslocarMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const fmtBRL = formatarDinheiro
const fmtPct = (n: number) => `${String(n).replace('.', ',')}%`

export default function MetasClient({ mes, mesAtual, config, metaDoMes, temMetaPropria, linhas, semVendedora, bateu }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [gerando, setGerando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function irPara(m: string) {
    startTransition(() => router.push(`/configuracoes/metas?month=${m}`))
  }

  async function gerar() {
    setGerando(true)
    setMsg(null)
    try {
      const res = await gerarComissoesDoMes(mes)
      if (!res.success) { setMsg(`Erro: ${res.error}`); return }
      setMsg(`${res.total} comissão(ões): ${res.created} lançada(s), ${res.updated} atualizada(s), ${res.removed} removida(s)`
        + (res.jaPagas ? `, ${res.jaPagas} já paga(s) ficou(aram) como estava(m).` : '.'))
      router.refresh()
    } catch (e) {
      setMsg(mensagemDeErroAoSalvar(e))
    } finally {
      setGerando(false)
    }
  }

  const totalComissao = linhas.reduce((s, l) => s + l.comissao, 0)

  return (
    <div className={styles.container}>
      <ConfigLoja config={config} onSalvo={() => router.refresh()} />

      <div className={styles.contextBar}>
        <div className={styles.monthNav}>
          <button className={styles.navBtn} onClick={() => irPara(deslocarMes(mes, -1))} title="Mês anterior">
            <ChevronLeft size={16} />
          </button>
          <span className={styles.monthLabel}>{monthLabel(mes)}</span>
          <button className={styles.navBtn} onClick={() => irPara(deslocarMes(mes, 1))} title="Próximo mês" disabled={mes >= mesAtual}>
            <ChevronRight size={16} />
          </button>
        </div>

        <MetaDoMes key={mes} mes={mes} valor={metaDoMes} propria={temMetaPropria} padrao={config.meta} onSalvo={() => router.refresh()} />

        <button className={styles.gerarBtn} onClick={gerar} disabled={gerando || linhas.length === 0}>
          {gerando ? <Loader2 size={15} className={styles.spin} /> : <Coins size={15} />}
          {gerando ? 'Lançando…' : 'Lançar comissões no Financeiro'}
        </button>
      </div>

      <p className={styles.hint}>
        Base da comissão: vendas do mês <strong>sem conserto</strong>, e na <strong>troca só a diferença</strong>.
        {' '}A loja {bateu ? <strong>bateu</strong> : <>ainda <strong>não bateu</strong></>} a meta de {monthLabel(mes)}:
        {' '}comissão de <strong>{fmtPct(bateu ? config.pctBateu : config.pctNaoBateu)}</strong> para todas.
        {mes === mesAtual && !bateu && <> Se bater até o fim do mês, sobe para {fmtPct(config.pctBateu)} sobre o mês inteiro.</>}
      </p>

      {msg && <div className={styles.genMsg}>{msg}</div>}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Vendedora</th>
              <th className={`${styles.numCol} col-num`}>Vendas</th>
              <th className={`${styles.numCol} col-num`}>Base</th>
              <th className={`${styles.numCol} col-num`}>%</th>
              <th className={`${styles.numCol} col-num`}>Comissão</th>
              <th className={`${styles.numCol} col-num`}>No Financeiro</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr><td colSpan={6} className={styles.empty}>Nenhuma venda com vendedora neste mês.</td></tr>
            ) : linhas.map(l => (
              <tr key={l.sellerId}>
                <td><span className={styles.sellerName}>{l.nome}</span></td>
                <td className={`${styles.numCol} col-num`}>{l.vendas}</td>
                <td className={`${styles.numCol} col-num`}><span className={styles.realized}>{fmtBRL(l.base)}</span></td>
                <td className={`${styles.numCol} col-num`}>{fmtPct(l.pct)}</td>
                <td className={`${styles.numCol} col-num`}><span className={styles.commission}>{fmtBRL(l.comissao)}</span></td>
                <td className={`${styles.numCol} col-num`}>
                  {l.lancada
                    ? <span className={`${styles.commission} ${styles.commissionPaid}`}>
                        {fmtBRL(l.lancada.valor)}{l.lancada.paga ? ' (paga)' : ''}
                        {Math.abs(l.lancada.valor - l.comissao) < 0.01 && <Check size={12} />}
                      </span>
                    : <span className={styles.noGoal}>não lançada</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {linhas.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} className={styles.footLabel}>
                  Total{semVendedora > 0 && <span className={styles.salesCount}> · {fmtBRL(semVendedora)} em vendas sem vendedora (contam na meta, sem comissão)</span>}
                </td>
                <td className={`${styles.numCol} col-num`}><span className={styles.commission}>{fmtBRL(totalComissao)}</span></td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/** Meta padrão e as duas faixas. Vale para todo mês sem meta própria. */
function ConfigLoja({ config, onSalvo }: { config: ConfigMetaLoja; onSalvo: () => void }) {
  const [meta, setMeta] = useState(String(config.meta))
  const [pctBateu, setPctBateu] = useState(String(config.pctBateu))
  const [pctNao, setPctNao] = useState(String(config.pctNaoBateu))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const sujo = Number(meta) !== config.meta || Number(pctBateu) !== config.pctBateu || Number(pctNao) !== config.pctNaoBateu

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const res = await salvarMetaDaLoja(Number(meta || 0), Number(pctBateu || 0), Number(pctNao || 0))
      if (res.success) onSalvo()
      else setErro(res.error ?? 'Não foi possível salvar.')
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className={styles.configBox}>
      <label className={styles.configField}>
        <span>Meta mensal da loja (R$)</span>
        <input type="number" min={0} step={1000} className={styles.input} value={meta} onChange={e => setMeta(e.target.value)} />
      </label>
      <label className={styles.configField}>
        <span>Comissão se bater (%)</span>
        <input type="number" min={0} max={100} step={0.5} className={`${styles.input} ${styles.inputSmall}`} value={pctBateu} onChange={e => setPctBateu(e.target.value)} />
      </label>
      <label className={styles.configField}>
        <span>Se não bater (%)</span>
        <input type="number" min={0} max={100} step={0.5} className={`${styles.input} ${styles.inputSmall}`} value={pctNao} onChange={e => setPctNao(e.target.value)} />
      </label>
      {sujo && (
        <button className={styles.saveBtn} onClick={salvar} disabled={salvando} title="Salvar">
          {salvando ? <Loader2 size={14} className={styles.spin} /> : <Check size={14} />}
        </button>
      )}
      {erro && <span className={styles.erro}>{erro}</span>}
    </div>
  )
}

/** Meta própria de um mês (ex.: dezembro). Desfazer volta para a padrão. */
function MetaDoMes({ mes, valor, propria, padrao, onSalvo }: {
  mes: string; valor: number; propria: boolean; padrao: number; onSalvo: () => void
}) {
  const [v, setV] = useState(String(valor))
  const [salvando, setSalvando] = useState(false)

  async function salvar(novo: number | null) {
    setSalvando(true)
    try {
      const res = await salvarMetaDoMes(mes, novo)
      if (res.success) onSalvo()
      else alert(res.error)
    } catch (e) {
      alert(mensagemDeErroAoSalvar(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className={styles.metaMes}>
      <span className={styles.metaMesLabel}>Meta de {monthLabel(mes)}</span>
      <input type="number" min={0} step={1000} className={styles.input} value={v} onChange={e => setV(e.target.value)} />
      {propria && <span className={styles.overrideBadge}>só deste mês</span>}
      {Number(v) !== valor && (
        <button className={styles.saveBtn} onClick={() => salvar(Number(v || 0))} disabled={salvando} title="Usar este valor só neste mês">
          {salvando ? <Loader2 size={14} className={styles.spin} /> : <Check size={14} />}
        </button>
      )}
      {propria && (
        <button className={styles.resetBtn} onClick={() => salvar(null)} disabled={salvando} title={`Voltar para a meta padrão (${formatarDinheiro(padrao)})`}>
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  )
}
