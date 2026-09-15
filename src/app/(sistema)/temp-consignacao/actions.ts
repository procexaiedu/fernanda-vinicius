'use server'

/*
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  TELA TEMPORÁRIA — APAGAR A PASTA INTEIRA QUANDO O LOTE ESTIVER NO LUGAR │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Existe porque em 15/09 a dona não conseguiu vender a pulseira FEF0989 em
 * Campinas: o lote consignado da Emília Fernandes foi cadastrado na loja de
 * BRASÍLIA por engano, e a separação por loja (04/09) esconde tudo dele de
 * quem está em Campinas. Ela está parada, esperando isto para lançar as vendas
 * que ainda não entraram.
 *
 * O caminho normal seria rodar o UPDATE no banco. O Postgres do self-hosted
 * (10.0.0.236:5433) não é alcançável de fora e o Studio não estava à mão, então
 * a correção entra por onde o app já entra: ele tem `service_role`.
 *
 * QUANDO REMOVER: assim que o lote aparecer em Campinas e ela confirmar que
 * consegue vender. `rm -rf src/app/(sistema)/temp-consignacao` — não há nada
 * pendurado nisto em outro lugar.
 *
 * NÃO VIRAR FEATURE. Ela foi perguntada se queria um botão para isso e
 * respondeu: "só faça isso e não acontece mais".
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile, ehAdminGlobal } from '@/lib/auth'

export interface Peca {
  id: string
  code: string
  name: string
  barcode_number: string
  store_id: string | null
  quantity_in_stock: number
  cost_price: number
  is_active: boolean
  vendidas: number
}

export interface Lote {
  id: string
  fornecedor: string
  loja_id: string | null
  loja: string
  received_date: string
  total_pieces: number | null
  total_cost_value: number | null
  status: string
  purchase_id: string | null
  pecas: Peca[]
  /** Lojas distintas em que as peças do lote estão hoje. */
  lojasDasPecas: string[]
}

/** Só admin global — a Fernanda e nós. Ninguém mais move lote entre lojas. */
async function exigirAdminGlobal() {
  const p = await requireProfile()
  if (!ehAdminGlobal(p)) throw new Error('Só a administradora geral pode usar esta tela.')
  return p
}

export async function listarLotes(): Promise<Lote[]> {
  await exigirAdminGlobal()
  const db = createAdminClient()

  const [lotesRes, lojasRes] = await Promise.all([
    db.from('consignments')
      .select('id, supplier_id, store_id, received_date, total_pieces, total_cost_value, status')
      .order('received_date', { ascending: false }),
    db.from('stores').select('id, name'),
  ])

  // Erro é erro: lista vazia aqui pareceria "não há lote nenhum" e mandaria
  // procurar o problema no lugar errado.
  if (lotesRes.error) throw new Error('Falha ao ler consignações: ' + lotesRes.error.message)

  const lotes = lotesRes.data ?? []
  if (!lotes.length) return []

  const nomeLoja = new Map((lojasRes.data ?? []).map(l => [l.id as string, l.name as string]))
  const ids = lotes.map(l => l.id as string)

  const [fornRes, prodRes, compraRes] = await Promise.all([
    db.from('suppliers').select('id, name'),
    db.from('products')
      .select('id, code, name, barcode_number, store_id, quantity_in_stock, cost_price, is_active, consignment_id')
      .in('consignment_id', ids),
    db.from('purchases').select('id, consignment_id').in('consignment_id', ids),
  ])

  if (prodRes.error) throw new Error('Falha ao ler as peças: ' + prodRes.error.message)

  const produtos = prodRes.data ?? []
  const nomeForn = new Map((fornRes.data ?? []).map(f => [f.id as string, f.name as string]))
  const compraDoLote = new Map((compraRes.data ?? []).map(c => [c.consignment_id as string, c.id as string]))

  /* Peça já vendida não impede a mudança de loja — `sales.store_id` fica na
     VENDA, então o histórico de quem vendeu o quê não se reescreve. Mas conta
     na tela, porque é o número que explica um lote que "não bate". */
  const vendidas = new Map<string, number>()
  if (produtos.length) {
    const { data: itens } = await db
      .from('sale_items')
      .select('product_id, quantity')
      .in('product_id', produtos.map(p => p.id as string))
    for (const i of (itens ?? []) as Array<{ product_id: string; quantity: number }>) {
      vendidas.set(i.product_id, (vendidas.get(i.product_id) ?? 0) + Number(i.quantity ?? 0))
    }
  }

  return lotes.map(l => {
    const doLote = produtos.filter(p => p.consignment_id === l.id)
    const lojas = [...new Set(doLote.map(p => nomeLoja.get(p.store_id as string) ?? '—'))]
    return {
      id: l.id as string,
      fornecedor: nomeForn.get(l.supplier_id as string) ?? '—',
      loja_id: (l.store_id as string) ?? null,
      loja: nomeLoja.get(l.store_id as string) ?? '—',
      received_date: l.received_date as string,
      total_pieces: l.total_pieces as number | null,
      total_cost_value: l.total_cost_value as number | null,
      status: l.status as string,
      purchase_id: compraDoLote.get(l.id as string) ?? null,
      lojasDasPecas: lojas,
      pecas: doLote.map(p => ({
        id: p.id as string,
        code: p.code as string,
        name: p.name as string,
        barcode_number: p.barcode_number as string,
        store_id: (p.store_id as string) ?? null,
        quantity_in_stock: p.quantity_in_stock as number,
        cost_price: Number(p.cost_price ?? 0),
        is_active: p.is_active as boolean,
        vendidas: vendidas.get(p.id as string) ?? 0,
      })),
    }
  })
}

