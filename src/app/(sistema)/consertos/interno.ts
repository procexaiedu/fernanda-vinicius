/*
 * Funções de conserto que SÓ o servidor chama — hoje, o salvamento da venda.
 *
 * Moravam em `actions.ts`, que é `'use server'`: tudo que ele exporta vira um
 * endpoint público, chamável pelo navegador com qualquer argumento. Estas duas
 * não checam login nem loja (quem checa é a venda, antes de chamá-las) — então
 * qualquer pessoa com o id de uma ação podia marcar conserto de outra loja
 * como pago ou criar conserto em nome de qualquer usuária.
 *
 * Aqui, sem `'use server'`, elas são funções comuns de módulo: só código de
 * servidor que as importa consegue chamá-las. O projeto não tem o pacote
 * `server-only`; o que impede o uso no navegador é o `createAdminClient`, que
 * depende da chave de serviço e não existe no bundle do cliente.
 */

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * PAGAR NÃO É ENTREGAR, e confundir os dois foi o meu erro.
 *
 * O dono corrigiu em 10/09: "ela diz se a cliente paga o conserto depois ou
 * antes". Quando paga adiantado, a peça CONTINUA NA LOJA — esperando o
 * ourives, ou esperando ela voltar. Marcar como entregue na hora do pagamento
 * apagaria da tela justamente a peça que ainda está aqui.
 *
 * Então a venda registra só o PAGAMENTO. Quem diz que a peça saiu é quem a
 * entregou, no botão "Cliente levou".
 *
 * LANÇA em caso de falha. Antes o erro do update era ignorado: a venda seguia,
 * o conserto continuava "sem pagamento" e a loja cobrava a cliente de novo.
 * A venda já envolve a chamada num try/catch que registra o problema sem
 * derrubar a venda — o que faltava era o erro chegar até lá.
 */
export async function registrarPagamentoDoConserto(consertoId: string, saleItemId: string): Promise<void> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('consertos').update({
    sale_item_id: saleItemId,
    updated_at:   new Date().toISOString(),
  }).eq('id', consertoId).select('id')

  if (error) throw new Error(`Não foi possível ligar o pagamento ao conserto: ${error.message}`)
  // Nenhuma linha = o conserto sumiu entre a tela e o salvamento. Também é falha.
  if (!data?.length) throw new Error('Conserto não encontrado ao registrar o pagamento.')
}

/**
 * Registra um conserto que nasceu da própria cobrança no PDV.
 *
 * Existe porque o desenho anterior deixava um buraco que o dono encontrou na
 * primeira vez que usou: ele cobrou dois consertos no PDV e não apareceu nada
 * na tela de Consertos. A linha da venda só sabia LIGAR a uma peça já
 * registrada — sem registro anterior, o conserto existia só como dinheiro.
 *
 * `ficouNaLoja` decide em que estado ele nasce, e é a diferença entre os dois
 * jeitos de a loja trabalhar:
 *
 *   pagou e levou na hora  → nasce ENTREGUE, vira histórico
 *   pagou adiantado        → nasce NA LOJA, e segue o fluxo até ela buscar
 *
 * LANÇA em caso de falha, pelo mesmo motivo da função acima: insert ignorado
 * era peça de cliente paga e sem registro de onde está.
 */
export async function registrarConsertoDaVenda(dados: {
  storeId: string
  customerId: string | null
  descricao: string | null
  saleItemId: string
  userId: string
  ficouNaLoja: boolean
}): Promise<void> {
  const admin = createAdminClient()
  const hoje = new Date().toISOString().slice(0, 10)

  const { error } = await admin.from('consertos').insert({
    store_id:     dados.storeId,
    customer_id:  dados.customerId,
    // Sem descrição digitada sobra o genérico — melhor que perder o registro.
    peca:         dados.descricao?.trim() || 'Conserto',
    recebido_em:  hoje,
    status:       dados.ficouNaLoja ? 'recebido' : 'entregue',
    entregue_em:  dados.ficouNaLoja ? null : hoje,
    sale_item_id: dados.saleItemId,
    user_id:      dados.userId,
  })

  if (error) throw new Error(`Não foi possível registrar o conserto da venda: ${error.message}`)
}
