'use client'

import { useMemo } from 'react'
import { TrendingUp, PieChart } from 'lucide-react'
import type { TransactionRow } from './actions'
import styles from './PanoramaFinanceiro.module.css'

/**
 * Panorama financeiro — o que a tabela de lançamentos não conta.
 *
 * A tabela responde "que lançamento foi esse". Estas duas visões respondem as duas
 * perguntas que o módulo existe para responder:
 *
 *   1. Como o faturamento vira lucro?  → cascata
 *   2. Para onde o dinheiro vai?       → barras por categoria
 *
 * A cascata mostra a subtração acontecendo, com cada barra partindo de onde a
 * anterior terminou. É o que torna visível a proporção entre o que entra e o que
 * sai — coisa que quatro cartões de KPI lado a lado não mostram, porque números
 * soltos não têm escala entre si.
 *
 * Usa só o que a tela já carregou (as transações do período). Nenhuma consulta
 * nova: cada ida ao Supabase custa ~190ms de rede, e não vale gastar isso para
 * recalcular no banco o que dá para somar aqui.
 */

interface Props {
  transactions: TransactionRow[]
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/** Paleta de gemas — cor que INFORMA a natureza do valor, não decoração. */
const COR_ENTRADA = 'var(--gem-esmeralda)'
const COR_SAIDA   = 'var(--gem-rubi)'
const COR_PENDENTE = 'var(--gem-topazio)'

export default function PanoramaFinanceiro({ transactions }: Props) {
  const dados = useMemo(() => {
    const pagas = transactions.filter(t => t.status === 'completed')
    const entradas = pagas.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const saidas   = pagas.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    const aPagar   = transactions
      .filter(t => t.type === 'expense' && t.status === 'pending')
      .reduce((s, t) => s + t.amount, 0)
    const saldo = entradas - saidas

    // Categorias de SAÍDA, que é onde a pergunta "para onde vai" faz sentido.
    const porCategoria = new Map<string, number>()
    for (const t of pagas) {
      if (t.type !== 'expense') continue
      const k = t.category || 'sem categoria'
      porCategoria.set(k, (porCategoria.get(k) ?? 0) + t.amount)
    }
    const categorias = [...porCategoria.entries()]
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)

    // Top 6 e o resto agrupado: uma lista de 15 categorias com 1% cada não informa.
    const topo = categorias.slice(0, 6)
    const resto = categorias.slice(6)
    if (resto.length) {
      topo.push({ nome: `outras ${resto.length}`, valor: resto.reduce((s, c) => s + c.valor, 0) })
    }

    return { entradas, saidas, saldo, aPagar, categorias: topo, temDados: entradas > 0 || saidas > 0 }
  }, [transactions])

  if (!dados.temDados) return null

  // A escala da cascata é o maior valor absoluto em jogo — assim as barras são
  // comparáveis entre si, que é o ponto de usar cascata em vez de quatro cartões.
  const escala = Math.max(dados.entradas, dados.saidas, Math.abs(dados.saldo), 1)
  const larg = (v: number) => `${Math.min(100, (Math.abs(v) / escala) * 100)}%`

  const etapas = [
    { rotulo: 'Entradas', valor: dados.entradas, cor: COR_ENTRADA, sinal: '' },
    { rotulo: 'Saídas',   valor: dados.saidas,   cor: COR_SAIDA,   sinal: '−' },
    ...(dados.aPagar > 0
      ? [{ rotulo: 'A pagar', valor: dados.aPagar, cor: COR_PENDENTE, sinal: '−', pendente: true }]
      : []),
  ]

  const totalCategorias = dados.categorias.reduce((s, c) => s + c.valor, 0)

  return (
    <div className={styles.grade}>
      {/* ─── Cascata ─── */}
      <section className={styles.painel}>
        <header className={styles.cabecalho}>
          <TrendingUp size={14} />
          <span className={styles.titulo}>Como o faturamento vira lucro</span>
        </header>

        <div className={styles.etapas}>
          {etapas.map(e => (
            <div key={e.rotulo} className={styles.etapa}>
              <span className={styles.etapaRotulo}>
                {e.rotulo}
                {'pendente' in e && <span className={styles.etapaAviso}> ainda não pago</span>}
              </span>
              <div className={styles.etapaTrilho}>
                <div
                  className={styles.etapaBarra}
                  style={{
                    width: larg(e.valor),
                    background: e.cor,
                    // Pendente sai listrado: é compromisso, não saída realizada.
                    opacity: 'pendente' in e ? 0.55 : 1,
                  }}
                />
              </div>
              <span className={styles.etapaValor} style={{ color: e.cor }}>
                {e.sinal} {fmt(e.valor)}
              </span>
            </div>
          ))}

          <div className={`${styles.etapa} ${styles.etapaResultado}`}>
            <span className={styles.etapaRotulo}>Resultado</span>
            <div className={styles.etapaTrilho}>
              <div
                className={styles.etapaBarra}
                style={{
                  width: larg(dados.saldo),
                  background: dados.saldo >= 0 ? COR_ENTRADA : COR_SAIDA,
                }}
              />
            </div>
            <span
              className={`${styles.etapaValor} ${styles.etapaValorForte}`}
              style={{ color: dados.saldo >= 0 ? COR_ENTRADA : COR_SAIDA }}
            >
              {fmt(dados.saldo)}
            </span>
          </div>
        </div>

        {dados.entradas > 0 && (
          <footer className={styles.rodapePainel}>
            Margem de {((dados.saldo / dados.entradas) * 100).toFixed(0)}% sobre o que entrou
          </footer>
        )}
      </section>

      {/* ─── Para onde vai ─── */}
      <section className={styles.painel}>
        <header className={styles.cabecalho}>
          <PieChart size={14} />
          <span className={styles.titulo}>Para onde o dinheiro vai</span>
          <span className={styles.total}>{fmt(totalCategorias)}</span>
        </header>

        {dados.categorias.length === 0 ? (
          <div className={styles.vazio}>Nenhuma saída paga no período.</div>
        ) : (
          <div className={styles.categorias}>
            {dados.categorias.map(c => {
              const pct = totalCategorias ? (c.valor / totalCategorias) * 100 : 0
              return (
                <div key={c.nome} className={styles.categoria}>
                  <span className={styles.categoriaNome} title={c.nome}>
                    {c.nome.charAt(0).toUpperCase() + c.nome.slice(1).replace(/_/g, ' ')}
                  </span>
                  <div className={styles.categoriaTrilho}>
                    <div className={styles.categoriaBarra} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.categoriaValor}>{fmt(c.valor)}</span>
                  <span className={styles.categoriaPct}>{pct.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
