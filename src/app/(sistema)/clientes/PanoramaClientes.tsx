'use client'

import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import type { CustomerWithStats } from './page'
import styles from './PanoramaClientes.module.css'

/**
 * De onde vem o faturamento — o que a tabela não conta.
 *
 * A tabela responde "quem é a cliente X". Isto responde "de quem vem o meu
 * dinheiro", que é a pergunta que decide a quem dar atenção.
 *
 * O cálculo é Pareto aplicado ao caixa: ordena por quanto cada uma gastou e corta
 * em 70% e 90% do faturamento acumulado. Usei acumulado em vez de "as 20 maiores"
 * porque o corte se ajusta sozinho conforme a base cresce.
 *
 * Existia um segundo painel aqui — "há mais tempo sem voltar", com um botão
 * "chamar estas 6 no Disparos". Foi REMOVIDO em 13/08/2026: o botão navegava para
 * /disparos passando os ids na URL, mas o outro lado nunca foi implementado, então
 * a seleção se perdia no caminho. Botão que promete e não cumpre é pior que botão
 * nenhum. Volta quando o disparo aceitar uma lista pré-selecionada.
 */

interface Props {
  customers: CustomerWithStats[]
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/*
 * Os grupos têm NOME, não letra.
 *
 * A primeira versão rotulava A / B / C — é a nomenclatura de curva ABC, que é
 * jargão de gestão. Quem abre a tela não tem como saber que "A" quer dizer "as que
 * sustentam o faturamento": a letra não informa nada sozinha, e obriga a decorar
 * uma legenda. O nome carrega o significado; a cor só reforça.
 *
 * A ordem também importa: quem mais gasta primeiro, porque é a linha que a dona do
 * negócio precisa ver antes de qualquer outra.
 */
const FAIXAS = [
  {
    chave: 'A',
    nome: 'As que mais gastam',
    ajuda: 'Poucas clientes, a maior parte do faturamento. São as que não podem sumir.',
    cor: 'var(--gem-esmeralda)',
  },
  {
    chave: 'B',
    nome: 'Compram com frequência',
    ajuda: 'O meio da base — compram bem, mas não são as maiores.',
    cor: 'var(--gem-safira)',
  },
  {
    chave: 'C',
    nome: 'Compram pouco',
    ajuda: 'Muitas clientes somando pouco. Compra ocasional ou de valor baixo.',
    cor: 'var(--gem-perola)',
  },
] as const

export default function PanoramaClientes({ customers }: Props) {
  const abc = useMemo(() => {
    const comGasto = customers.filter(c => c.total_spent > 0).sort((a, b) => b.total_spent - a.total_spent)
    const total = comGasto.reduce((s, c) => s + c.total_spent, 0)
    if (!total) return null

    // `min`/`max` guardam quanto gastou a menor e a maior cliente do grupo — é o
    // que transforma "as que mais gastam" em algo concreto ("de R$ 560 a R$ 2.715").
    const vazio = () => ({ n: 0, valor: 0, min: Infinity, max: 0 })
    const faixas = { A: vazio(), B: vazio(), C: vazio() }
    let acumulado = 0
    for (const c of comGasto) {
      acumulado += c.total_spent
      const pctAcumulado = acumulado / total
      // O corte olha o acumulado ANTES desta cliente, senão a primeira já estouraria
      // 70% em bases pequenas e o primeiro grupo ficaria com uma pessoa só.
      const faixa = pctAcumulado - c.total_spent / total < 0.7 ? 'A' : pctAcumulado - c.total_spent / total < 0.9 ? 'B' : 'C'
      faixas[faixa].n++
      faixas[faixa].valor += c.total_spent
      faixas[faixa].min = Math.min(faixas[faixa].min, c.total_spent)
      faixas[faixa].max = Math.max(faixas[faixa].max, c.total_spent)
    }
    return { total, faixas, comGastoN: comGasto.length, semCompra: customers.length - comGasto.length }
  }, [customers])

  if (!abc) return null

  return (
    <div className={styles.painelUnico}>
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
            if (d.n === 0) return null
            const pctValor = abc.total ? (d.valor / abc.total) * 100 : 0
            const pctClientes = abc.comGastoN ? (d.n / abc.comGastoN) * 100 : 0
            // "de R$ 120 a R$ 2.715 cada" — torna concreto o que separa um grupo do
            // outro. Com uma cliente só, mostra o valor dela em vez de um intervalo.
            const faixaValor = d.n === 1
              ? `${fmt(d.max)}`
              : `${fmt(d.min)} a ${fmt(d.max)} cada`
            return (
              <div key={f.chave} className={styles.faixa} title={f.ajuda}>
                <div className={styles.faixaTopo}>
                  <span className={styles.faixaPonto} style={{ background: f.cor }} aria-hidden="true" />
                  <span className={styles.faixaNome}>{f.nome}</span>
                  <span className={styles.faixaValor}>{fmt(d.valor)}</span>
                </div>

                <div className={styles.barraTrilho}>
                  <div className={styles.barra} style={{ width: `${pctValor}%`, background: f.cor }} />
                </div>

                <div className={styles.faixaRodape}>
                  <span>
                    <strong>{d.n}</strong> cliente{d.n !== 1 ? 's' : ''} ({pctClientes.toFixed(0)}% da base)
                    {' · '}{faixaValor}
                  </span>
                  <span className={styles.faixaPct}>{pctValor.toFixed(0)}% do faturamento</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* A conclusão que a tela existe para dar, escrita por extenso: sem ela, a
            pessoa vê três barras e precisa fazer a leitura sozinha. */}
        {abc.faixas.A.n > 0 && (
          <p className={styles.conclusao}>
            <strong>{abc.faixas.A.n} cliente{abc.faixas.A.n !== 1 ? 's' : ''}</strong>
            {' '}trazem{' '}
            <strong>{((abc.faixas.A.valor / abc.total) * 100).toFixed(0)}%</strong>
            {' '}de tudo que você fatura.
          </p>
        )}

        {abc.semCompra > 0 && (
          <footer className={styles.rodapePainel}>
            {abc.semCompra} cadastrada{abc.semCompra !== 1 ? 's' : ''} sem nenhuma compra registrada
          </footer>
        )}
      </section>

    </div>
  )
}