export interface ResultadoMover {
  success: boolean
  error?: string
  pecasMovidas?: number
  loteMovido?: boolean
}

/**
 * Move o lote inteiro para outra loja: as PEÇAS e o cabeçalho da consignação.
 *
 * NÃO toca em `purchases.store_id`, que é nulo em todas as compras de
 * propósito — a compra pertence à loja pelas peças, via a view
 * `fv.compra_rateio_loja`. Movidas as peças, a compra acompanha sozinha.
 *
 * Duas escritas separadas, sem transação: o PostgREST não a oferece. É
 * aceitável aqui porque a operação é IDEMPOTENTE — gravar a mesma loja de novo
 * não faz mal, e se a segunda falhar basta repetir. As peças vão primeiro: é a
 * escrita que destrava a venda, que é o que ela está esperando.
 */
export async function moverLote(loteId: string, lojaDestinoId: string): Promise<ResultadoMover> {
  await exigirAdminGlobal()
  const db = createAdminClient()

  const { data: destino } = await db.from('stores').select('id, name').eq('id', lojaDestinoId).maybeSingle()
  if (!destino) return { success: false, error: 'Loja de destino não encontrada.' }

  const { data: lote } = await db.from('consignments').select('id').eq('id', loteId).maybeSingle()
  if (!lote) return { success: false, error: 'Lote não encontrado.' }

  const { data: movidas, error: erroPecas } = await db
    .from('products')
    .update({ store_id: lojaDestinoId, updated_at: new Date().toISOString() })
    .eq('consignment_id', loteId)
    .select('id')

  if (erroPecas) return { success: false, error: 'Falha ao mover as peças: ' + erroPecas.message }

  const { error: erroLote } = await db
    .from('consignments')
    .update({ store_id: lojaDestinoId })
    .eq('id', loteId)

  if (erroLote) {
    return {
      success: false,
      error: `As peças foram movidas (${movidas?.length ?? 0}), mas o cabeçalho do lote não: ${erroLote.message}. `
           + 'Rode de novo — repetir não causa dano.',
      pecasMovidas: movidas?.length ?? 0,
    }
  }

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/temp-consignacao')

  return { success: true, pecasMovidas: movidas?.length ?? 0, loteMovido: true }
}
