'use server'

import { lojaDoEscopo, requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { emLotes } from '@/lib/supabase/em-lotes'

/**
 * Peças de cada venda para a planilha de Vendas (chamado #35, 17/11/2026).
 *
 * Formato decidido com o dev: UMA linha por venda, os códigos vendidos juntos
 * numa coluna ("AN123, BR045 (2x)"). Nada de relatório item a item.
 *
 * As vendas (datas, cliente, valores) a tela já tem, filtradas como a pessoa
 * vê; aqui só vem o que a lista não carrega: códigos, quantidade de peças e
 * custo. Só admin: o código carrega o custo (decisão de 05/10/2026) e o custo
 * é do admin. A loja é conferida aqui, não confiada à lista de ids do client.
 */

export interface PecasDaVenda {
  codigos: string
  pecas: number
  custo: number
}

export type ResultadoPecas =
  | { success: true; porVenda: Record<string, PecasDaVenda> }
  | { success: false; error: string }

const MAX_VENDAS = 6400

export async function pecasParaExportar(saleIds: string[]): Promise<ResultadoPecas> {
  const profile = await requireProfile()
  if (profile.role !== 'admin') return { success: false, error: 'Só a gerência pode exportar as vendas.' }
  if (!Array.isArray(saleIds) || saleIds.length === 0) return { success: false, error: 'Nenhuma venda no filtro atual.' }
  if (saleIds.length > MAX_VENDAS) return { success: false, error: 'Vendas demais de uma vez. Diminua o período.' }

  const admin = createAdminClient()
  const loja = lojaDoEscopo(profile)

  try {
    /* Só vendas da loja da sessão: um id de outra loja mandado pelo navegador é ignorado. */
    const vendas = await emLotes(saleIds, lote => {
      let q = admin.from('sales').select('id').in('id', lote)
      if (loja) q = q.eq('store_id', loja)
      return q
    }, 'as vendas')
    const permitidas = vendas.map(v => (v as { id: string }).id)

    const itens = await emLotes(permitidas, lote =>
      admin.from('sale_items')
        .select('sale_id, quantity, unit_cost, created_at, products(code, is_service)')
        .in('sale_id', lote)
        .order('created_at', { ascending: true }),
      'os itens das vendas',
    ) as unknown as {
      sale_id: string; quantity: number; unit_cost: number | string | null
      products: { code: string | null; is_service: boolean | null } | { code: string | null; is_service: boolean | null }[] | null
    }[]

    const acumulado = new Map<string, { ordem: string[]; qtd: Map<string, number>; pecas: number; custo: number }>()
    for (const id of permitidas) acumulado.set(id, { ordem: [], qtd: new Map(), pecas: 0, custo: 0 })

    for (const i of itens) {
      const a = acumulado.get(i.sale_id)
      if (!a) continue
      const p = Array.isArray(i.products) ? i.products[0] : i.products
      const qtd = Number(i.quantity) || 0
      a.custo += Math.round((Number(i.unit_cost) || 0) * qtd * 100) / 100
      /* Conserto não é peça: entra no valor da venda, mas não na lista de códigos. */
      const codigo = p?.is_service ? 'Conserto' : (p?.code?.trim() || 'Sem código')
      if (!p?.is_service) a.pecas += qtd
      if (!a.qtd.has(codigo)) a.ordem.push(codigo)
      a.qtd.set(codigo, (a.qtd.get(codigo) ?? 0) + qtd)
    }

    const porVenda: Record<string, PecasDaVenda> = {}
    for (const [id, a] of acumulado) {
      porVenda[id] = {
        codigos: a.ordem.map(c => (a.qtd.get(c)! > 1 ? `${c} (${a.qtd.get(c)}x)` : c)).join(', '),
        pecas: a.pecas,
        custo: Math.round(a.custo * 100) / 100,
      }
    }
    return { success: true, porVenda }
  } catch (e) {
    console.error('[vendas] exportar:', e)
    return { success: false, error: 'Não consegui montar a planilha. Tente de novo.' }
  }
}
