import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * O conserto da loja: um serviço que a peça de venda não é.
 *
 * COMO A DONA EXPLICOU, na reunião de 09/09:
 *
 *   "O cliente leva uma peça para consertar, eu mando para o Ourives e ela paga
 *    aquilo que veio do Ourives. Então isso não vai ter custo. O custo que tem
 *    é o custo que a cliente vai pagar."
 *
 * A loja intermedia e não ganha — às vezes cobra um pouco a mais pelo
 * estacionamento. E o pagamento vem junto com a compra, num cartão só: "se ela
 * vai buscar um conserto, ela faz três compras, aí ela paga o conserto e compra
 * as três peças".
 *
 * POR QUE UM PRODUTO E NÃO UMA COLUNA NOVA NA VENDA
 *
 * `sale_items.product_id` é NOT NULL, e o sistema já sabe lidar com serviço:
 * produto com `is_service` não baixa estoque (ver o laço em salvarVenda). Usar
 * o que já existe evita migração e faz o conserto aparecer no detalhe da venda
 * como qualquer outra linha — que é como ela lê a venda.
 *
 * O CUSTO É SEMPRE ZERO. Não é peça comprada: o dinheiro que sai para o Ourives
 * é declarado uma vez por mês, em bloco ("o Ourives vai passar pra ela: o seu
 * mês ficou 3 mil"), e nunca no mesmo mês em que a cliente pagou.
 */

/** Marca a categoria do serviço; é por ela que o conserto é reconhecido. */
export const CATEGORIA_CONSERTO = 'conserto'

/**
 * Categoria da despesa com o Ourives — o outro lado do conserto.
 *
 * Mora aqui, e não no arquivo de ações do financeiro, porque arquivo
 * `'use server'` só exporta função assíncrona. E faz sentido: as duas pontas
 * da mesma conta ficam no mesmo lugar.
 */
export const CATEGORIA_OURIVES = 'ourives'

/**
 * O id do serviço de conserto da loja, criando-o se ainda não existir.
 *
 * Cria em vez de falhar de propósito: sem isso, uma loja nova (o CNPJ de
 * Campinas está para sair) teria o botão de conserto na tela e um erro no
 * balcão. O produto é único por loja — o valor cobrado varia por atendimento e
 * mora na linha da venda, não no cadastro.
 */
export async function produtoDeConserto(
  admin: SupabaseClient<any, any, any>,
  storeId: string,
): Promise<{ id: string | null; error?: string }> {
  const { data: existente } = await admin
    .from('products')
    .select('id')
    .eq('store_id', storeId)
    .eq('category', CATEGORIA_CONSERTO)
    .eq('is_service', true)
    .limit(1)
    .maybeSingle()

  if (existente?.id) return { id: existente.id }

  const { data: criado, error } = await admin
    .from('products')
    .insert({
      // O código não segue a numeração das peças: conserto não é comprado de
      // fornecedor e não entra em etiqueta.
      code:              `CONSERTO-${storeId.slice(0, 8)}`,
      name:              'Conserto',
      category:          CATEGORIA_CONSERTO,
      material:          CATEGORIA_CONSERTO,
      store_id:          storeId,
      supplier_id:       null,
      cost_price:        0,
      sale_price:        0,
      quantity_in_stock: 0,
      is_service:        true,
      is_active:         true,
    })
    .select('id')
    .single()

  if (error || !criado) return { id: null, error: error?.message ?? 'Não foi possível criar o serviço de conserto.' }
  return { id: criado.id }
}
