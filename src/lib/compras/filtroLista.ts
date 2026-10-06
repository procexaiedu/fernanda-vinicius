/*
 * Filtros da lista de /compras.
 *
 * Desde 07/09 todo lote consignado cria uma `purchase` com `consignment_id`, e
 * a página tira esse lote da lista de consignações para não aparecer duas
 * vezes. Até 06/10 os filtros "Consignações" e "Consig. ativa" e o card
 * "Consignações ativas" olhavam só para essa lista (que ficou com os lotes
 * antigos) e mostravam zero com lote ativo no banco. A consignação de hoje É a
 * compra ligada ao lote: é ela que estes filtros precisam enxergar.
 */

export type TipoFiltro = 'all' | 'purchase' | 'consignment'
export type StatusFiltro = 'all' | 'paid' | 'pending' | 'active'
export type StatusLote = 'active' | 'settled' | 'returned'

export interface LinhaCompra {
  type: 'purchase'
  paymentStatus: 'paid' | 'pending'
  consignment_id?: string | null
  /** Status do lote quando a compra é uma consignação. */
  consignmentStatus?: StatusLote | null
}

export interface LinhaLoteAntigo {
  type: 'consignment'
  status: StatusLote
}

export type LinhaLista = LinhaCompra | LinhaLoteAntigo

const STATUS_VALIDOS: StatusFiltro[] = ['all', 'paid', 'pending', 'active']

/** Valor salvo no navegador que não existe mais vira "todos", não some a lista. */
export function statusFiltroValido(v: unknown): StatusFiltro {
  return STATUS_VALIDOS.includes(v as StatusFiltro) ? (v as StatusFiltro) : 'all'
}

export function ehConsignacao(r: LinhaLista): boolean {
  return r.type === 'consignment' || !!r.consignment_id
}

export function ehConsignacaoAtiva(r: LinhaLista): boolean {
  return r.type === 'consignment'
    ? r.status === 'active'
    : !!r.consignment_id && r.consignmentStatus === 'active'
}

export function passaNoTipo(r: LinhaLista, tipo: TipoFiltro): boolean {
  if (tipo === 'all') return true
  return tipo === 'consignment' ? ehConsignacao(r) : !ehConsignacao(r)
}

/*
 * "Pago"/"Pendente" é pagamento de compra própria. A compra consignada não tem
 * pagamento na entrada (a linha mostra "A acertar"), então não entra nesses dois.
 */
export function passaNoStatus(r: LinhaLista, status: StatusFiltro): boolean {
  if (status === 'all') return true
  if (status === 'active') return ehConsignacaoAtiva(r)
  if (r.type === 'consignment' || r.consignment_id) return false
  return r.paymentStatus === status
}

export function contarConsignacoesAtivas(linhas: LinhaLista[]): number {
  return linhas.filter(ehConsignacaoAtiva).length
}
