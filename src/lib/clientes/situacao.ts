/**
 * Situação da cliente: uma regra só para a lista, o detalhe e a planilha.
 *
 * Pedido da Eleandra (chamado #33, 12/11/2026): separar em três.
 *   - Sem compra: nenhuma compra lançada no sistema (quase todo o cadastro
 *     antigo). Antes contava como inativa e inflava o filtro.
 *   - Inativa: última compra há `diasInativa` dias ou mais. Ela usa 120; o
 *     número vem da configuração da loja (`inactive_customer_days`).
 *   - Ativa: comprou dentro do prazo.
 */
export type Situacao = 'ativa' | 'inativa' | 'sem_compra'

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  ativa:      'Ativa',
  inativa:    'Inativa',
  sem_compra: 'Sem compra',
}

export function situacaoDaCliente(ultimaCompra: string | null, diasInativa: number, agora = Date.now()): Situacao {
  if (!ultimaCompra) return 'sem_compra'
  const dias = (agora - new Date(ultimaCompra).getTime()) / 86400000
  return dias >= diasInativa ? 'inativa' : 'ativa'
}
