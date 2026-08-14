'use client'

import { useMemo, useState } from 'react'
import { TrendingUp, ChevronDown } from 'lucide-react'
import type { CustomerWithStats, VendaAvulsa } from './page'
import { formatarTelefone } from '@/lib/telefone'
import styles from './PanoramaClientes.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'

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
  vendaAvulsa: VendaAvulsa
}

/* Esta cópia local tinha `maximumFractionDigits: 0` e engolia os centavos, enquanto
 * o resto do sistema mostrava o valor cheio — a mesma venda aparecia como R$ 1.062
 * aqui e R$ 1.062,40 na tabela ao lado. Agora vem do lugar único. */
const fmt = formatarDinheiro

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
/*
 * O tom importa: são clientes reais da loja, e a tela pode ser aberta na frente
 * delas. Os nomes DESCREVEM a posição no faturamento, sem adjetivo de julgamento
 * — "Gastam pouco" virou "Demais clientes", que diz a mesma coisa sem soar como
 * avaliação da pessoa. Vale também para os textos de motivo, mais abaixo.
 *
 * Nomeados por VALOR, não por frequência: a divisão é por faturamento acumulado, e
 * no dado real nenhuma cliente comprou mais de uma vez (25 clientes, 25 compras).
 */
const FAIXAS = [
  {
    chave: 'A',
    nome: 'Maiores clientes',
    ajuda: 'Poucas clientes que respondem pela maior parte do faturamento.',
    cor: 'var(--gem-esmeralda)',
  },
  {
    chave: 'B',
    nome: 'Clientes intermediárias',
    ajuda: 'O meio da base — entre as maiores e as demais.',
    cor: 'var(--gem-safira)',
  },
  {
    chave: 'C',
    nome: 'Demais clientes',
    ajuda: 'Compras de valor menor, somando a parte final do faturamento.',
    cor: 'var(--gem-perola)',
  },
] as const

/**
 * POR QUE esta cliente gasta o que gasta.
 *
 * Só o total não diz nada acionável: R$ 2.000 pode ser uma cliente que voltou 10
 * vezes ou uma que comprou uma peça cara e sumiu — e o que fazer com cada uma é
 * oposto. Comparar o ticket médio dela com o da loja separa os dois casos.
 */
function motivo(c: CustomerWithStats, ticketMedioDaLoja: number): { texto: string; tom: 'freq' | 'caro' | 'ambos' | 'neutro' } {
  const compras = c.total_sales || 1
  const ticket = c.total_spent / compras
  const gastaAlto = ticket >= ticketMedioDaLoja * 1.3
  const voltaSempre = compras >= 3

  /*
   * Descreve, não avalia. "poucas compras, mas caras" e "gasta alto" comentam a
   * pessoa; "acima da média da loja" é o mesmo fato dito como referência, e é o que
   * a Fernanda precisa para decidir o atendimento.
   *
   * Cada frase é escrita para o caso dela, não montada por fórmula — senão sai
   * "1 compra em média", que é média de um número só.
   */
  if (voltaSempre && gastaAlto) return { texto: `compra sempre, acima da média — ${compras} compras de ${fmt(ticket)}`, tom: 'ambos' }
  if (voltaSempre)              return { texto: `compra com frequência — ${compras} compras de ${fmt(ticket)}`, tom: 'freq' }
  if (compras === 1 && gastaAlto) return { texto: `uma compra, acima da média: ${fmt(ticket)}`, tom: 'caro' }
  if (compras === 1)              return { texto: `uma compra de ${fmt(ticket)}`, tom: 'neutro' }
  if (gastaAlto)                  return { texto: `${compras} compras acima da média, ${fmt(ticket)} cada`, tom: 'caro' }
  return { texto: `${compras} compras de ${fmt(ticket)} cada`, tom: 'neutro' }
}

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

