'use server'

import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { montarCsv, nomeArquivo, type ColunaCsv } from '@/lib/exportar/csv'
import { precoEfetivo } from '@/lib/pricing'

/**
 * Exportação de Produtos e Estoque para planilha.
 *
 * Duas decisões que são o coração desta tela:
 *
 * ── 1. Exporta o FILTRO, não a página ──
 * As duas telas paginam de 50 em 50 no servidor. Montar o CSV com o array que o
 * client já tem geraria um arquivo de 50 linhas que *parece* certo — a pessoa
 * abre, vê produto de verdade, e só descobre semanas depois que faltavam 1.000.
 * Por isso a consulta é refeita aqui, com os mesmos filtros e sem `range`.
 *
 * ── 2. Pagina de 1.000 em 1.000, sempre ──
 * O PostgREST corta a resposta em `PGRST_DB_MAX_ROWS` e NÃO avisa: devolve 200
 * com menos linhas. `.limit(20000)` não vence esse teto — isso já produziu uma
 * tela mostrando "999 peças" onde havia 1.185. A única forma correta é varrer em
 * lotes até vir um lote incompleto.
 *
 * ── Custo é decidido no servidor ──
 * O papel vem de `requireProfile()`, nunca de flag mandada pelo client: uma
 * `isAdmin` vinda do navegador é só um booleano que qualquer um edita. Operadora
 * não recebe `cost_price`, nem margem, nem estoque valorizado — as colunas não
 * são escondidas, elas não existem no arquivo. E a loja dela é forçada aqui,
 * então não dá para exportar a outra loja mexendo na URL.
 */

const LOTE = 1000

export interface FiltrosExportacao {
  q?: string
  store_id?: string
  category?: string
  material?: string
  supplier_id?: string
  active?: string
  qty_zero?: string
}

export interface ArquivoExportado {
  nome: string
  conteudo: string
  linhas: number
}

export type ResultadoExportacao =
  | { success: true; arquivo: ArquivoExportado }
  | { success: false; error: string }

interface LinhaProduto {
  code: string
  name: string
  category: string | null
  material: string | null
  barcode_number: string | null
  supplier_reference: string | null
  cost_price: number
  sale_price: number
  promotional_price: number | null
  promotional_active: boolean
  quantity_in_stock: number
  ownership_type: 'own' | 'consignment'
  purchase_month: number | null
  purchase_year: number | null
  last_sale_date: string | null
  is_active: boolean
  created_at: string
  suppliers: { name: string; initials: string } | null
  stores: { name: string } | null
}

