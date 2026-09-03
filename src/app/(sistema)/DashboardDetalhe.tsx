'use client'

import { useEffect, useState } from 'react'
import DetalheListaModal, { type ItemResumo } from '@/components/dashboard/DetalheListaModal'
import {
  buscarMovimentosDoMes, buscarVendasDoMes, buscarProdutosDoEstoque,
  type LinhaMovimento, type LinhaVendaCusto, type LinhaProdutoEstoque,
  type DashboardKpis, type DashboardStock,
} from './actions'
import { formatarDinheiro } from '@/lib/dinheiro'

/*
 * ─── O detalhamento de cada número da dashboard ───────────────────────────────
 *
 * Vive fora do DashboardClient de propósito: são dez origens clicáveis, cada uma
 * com sua consulta, suas colunas e sua conta no topo. Junto do resto, isso seria
 * mais 250 linhas num arquivo que já passa de 800, e o layout — que é o que a
 * gente mexe toda semana — ficaria enterrado no meio de definição de coluna.
 *
 * As consultas usam exatamente os mesmos filtros de `buscarKpis`/`buscarEstoque`.
 * Se um filtro divergir, a lista não fecha com o total do cartão e a tela inteira
 * perde a credibilidade — é o tipo de erro que ninguém reporta, só desconfia.
 */

export type ChaveDetalhe =
  | 'resultado' | 'receita' | 'cmv' | 'lucroBruto' | 'despesas'
  | 'pecas' | 'skus' | 'custo' | 'venda' | 'parados'

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

/* Dinheiro: um formatador só para o sistema — ver src/lib/dinheiro.ts */
const fmt = formatarDinheiro