function fmtData(iso: string | null): string {
  if (!iso) return 'nunca'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

/** "01/07/2026" → "1º de julho"; usado para dizer de quando é o número. */
function porExtenso(iso: string): string {
  const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`
}

export default function PanoramaClientes({ customers, vendaAvulsa }: Props) {
  // Qual grupo está aberto. Um por vez: abrir os três de uma vez devolveria a
  // lista inteira, que é justamente o que a tabela abaixo já faz.
  const [aberto, setAberto] = useState<string | null>(null)
  const abc = useMemo(() => {
    const comGasto = customers.filter(c => c.total_spent > 0).sort((a, b) => b.total_spent - a.total_spent)
    const deClientes = comGasto.reduce((s, c) => s + c.total_spent, 0)
    /*
     * O total inclui a venda avulsa.
     *
     * Antes somava só o que veio de cliente identificado, e aí o número não batia
     * com o financeiro — a diferença parecia erro de conta. Com o avulso dentro, o
     * total É o faturamento, e a fatia sem cliente vira informação útil: mostra
     * quanto do caixa não dá para atribuir a ninguém.
     */
    const total = deClientes + vendaAvulsa.total
    if (!total) return null

    // Cada grupo guarda as CLIENTES, não só a contagem: é o que permite abrir e ver
    // quem são. "9 clientes" sem nome não dá para agir.
    const vazio = () => ({ n: 0, valor: 0, min: Infinity, max: 0, clientes: [] as CustomerWithStats[] })
    const faixas = { A: vazio(), B: vazio(), C: vazio() }
    let acumulado = 0
    for (const c of comGasto) {
      acumulado += c.total_spent
      /*
       * O corte 70/90 é sobre `deClientes`, NÃO sobre o total com avulso: ele
       * divide as clientes entre si, e misturar a venda sem dono aqui deslocaria a
       * régua e mudaria quem cai em cada grupo. O avulso entra depois, só na
       * exibição — que é onde ele de fato pertence.
       */
      const pctAcumulado = acumulado / deClientes
      // O corte olha o acumulado ANTES desta cliente, senão a primeira já estouraria
      // 70% em bases pequenas e o primeiro grupo ficaria com uma pessoa só.
      const faixa = pctAcumulado - c.total_spent / deClientes < 0.7 ? 'A' : pctAcumulado - c.total_spent / deClientes < 0.9 ? 'B' : 'C'
      faixas[faixa].n++
      faixas[faixa].valor += c.total_spent
      faixas[faixa].min = Math.min(faixas[faixa].min, c.total_spent)
      faixas[faixa].max = Math.max(faixas[faixa].max, c.total_spent)
      faixas[faixa].clientes.push(c)
    }
    /*
     * O período de onde o número saiu.
     *
     * Este total NÃO é "o mês": é tudo que está registrado, da primeira à última
     * venda com cliente vinculado. Sem dizer isso, o número não bate com nenhuma
     * outra tela e não há como conferir — foi exatamente a dúvida levantada.
     */
    const datas = comGasto.map(c => c.last_sale_date).filter(Boolean).sort() as string[]

    return {
      total,
      deClientes,
      faixas,
      comGastoN: comGasto.length,
      semCompra: customers.length - comGasto.length,
      de: datas[0] ?? null,
      ate: datas[datas.length - 1] ?? null,
    }
  }, [customers, vendaAvulsa])

  /*
   * Ticket médio da loja: a régua para dizer se uma cliente "compra caro". Sem
   * comparar com a média, R$ 300 por compra não significa nada — pode ser alto ou
   * baixo dependendo do que a loja vende.
   */
  const ticketMedioDaLoja = useMemo(() => {
    const comCompra = customers.filter(c => c.total_spent > 0)
    const compras = comCompra.reduce((s, c) => s + (c.total_sales || 1), 0)
    const valor = comCompra.reduce((s, c) => s + c.total_spent, 0)
    return compras ? valor / compras : 0
  }, [customers])

  if (!abc) return null

  return (
    <div className={styles.painelUnico}>
      {/* ─── Curva ABC ─── */}
      <section className={styles.painel}>
        <header className={styles.cabecalho}>
          <TrendingUp size={14} />
          <div className={styles.tituloBloco}>
            <span className={styles.titulo}>De onde vem o faturamento</span>
            {/* De onde o número saiu e de quando ele é. Sem isso não há como
                conferir com nenhuma outra tela — e ele não é "do mês". */}
            <span className={styles.periodo}>
              {abc.de && abc.ate
                ? (abc.de === abc.ate
                    ? `Vendas de ${porExtenso(abc.de)}`
                    : `Todas as vendas registradas — de ${porExtenso(abc.de)} a ${porExtenso(abc.ate)}`)
                : 'Todas as vendas registradas'}
            </span>
          </div>
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
            const estaAberto = aberto === f.chave
            return (
              <div key={f.chave} className={styles.faixa}>
                {/* A linha inteira é o botão — alvo grande, e deixa claro que abre. */}
                <button
                  type="button"
                  className={`${styles.faixaBotao} ${estaAberto ? styles.faixaBotaoAberta : ''}`}
                  onClick={() => setAberto(estaAberto ? null : f.chave)}
                  aria-expanded={estaAberto}
                  title={f.ajuda}
                >
                  <div className={styles.faixaTopo}>
                    <span className={styles.faixaPonto} style={{ background: f.cor }} aria-hidden="true" />
                    <span className={styles.faixaNome}>{f.nome}</span>
                    <ChevronDown
                      size={13}
                      className={`${styles.faixaSeta} ${estaAberto ? styles.faixaSetaAberta : ''}`}
                    />
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
                </button>

                {estaAberto && (
                  <div className={styles.lista}>
                    {d.clientes.map(c => {
                      const m = motivo(c, ticketMedioDaLoja)
                      return (
                        <div key={c.id} className={styles.item}>
                          <span className={styles.itemAvatar} style={{ background: f.cor }}>
                            {iniciais(c.name)}
                          </span>
                          <div className={styles.itemInfo}>
                            <span className={styles.itemNome} title={c.name}>{c.name}</span>
                            <span className={styles.itemMotivo} data-tom={m.tom}>{m.texto}</span>
                          </div>
                          <div className={styles.itemNumeros}>
                            <span className={styles.itemValor}>{fmt(c.total_spent)}</span>
                            <span className={styles.itemData}>
                              última: {fmtData(c.last_sale_date)}
                            </span>
                          </div>
                          <span className={styles.itemTelefone}>{formatarTelefone(c.phone)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {/*
            Venda sem cliente vinculado. Aparece como quarta faixa porque FAZ PARTE
            do faturamento — é o que faz o total do painel fechar com o financeiro.
            Não abre ao clicar: não há cliente para listar, e é justamente esse o
            ponto dela.
          */}
          {vendaAvulsa.total > 0 && (
            <div className={`${styles.faixa} ${styles.faixaAvulsa}`}>
              <div className={styles.faixaTopo}>
                <span className={`${styles.faixaPonto} ${styles.pontoAvulso}`} aria-hidden="true" />
                <span className={styles.faixaNome}>Sem cliente identificado</span>
                <span className={styles.faixaValor}>{fmt(vendaAvulsa.total)}</span>
              </div>

              <div className={styles.barraTrilho}>
                <div className={`${styles.barra} ${styles.barraAvulsa}`} style={{ width: `${(vendaAvulsa.total / abc.total) * 100}%` }} />
              </div>

              <div className={styles.faixaRodape}>
                <span>
                  <strong>{vendaAvulsa.quantidade}</strong> venda{vendaAvulsa.quantidade !== 1 ? 's' : ''} sem cliente vinculado na hora do registro
                </span>
                <span className={styles.faixaPct}>{((vendaAvulsa.total / abc.total) * 100).toFixed(0)}% do faturamento</span>
              </div>
            </div>
          )}
        </div>

        {/* A conclusão que a tela existe para dar, escrita por extenso: sem ela, a
            pessoa vê as barras e precisa fazer a leitura sozinha. */}
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
            Outras {abc.semCompra} cadastradas ainda não têm compra lançada no sistema.
          </footer>
        )}
      </section>

    </div>
  )
}
