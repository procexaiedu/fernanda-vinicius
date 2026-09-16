import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/*
 * Mora em lib, e não em compras/actions.ts, DE PROPÓSITO.
 *
 * Em 15/09 estas duas funções nasceram exportadas de um arquivo 'use server'.
 * Todo export async de um arquivo assim vira server action — um endpoint HTTP
 * que qualquer um chama, sem login, porque elas não conferem perfil (quem
 * confere é quem as chama). A revisão de 16/09 tirou daqui. `server-only`
 * garante que não voltem a vazar para o cliente.
 */

/**
 * Refaz `total_cost` e `total_items` da compra a partir dos itens que sobraram.
 *
 * O buraco que isto fecha, perguntado pela dona em 09/09 com estas palavras:
 *
 *   "Quando eu excluo uma peça do sistema, ele exclui também da entrada da
 *    peça? Eu declarei lá que de Emília Fernandes eu gastei 5 mil... aí eu vou
 *    e tiro um colar de 100 reais e excluo do sistema."
 *
 * A resposta era não. `products.delete()` levava o `purchase_item` junto pelo
 * cascade, mas `purchases.total_cost` é coluna GRAVADA e ninguém a recalculava:
 * a peça sumia do estoque e a compra continuava valendo os mesmos R$ 5.000.
 * Como `total_cost` alimenta etiqueta, margem e CMV, o erro se espalhava calado.
 *
 * Fica em código, e não num trigger, porque não há acesso a DDL neste ambiente.
 *
 * FALHA NÃO VIRA ZERO. A primeira versão lia `(itens ?? [])`: com a leitura
 * falhando, a compra parecia vazia e o total era gravado como R$ 0,00. É o
 * `catch` vazio disfarçado que o CLAUDE.md proíbe — aqui, em cima de dinheiro.
 * Agora a falha lança e nada é gravado.
 *
 * Idempotente: roda quantas vezes quiser, o resultado é o mesmo.
 */
export async function recalcularTotaisDaCompra(purchaseIds: string[]): Promise<void> {
  const ids = [...new Set(purchaseIds)]
  if (!ids.length) return
  const admin = createAdminClient()

  const soma = new Map<string, { custo: number; pecas: number }>()

  // Em blocos: `.in()` vai na URL, e o PostgREST devolve 414 perto de ~500 ids.
  for (let de = 0; de < ids.length; de += 150) {
    const { data: itens, error } = await admin
      .from('purchase_items')
      .select('purchase_id, quantity, subtotal')
      .in('purchase_id', ids.slice(de, de + 150))

    if (error) throw new Error(`Não foi possível recalcular o total da compra: ${error.message}`)

    for (const i of (itens ?? []) as Array<{ purchase_id: string; quantity: number; subtotal: number }>) {
      const a = soma.get(i.purchase_id) ?? { custo: 0, pecas: 0 }
      a.custo += Number(i.subtotal ?? 0)
      a.pecas += Number(i.quantity ?? 0)
      soma.set(i.purchase_id, a)
    }
  }

  for (const id of ids) {
    // Compra que ficou sem item nenhum vale zero — não fica com o total velho.
    // Aqui o zero é verdade: a leitura deu certo e não voltou item.
    const a = soma.get(id) ?? { custo: 0, pecas: 0 }
    const { error } = await admin.from('purchases').update({
      total_cost:  parseFloat(a.custo.toFixed(2)),
      total_items: a.pecas,
      updated_at:  new Date().toISOString(),
    }).eq('id', id)

    if (error) throw new Error(`Não foi possível gravar o total da compra: ${error.message}`)
  }
}

/** As compras em que uma peça aparece — para recalcular depois de apagá-la. */
export async function comprasDaPeca(productId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('purchase_items')
    .select('purchase_id')
    .eq('product_id', productId)

  // Sem isto, falhar aqui faria o delete seguir sem recalcular nada — e o
  // total da compra voltaria a mentir, que é o bug que isto existe para fechar.
  if (error) throw new Error(`Não foi possível achar a compra da peça: ${error.message}`)

  return [...new Set(((data ?? []) as Array<{ purchase_id: string }>).map(r => r.purchase_id))]
}