function fmtData(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

interface Props {
  chave: ChaveDetalhe
  storeId: string | null
  month: number
  year: number
  kpis: DashboardKpis
  estoque: DashboardStock
  staleDays: number
  onClose: () => void
  /** Abre a ficha do produto a partir da lista de estoque. */
  onProduto?: (id: string) => void
}

export default function DashboardDetalhe({
  chave, storeId, month, year, kpis, estoque, staleDays, onClose, onProduto,
}: Props) {
  const [movimentos, setMovimentos] = useState<LinhaMovimento[]>([])
  const [vendas, setVendas]         = useState<LinhaVendaCusto[]>([])
  const [produtos, setProdutos]     = useState<LinhaProdutoEstoque[]>([])
  const [carregando, setCarregando] = useState(true)

  const periodo = `${MESES[month - 1]} ${year}`

  useEffect(() => {
    let cancelado = false
    setCarregando(true)

    async function carregar() {
      if (chave === 'resultado' || chave === 'receita' || chave === 'despesas') {
        const tipo = chave === 'receita' ? 'income' : chave === 'despesas' ? 'expense' : null
        const r = await buscarMovimentosDoMes(storeId, month, year, tipo)
        if (!cancelado) setMovimentos(r)
      } else if (chave === 'cmv' || chave === 'lucroBruto') {
        const r = await buscarVendasDoMes(storeId, month, year)
        if (!cancelado) setVendas(r)
      } else {
        const r = await buscarProdutosDoEstoque(storeId, chave === 'parados' ? 'parados' : 'todos', staleDays)
        if (!cancelado) setProdutos(r)
      }
      if (!cancelado) setCarregando(false)
    }

    carregar()
    return () => { cancelado = true }
  }, [chave, storeId, month, year, staleDays])

  // ── Movimentos do ledger: resultado, receita e despesas ───────────────────
  if (chave === 'resultado' || chave === 'receita' || chave === 'despesas') {
    const entradas = movimentos.filter(m => m.tipo === 'income').reduce((s, m) => s + m.valor, 0)
    const saidas   = movimentos.filter(m => m.tipo === 'expense').reduce((s, m) => s + m.valor, 0)

    const resumo: ItemResumo[] =
      chave === 'resultado'
        ? [
            /* Entrou menos saiu, e só. O CMV saiu daqui: ele contava a compra
             * pela segunda vez — inteira ao entrar como despesa, e de novo
             * peça a peça ao sair. Agora esta lista É a conta do cartão, sem
             * linha que não esteja no ledger. */
            { rotulo: 'Entrou', valor: fmt(entradas), tom: 'pos' },
            { rotulo: 'Saiu', valor: fmt(saidas), tom: 'neg' },
            { rotulo: 'Resultado do mês', valor: fmt(kpis.lucroLiquido), total: true,
              tom: kpis.lucroLiquido < 0 ? 'neg' : 'pos' },
          ]
        : chave === 'receita'
          ? [{ rotulo: 'Receita bruta do mês', valor: fmt(entradas), total: true, tom: 'pos' }]
          : [{ rotulo: 'Saídas pagas no mês', valor: fmt(saidas), total: true, tom: 'neg' }]

    return (
      <DetalheListaModal<LinhaMovimento>
        titulo={
          chave === 'resultado' ? 'Resultado do mês'
          : chave === 'receita' ? 'Receita bruta'
          : 'Saídas do mês'
        }
        subtitulo={`${periodo} · lançamentos concluídos no financeiro`}
        linhas={movimentos}
        chave={m => m.id}
        resumo={resumo}
        carregando={carregando}
        vazio="Nenhum lançamento neste mês"
        rotuloItem="lançamento"
        onClose={onClose}
        colunas={[
          { chave: 'data', rotulo: 'Data', valor: m => fmtData(m.data), busca: m => fmtData(m.data) },
          { chave: 'desc', rotulo: 'Descrição', forte: true, valor: m => m.descricao, busca: m => m.descricao },
          { chave: 'cat', rotulo: 'Categoria', secundaria: true, valor: m => m.categoria, busca: m => m.categoria },
          { chave: 'loja', rotulo: 'Loja', secundaria: true, valor: m => m.loja ?? 'Geral', busca: m => m.loja ?? 'Geral' },
          {
            chave: 'valor', rotulo: 'Valor', alinhamento: 'dir', forte: true,
            // Na lista do resultado os dois tipos convivem, então o sinal é o que
            // distingue entrada de saída — sem ele viram a mesma coisa.
            valor: m => chave === 'resultado' && m.tipo === 'expense' ? `− ${fmt(m.valor)}` : fmt(m.valor),
          },
        ]}
      />
    )
  }

  // ── Vendas: CMV e lucro bruto ─────────────────────────────────────────────
  if (chave === 'cmv' || chave === 'lucroBruto') {
    const custoVendas = vendas.reduce((s, v) => s + v.custo, 0)
    // A diferença entre o custo somado aqui e o CMV do cartão é o crédito das
    // trocas — item devolvido volta ao estoque e o custo dele sai do CMV.
    const credito = custoVendas - kpis.cmv

    const resumo: ItemResumo[] = chave === 'cmv'
      ? [
          { rotulo: `Custo das ${vendas.length} vendas do mês`, valor: fmt(custoVendas) },
          // `fmt(-credito)` já traz o sinal. Escrever um "−" na frente somava com o
          // menos do próprio número quando o crédito era negativo: "− -R$ 5.218,72".
          ...(Math.abs(credito) > 0.005
            ? [{ rotulo: 'Crédito de trocas (itens devolvidos)', valor: fmt(-credito), tom: 'pos' as const }]
            : []),
          { rotulo: 'Custo (CMV)', valor: fmt(kpis.cmv), total: true, tom: 'neg' },
        ]
      : [
          { rotulo: 'Receita bruta', valor: fmt(kpis.receitaBruta), tom: 'pos' },
          { rotulo: 'Custo (CMV)', valor: `− ${fmt(kpis.cmv)}`, tom: 'neg' },
          { rotulo: 'Lucro bruto', valor: fmt(kpis.lucroBruto), total: true,
            tom: kpis.lucroBruto < 0 ? 'neg' : 'pos' },
        ]

    return (
      <DetalheListaModal<LinhaVendaCusto>
        titulo={chave === 'cmv' ? 'Custo dos produtos vendidos' : 'Lucro bruto'}
        subtitulo={`${periodo} · vendas não canceladas`}
        linhas={vendas}
        chave={v => v.id}
        resumo={resumo}
        carregando={carregando}
        vazio="Nenhuma venda neste mês"
        rotuloItem="venda"
        onClose={onClose}
        colunas={[
          { chave: 'data', rotulo: 'Data', valor: v => fmtData(v.data), busca: v => fmtData(v.data) },
          { chave: 'cli', rotulo: 'Cliente', forte: true, valor: v => v.cliente, busca: v => v.cliente },
          { chave: 'vend', rotulo: 'Vendedora', secundaria: true, valor: v => v.vendedora, busca: v => v.vendedora },
          { chave: 'loja', rotulo: 'Loja', secundaria: true, valor: v => v.loja ?? '—', busca: v => v.loja ?? '' },
          { chave: 'total', rotulo: 'Venda', alinhamento: 'dir', valor: v => fmt(v.total) },
          { chave: 'custo', rotulo: 'Custo', alinhamento: 'dir', forte: true, valor: v => fmt(v.custo) },
        ]}
      />
    )
  }

  // ── Estoque ───────────────────────────────────────────────────────────────
  const titulos: Record<string, { titulo: string; sub: string; resumo: ItemResumo[] }> = {
    pecas: {
      titulo: 'Total de peças em estoque',
      sub: 'Produtos ativos com quantidade acima de zero',
      resumo: [
        { rotulo: 'SKUs com estoque', valor: estoque.totalSkus.toLocaleString('pt-BR') },
        { rotulo: 'Total de peças', valor: estoque.totalPecas.toLocaleString('pt-BR'), total: true },
      ],
    },
    skus: {
      titulo: 'SKUs únicos',
      sub: 'Cada linha é um código diferente com estoque',
      resumo: [
        { rotulo: 'Total de peças', valor: estoque.totalPecas.toLocaleString('pt-BR') },
        { rotulo: 'SKUs únicos', valor: estoque.totalSkus.toLocaleString('pt-BR'), total: true },
      ],
    },
    custo: {
      titulo: 'Valor do estoque em custo',
      sub: 'Quantidade × preço de custo, produto a produto',
      resumo: [
        { rotulo: 'Valor em venda', valor: fmt(estoque.valorEstoqueVenda) },
        { rotulo: 'Valor em custo', valor: fmt(estoque.valorEstoque), total: true },
      ],
    },
    venda: {
      titulo: 'Valor do estoque em venda',
      sub: 'Quantidade × preço de venda, produto a produto',
      resumo: [
        { rotulo: 'Valor em custo', valor: fmt(estoque.valorEstoque) },
        { rotulo: 'Valor em venda', valor: fmt(estoque.valorEstoqueVenda), total: true },
      ],
    },
    parados: {
      titulo: 'Peças paradas',
      sub: `Sem venda há mais de ${staleDays} dias`,
      resumo: [
        { rotulo: 'SKUs com estoque', valor: estoque.totalSkus.toLocaleString('pt-BR') },
        { rotulo: 'Parados', valor: estoque.pecasParadas.toLocaleString('pt-BR'), total: true, tom: 'neg' },
      ],
    },
  }
  const cfg = titulos[chave]

  return (
    <DetalheListaModal<LinhaProdutoEstoque>
      titulo={cfg.titulo}
      subtitulo={cfg.sub}
      linhas={produtos}
      chave={p => p.id}
      resumo={cfg.resumo}
      carregando={carregando}
      vazio="Nenhum produto neste recorte"
      rotuloItem="produto"
      onClose={onClose}
      onLinhaClick={onProduto ? p => onProduto(p.id) : undefined}
      colunas={[
        { chave: 'code', rotulo: 'Código', valor: p => p.code, busca: p => p.code },
        { chave: 'nome', rotulo: 'Produto', forte: true, valor: p => p.name, busca: p => p.name },
        { chave: 'cat', rotulo: 'Categoria', secundaria: true, valor: p => p.category, busca: p => p.category },
        { chave: 'qtd', rotulo: 'Qtd', alinhamento: 'dir', valor: p => p.quantidade.toLocaleString('pt-BR') },
        ...(chave === 'parados'
          ? [{ chave: 'dias', rotulo: 'Parado há', alinhamento: 'dir' as const, forte: true,
               valor: (p: LinhaProdutoEstoque) => `${p.diasParado}d` }]
          : []),
        {
          chave: 'valor',
          rotulo: chave === 'venda' ? 'Em venda' : 'Em custo',
          alinhamento: 'dir',
          forte: true,
          valor: p => fmt((chave === 'venda' ? p.vendaUnit : p.custoUnit) * p.quantidade),
        },
      ]}
    />
  )
}
