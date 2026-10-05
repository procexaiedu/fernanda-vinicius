/**
 * Consignação ENTRE LOJAS (Campinas manda peças para Brasília vender) e o
 * acerto do que ficou no destino. Migration 20261005_transferencia_duas_pontas.
 *
 * CRITÉRIO DO ACERTO: o que não voltou vira conta a pagar do destino para a
 * origem. Padrão = preço de CUSTO (só repassa a mercadoria, sem margem entre
 * lojas). A Eleandra ainda vai confirmar; para cobrar pelo preço de venda,
 * troque para 'venda'. A função do banco aceita os dois.
 */
export const CRITERIO_ACERTO_CONSIGNACAO_LOJA: 'custo' | 'venda' = 'custo'

export type TipoRomaneio = 'transferencia' | 'consignacao' | 'devolucao_consignacao' | 'lote_fornecedor'

/** Nome na linguagem da loja. */
export const ROTULO_TIPO: Record<TipoRomaneio, string> = {
  transferencia:         'Transferência',
  consignacao:           'Consignação entre lojas',
  devolucao_consignacao: 'Devolução de consignação',
  lote_fornecedor:       'Lote do fornecedor',
}

/** Título do papel que vai na caixa. */
export const TITULO_ROMANEIO: Record<TipoRomaneio, string> = {
  transferencia:         'Romaneio de Transferência',
  consignacao:           'Romaneio de Consignação',
  devolucao_consignacao: 'Romaneio de Devolução de Consignação',
  lote_fornecedor:       'Romaneio de Lote do Fornecedor',
}

export function tipoRomaneio(v: unknown): TipoRomaneio {
  return v === 'consignacao' || v === 'devolucao_consignacao' || v === 'lote_fornecedor' ? v : 'transferencia'
}
