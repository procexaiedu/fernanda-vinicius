'use client'

import { useMemo } from 'react'
import { Send, TrendingUp, Clock } from 'lucide-react'
import type { CustomerWithStats } from './page'
import { formatarTelefone } from '@/lib/telefone'
import styles from './PanoramaClientes.module.css'

/**
 * Panorama de clientes — o que a tabela não conta.
 *
 * A tabela responde "quem é a cliente X". Estas duas visões respondem as duas
 * perguntas que a dona do negócio faz de verdade:
 *
 *   1. De onde vem meu faturamento?  → curva ABC
 *   2. Quem estava comprando e parou? → cartões de recuperação
 *
 * A curva ABC é a regra de Pareto aplicada ao caixa: ordena as clientes por quanto
 * gastaram e corta em 70% / 90% do faturamento acumulado. A faixa A é onde mora o
 * dinheiro — costuma ser uma fração pequena das clientes, e é ela que justifica
 * atendimento diferenciado. Escolhi acumulado em vez de "as 20 maiores" porque o
 * corte se ajusta sozinho conforme a base cresce.
 *
 * Os cartões de recuperação existem porque 735 das 760 clientes estão inativas.
 * Uma lista de 735 nomes não é acionável; as 6 que MAIS gastaram entre as inativas
 * são. Elas vão ordenadas por valor gasto, não por tempo parado: recuperar quem
 * gastou R$ 704 vale mais que quem gastou R$ 20, mesmo que a segunda tenha sumido
 * antes.
 */

interface Props {
  customers: CustomerWithStats[]
  inactiveDays: number
  /** Leva a seleção para o módulo de disparos. */
  onDisparar?: (ids: string[]) => void
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

const FAIXAS = [
  { chave: 'A', rotulo: 'A', cor: 'var(--gem-esmeralda)', descricao: 'primeiros 70% do faturamento' },
  { chave: 'B', rotulo: 'B', cor: 'var(--gem-safira)',    descricao: 'dos 70% aos 90%' },
  { chave: 'C', rotulo: 'C', cor: 'var(--gem-perola)',    descricao: 'últimos 10%' },
] as const

export default function PanoramaClientes({ customers, inactiveDays, onDisparar }: Props) {
  const abc = useMemo(() => {
    const comGasto = customers.filter(c => c.total_spent > 0).sort((a, b) => b.total_spent - a.total_spent)
    const total = comGasto.reduce((s, c) => s + c.total_spent, 0)
    if (!total) return null

    const faixas = { A: { n: 0, valor: 0 }, B: { n: 0, valor: 0 }, C: { n: 0, valor: 0 } }
    let acumulado = 0
    for (const c of comGasto) {
      acumulado += c.total_spent
      const pctAcumulado = acumulado / total
      // O corte olha o acumulado ANTES desta cliente, senão a primeira já estouraria
      // 70% em bases pequenas e a faixa A ficaria com uma pessoa só.
      const faixa = pctAcumulado - c.total_spent / total < 0.7 ? 'A' : pctAcumulado - c.total_spent / total < 0.9 ? 'B' : 'C'
      faixas[faixa].n++
      faixas[faixa].valor += c.total_spent
    }
    return { total, faixas, comGastoN: comGasto.length, semCompra: customers.length - comGasto.length }
  }, [customers])

  /*
   * Quem está há mais tempo sem voltar, entre quem JÁ COMPROU.
   *
   * A primeira versão filtrava por `dias >= inactiveDays` (90). Como a última venda
   * registrada foi há 21 dias, ninguém cruzava o limite e o painel abria vazio —
   * um painel que às vezes não mostra nada não serve para nada. Agora o critério é
   * relativo: sempre lista as 6 que estão há mais tempo paradas, e marca em
   * vermelho só as que de fato passaram do limite configurado.
   *
   * Ordena por TEMPO parado, não por valor: a pergunta aqui é "quem está sumindo",
   * e a curva ABC ao lado já responde "quem vale mais".
   */
  const recuperar = useMemo(() => {
    return customers
      .filter(c => c.total_spent > 0)
      .map(c => ({ ...c, dias: diasDesde(c.last_sale_date) }))
      .sort((a, b) => (b.dias ?? Number.MAX_SAFE_INTEGER) - (a.dias ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 6)
  }, [customers])

  if (!abc) return null

  return (
    <div className={styles.grade}>
      {/* ─── Curva ABC ─── */}
      <section className={styles.painel}>
        <header className={styles.cabecalho}>
          <TrendingUp size={14} />
          <span className={styles.titulo}>De onde vem o faturamento</span>
          <span className={styles.total}>{fmt(abc.total)}</span>
        </header>

        <div className={styles.faixas}>
          {FAIXAS.map(f => {
            const d = abc.faixas[f.chave]
            const pctValor = abc.total ? (d.valor / abc.total) * 100 : 0
            const pctClientes = abc.comGastoN ? (d.n / abc.comGastoN) * 100 : 0
            return (
              <div key={f.chave} className={styles.faixa}>
                <span className={styles.faixaRotulo} style={{ background: f.cor }}>{f.rotulo}</span>
                <div className={styles.faixaCorpo}>
                  <div className={styles.faixaLinha}>
                    <span className={styles.faixaClientes}>
                      {d.n} cliente{d.n !== 1 ? 's' : ''}
                      <span className={styles.faixaPctClientes}> · {pctClientes.toFixed(0)}% da base</span>
                    </span>
                    <span className={styles.faixaValor}>{fmt(d.valor)}</span>
                  </div>
                  <div className={styles.barraTrilho} title={f.descricao}>
                    <div className={styles.barra} style={{ width: `${pctValor}%`, background: f.cor }} />
                  </div>
                  <span className={styles.faixaPct}>{pctValor.toFixed(0)}% do faturamento</span>
                </div>
              </div>
            )
          })}
        </div>

        {abc.semCompra > 0 && (
          <footer className={styles.rodapePainel}>
            {abc.semCompra} cadastrada{abc.semCompra !== 1 ? 's' : ''} sem nenhuma compra registrada
          </footer>
        )}
      </section>

      {/* ─── Recuperação ─── */}
      <section className={styles.painel}>
        <header className={styles.cabecalho}>
          <Clock size={14} />
          <span className={styles.titulo}>Há mais tempo sem voltar</span>
          <span className={styles.subtituloCabecalho}>vermelho = +{inactiveDays} dias</span>
        </header>

        {recuperar.length === 0 ? (
          <div className={styles.vazio}>Nenhuma compra registrada ainda.</div>
        ) : (
          <>
            <div className={styles.cartoes}>
              {recuperar.map(c => {
                const passouDoLimite = c.dias === null || c.dias >= inactiveDays
                return (
                  <div key={c.id} className={`${styles.cartao} fv-lift`}>
                    <span className={styles.avatar}>{iniciais(c.name)}</span>
                    <div className={styles.cartaoInfo}>
                      <span className={styles.cartaoNome} title={c.name}>{c.name}</span>
                      <span className={styles.cartaoMeta}>{formatarTelefone(c.phone)}</span>
                    </div>
                    <div className={styles.cartaoNumeros}>
                      <span className={styles.cartaoValor}>{fmt(c.total_spent)}</span>
                      <span className={passouDoLimite ? styles.cartaoDias : styles.cartaoDiasOk}>
                        {c.dias === null ? 'nunca voltou' : `há ${c.dias} dias`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {onDisparar && (
              <button
                type="button"
                className={styles.botaoDisparo}
                onClick={() => onDisparar(recuperar.map(c => c.id))}
              >
                <Send size={13} />
                Chamar estas {recuperar.length} no Disparos

              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