/** dd/mm/aaaa — o Excel pt-BR reconhece como data; ISO ele trata como texto. */
function data(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * Varre todos os produtos que batem com o filtro, em lotes.
 *
 * `origem` muda dois filtros: Estoque só mostra ativo e, por padrão, só o que
 * tem saldo; Produtos mostra o catálogo e deixa ver inativo.
 */
const CAMPOS =
  'code, name, category, material, barcode_number, supplier_reference, cost_price, ' +
  'sale_price, promotional_price, promotional_active, quantity_in_stock, ownership_type, ' +
  'purchase_month, purchase_year, last_sale_date, is_active, created_at, ' +
  'suppliers(name, initials), stores(name)'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Os mesmos filtros das telas, num lugar só — a contagem e a varredura têm de usar exatamente estes. */
function aplicarFiltros(
  q: any,
  origem: 'produtos' | 'estoque',
  filtros: FiltrosExportacao,
  lojaForcada: string | null,
) {
  const loja = lojaForcada ?? filtros.store_id
  if (loja) q = q.eq('store_id', loja)

  if (filtros.q) {
    const termo = filtros.q.trim()
    q = q.or(`name.ilike.%${termo}%,code.ilike.%${termo}%,barcode_number.ilike.%${termo}%`)
  }
  if (filtros.category) q = q.eq('category', filtros.category)
  if (filtros.material) q = q.eq('material', filtros.material)
  if (filtros.supplier_id) q = q.eq('supplier_id', filtros.supplier_id)

  if (origem === 'estoque') {
    q = q.eq('is_active', true)
    if (filtros.qty_zero !== 'true') q = q.gt('quantity_in_stock', 0)
  } else if (filtros.active !== 'false') {
    q = q.eq('is_active', true)
  }

  return q
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function buscarTudo(
  origem: 'produtos' | 'estoque',
  filtros: FiltrosExportacao,
  lojaForcada: string | null,
): Promise<LinhaProduto[]> {
  const admin = createAdminClient()

  /*
   * O total vem ANTES e manda no laço.
   *
   * A tentação é parar quando um lote volta com menos de 1.000 linhas. Isso
   * assume que o servidor devolve o tamanho que a gente pediu — e é justamente
   * o que o PostgREST não garante: se `PGRST_DB_MAX_ROWS` for menor que o lote,
   * TODO lote volta cortado, o laço para no primeiro, e o CSV sai truncado
   * parecendo completo. O teto hoje é maior que 1.000, mas depender disso é
   * depender de uma variável de ambiente que já mudou de valor uma vez nesta
   * infra.
   */
  const { count, error: erroCount } = await aplicarFiltros(
    admin.from('products').select('code', { count: 'exact', head: true }),
    origem, filtros, lojaForcada,
  )
  if (erroCount) throw new Error(erroCount.message)

  const total = count ?? 0
  const linhas: LinhaProduto[] = []

  while (linhas.length < total) {
    const inicio = linhas.length

    const { data: lote, error } = await aplicarFiltros(
      admin.from('products').select(CAMPOS),
      origem, filtros, lojaForcada,
    )
      // Ordem estável: sem `order`, o lote 2 pode repetir linha do lote 1.
      .order('code', { ascending: true })
      .range(inicio, inicio + LOTE - 1)

    // Erro é erro: devolver o que já veio entregaria um arquivo pela metade sem
    // ninguém perceber. Estoura para o chamador tratar.
    if (error) throw new Error(error.message)

    const atual = (lote ?? []) as unknown as LinhaProduto[]
    // Lote vazio com total ainda por atingir = alguém apagou linha no meio da
    // varredura. Melhor entregar o que veio do que girar para sempre.
    if (atual.length === 0) break

    linhas.push(...atual)
  }

  return linhas
}

function colunas(comCusto: boolean, origem: 'produtos' | 'estoque'): ColunaCsv<LinhaProduto>[] {
  const base: ColunaCsv<LinhaProduto>[] = [
    { titulo: 'Código',        valor: p => p.code },
    { titulo: 'Produto',       valor: p => p.name },
    { titulo: 'Categoria',     valor: p => p.category },
    { titulo: 'Material',      valor: p => p.material },
    { titulo: 'Código de barras', valor: p => p.barcode_number },
    { titulo: 'Loja',          valor: p => p.stores?.name },
    { titulo: 'Fornecedor',    valor: p => p.suppliers?.name },
    { titulo: 'Ref. fornecedor', valor: p => p.supplier_reference },
    { titulo: 'Quantidade',    valor: p => p.quantity_in_stock },
    { titulo: 'Preço de venda', valor: p => precoEfetivo(p) },
    { titulo: 'Em promoção',   valor: p => (p.promotional_active && p.promotional_price ? 'Sim' : 'Não') },
    { titulo: 'Preço cheio',   valor: p => p.sale_price },
    { titulo: 'Tipo',          valor: p => (p.ownership_type === 'consignment' ? 'Consignado' : 'Próprio') },
    { titulo: 'Compra',        valor: p => (p.purchase_month && p.purchase_year ? `${String(p.purchase_month).padStart(2, '0')}/${p.purchase_year}` : '') },
    { titulo: 'Última venda',  valor: p => data(p.last_sale_date) },
    { titulo: 'Cadastrado em', valor: p => data(p.created_at) },
  ]

  if (origem === 'produtos') {
    base.push({ titulo: 'Ativo', valor: p => (p.is_active ? 'Sim' : 'Não') })
  }

  if (!comCusto) return base

  // Custo entra logo antes do preço de venda, que é como se lê a margem.
  const posicao = base.findIndex(c => c.titulo === 'Preço de venda')
  base.splice(posicao, 0,
    { titulo: 'Custo unitário', valor: p => p.cost_price },
    { titulo: 'Custo total',    valor: p => p.cost_price * p.quantity_in_stock },
  )
  base.push(
    {
      titulo: 'Margem (R$)',
      valor: p => precoEfetivo(p) - p.cost_price,
    },
    {
      titulo: 'Margem (%)',
      // Custo zero não tem margem definida — deixa vazio em vez de imprimir
      // "Infinity" ou um 0 que seria lido como "sem lucro".
      valor: p => (p.cost_price > 0
        ? Number((((precoEfetivo(p) - p.cost_price) / p.cost_price) * 100).toFixed(2))
        : null),
    },
  )

  return base
}

async function exportar(
  origem: 'produtos' | 'estoque',
  filtros: FiltrosExportacao,
): Promise<ResultadoExportacao> {
  const profile = await requireProfile()
  const admin = profile.role === 'admin'

  try {
    const linhas = await buscarTudo(origem, filtros, admin ? null : profile.store_id)
    if (linhas.length === 0) {
      return { success: false, error: 'Nenhum produto no filtro atual — nada para exportar.' }
    }

    return {
      success: true,
      arquivo: {
        nome:     nomeArquivo(origem, new Date()),
        conteudo: montarCsv(linhas, colunas(admin, origem)),
        linhas:   linhas.length,
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Falha ao exportar.' }
  }
}

export async function exportarProdutos(filtros: FiltrosExportacao): Promise<ResultadoExportacao> {
  return exportar('produtos', filtros)
}

export async function exportarEstoque(filtros: FiltrosExportacao): Promise<ResultadoExportacao> {
  return exportar('estoque', filtros)
}
