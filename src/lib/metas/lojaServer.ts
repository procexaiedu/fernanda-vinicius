import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { emLotes } from '@/lib/supabase/em-lotes'
import { todaySP } from '@/lib/date'
import {
  apurarMes, chaveMetaLoja, lerConfigMetaLoja, limitesDoMesSP,
  type ComissaoVendedora, type ConfigMetaLoja, type PainelMeta, type ProgressoLoja,
} from './loja'

type Admin = ReturnType<typeof createAdminClient>

export interface ApuracaoLoja {
  config: ConfigMetaLoja
  progresso: ProgressoLoja
  porVendedora: ComissaoVendedora[]
  semVendedora: number
}

/** Mês corrente em Brasília, 'YYYY-MM'. */
export function mesAtualSP(): string {
  return todaySP().slice(0, 7)
}

export async function lerConfigDaLoja(admin: Admin, storeId: string): Promise<ConfigMetaLoja> {
  const { data, error } = await admin
    .from('settings').select('value').eq('key', chaveMetaLoja(storeId)).maybeSingle()
  if (error) throw new Error(`Não foi possível ler a meta da loja: ${error.message}`)
  return lerConfigMetaLoja(data?.value)
}

/**
 * Meta, realizado e comissão de UMA loja num mês.
 *
 * Toda leitura LANÇA em erro. `(data ?? [])` aqui transformaria uma falha de
 * rede em "realizado R$ 0, faltam R$ 60 mil" e em comissão zerada no
 * Financeiro, sem aviso nenhum (ver CLAUDE.md, armadilhas do PostgREST).
 */
export async function apurarLoja(storeId: string, mes: string): Promise<ApuracaoLoja> {
  const admin = createAdminClient()
  const { inicio, fim } = limitesDoMesSP(mes)

  const [config, vendas] = await Promise.all([
    lerConfigDaLoja(admin, storeId),
    // Paginado: uma loja passa de mil vendas no mês, e o PostgREST corta calado.
    fetchAll<{ id: string; seller_id: string | null; total: number | string }>((de, ate) =>
      admin.from('sales').select('id, seller_id, total')
        .eq('store_id', storeId)
        .gte('sale_date', inicio).lt('sale_date', fim)
        .neq('status', 'cancelled')
        .order('id').range(de, ate)),
  ])

  const ids = vendas.map(v => v.id)
  const [consertos, trocas] = await Promise.all([
    // Conserto = item de produto SERVIÇO, a mesma marca que dispensa a baixa de estoque.
    emLotes<{ sale_id: string; subtotal: number | string }>(ids, lote =>
      admin.from('sale_items').select('sale_id, subtotal, products!inner(is_service)')
        .in('sale_id', lote).eq('products.is_service', true), 'os consertos das vendas'),
    emLotes<{ id: string; sale_id: string | null }>(ids, lote =>
      admin.from('exchanges').select('id, sale_id').in('sale_id', lote), 'as trocas das vendas'),
  ])

  const consertoPorVenda = new Map<string, number>()
  for (const c of consertos) {
    consertoPorVenda.set(c.sale_id, (consertoPorVenda.get(c.sale_id) ?? 0) + Number(c.subtotal))
  }

  // Crédito da troca = o que a cliente DEVOLVEU, abatido da venda nova.
  const creditoPorVenda = new Map<string, number>()
  if (trocas.length) {
    const vendaDaTroca = new Map(trocas.filter(t => t.sale_id).map(t => [t.id, t.sale_id as string]))
    const devolvidos = await emLotes<{ exchange_id: string; quantity: number; unit_price: number | string }>(
      [...vendaDaTroca.keys()], lote =>
        admin.from('exchange_items').select('exchange_id, quantity, unit_price')
          .in('exchange_id', lote).eq('direction', 'returned'), 'as peças devolvidas nas trocas')
    for (const d of devolvidos) {
      const venda = vendaDaTroca.get(d.exchange_id)
      if (!venda) continue
      creditoPorVenda.set(venda, (creditoPorVenda.get(venda) ?? 0) + Number(d.unit_price) * Number(d.quantity))
    }
  }

  const apurado = apurarMes(
    vendas.map(v => ({ id: v.id, seller_id: v.seller_id, total: Number(v.total) })),
    consertoPorVenda, creditoPorVenda, config, mes, todaySP(),
  )
  return { config, ...apurado }
}

/**
 * Para as telas de entrada (PDV e Dashboard). Falha NÃO derruba a tela de
 * venda: vira um aviso no lugar do painel, nunca um "R$ 0" de mentira.
 */
export async function painelMetaDaLoja(storeId: string | null): Promise<PainelMeta> {
  if (!storeId) return { progresso: null, erro: null }
  try {
    const { progresso } = await apurarLoja(storeId, mesAtualSP())
    return { progresso, erro: null }
  } catch (e) {
    console.error('[meta da loja] falha ao apurar:', e)
    return { progresso: null, erro: 'Não consegui carregar a meta da loja agora. Recarregue a página em instantes.' }
  }
}
