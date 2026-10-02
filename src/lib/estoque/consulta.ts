import type { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/supabase/fetch-all'

/**
 * Filtros das telas Produtos e Estoque, num lugar só.
 *
 * A lista do /estoque, os totais da faixa de cima e o Exportar têm de usar
 * exatamente estes: se um deles esquecer um filtro, a tela diz "566 peças" e a
 * planilha soma outra coisa, e a conferência da loja vira discussão.
 */
export interface FiltrosProdutos {
  q?: string
  store_id?: string
  category?: string
  material?: string
  supplier_id?: string
  active?: string
  qty_zero?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `origem` muda dois filtros: Estoque só mostra ativo e, por padrão, só o que
 * tem saldo; Produtos mostra o catálogo e deixa ver inativo.
 * `loja` já vem resolvida por `lojaDoEscopo` (nunca direto da URL).
 */
export function aplicarFiltrosProdutos<Q>(
  consulta: Q,
  origem: 'produtos' | 'estoque',
  filtros: FiltrosProdutos,
  loja: string | null,
): Q {
  let q = consulta as any
  if (loja) q = q.eq('store_id', loja)

  if (filtros.q) {
    // Entre aspas: vírgula ou parêntese no termo quebrava o `.or()`.
    const termo = filtros.q.trim()
    const padrao = `"%${termo.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`
    q = q.or(`name.ilike.${padrao},code.ilike.${padrao},barcode_number.ilike.${padrao}`)
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

  return q as Q
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface TotaisEstoque {
  pecas: number
  /** `null` para quem não é admin: o custo nem é somado. */
  custo: number | null
  /** `sale_price` × quantidade, preço cheio (o mesmo critério do Exportar). */
  venda: number
}

/**
 * Totais do estoque sobre TODO o filtro, não sobre a página de 50.
 *
 * Varre só três colunas em lotes (BSB tem ~600 linhas: uma ida). Uma RPC com
 * SUM seria uma ida sempre, mas exigiria migration; o dia em que passar de
 * alguns milhares de linhas, vale trocar.
 *
 * Soma em centavos: somar 600 `float` de preço acumula erro e o total da tela
 * deixaria de bater, no centavo, com o da planilha.
 */
export async function somarEstoque(
  admin: ReturnType<typeof createAdminClient>,
  filtros: FiltrosProdutos,
  loja: string | null,
  comCusto: boolean,
): Promise<TotaisEstoque> {
  const linhas = await fetchAll<{ quantity_in_stock: number; cost_price: number | null; sale_price: number | null }>(
    (de, ate) => aplicarFiltrosProdutos(
      admin.from('products').select('quantity_in_stock, cost_price, sale_price'),
      'estoque', filtros, loja,
    )
      // Ordem estável: sem `order`, o lote 2 pode repetir linha do lote 1.
      .order('id', { ascending: true })
      .range(de, ate),
  )

  let pecas = 0
  let custoCent = 0
  let vendaCent = 0
  for (const l of linhas) {
    const qtd = Number(l.quantity_in_stock) || 0
    pecas += qtd
    custoCent += Math.round((Number(l.cost_price) || 0) * 100) * qtd
    vendaCent += Math.round((Number(l.sale_price) || 0) * 100) * qtd
  }

  return { pecas, custo: comCusto ? custoCent / 100 : null, venda: vendaCent / 100 }
}
