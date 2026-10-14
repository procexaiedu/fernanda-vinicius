/** A maquininha da rede (decisão de 14/10/2026: uma só, nas duas lojas). */
export const MAQUINA = 'Laranjinha'

export interface TaxaCelula {
  brand: string
  card_type: 'debit' | 'credit'
  installments: number
  fee_pct: number
}

/** Bandeiras na ordem da tela. As do PDV primeiro; o resto vem da planilha da Laranjinha. */
export const BANDEIRAS: { value: string; label: string; noPdv?: boolean }[] = [
  { value: 'visa', label: 'Visa', noPdv: true },
  { value: 'mastercard', label: 'Mastercard', noPdv: true },
  { value: 'elo', label: 'Elo', noPdv: true },
  { value: 'amex', label: 'Amex', noPdv: true },
  { value: 'hipercard', label: 'Hipercard', noPdv: true },
  { value: 'nao_informada', label: 'Sem bandeira no PDV', noPdv: true },
  { value: 'credz', label: 'Credz' },
  { value: 'jcb', label: 'JCB' },
  { value: 'banescard', label: 'Banescard' },
  { value: 'cup', label: 'CUP' },
  { value: 'sorocred', label: 'Sorocred' },
  { value: 'sicredi', label: 'Sicredi' },
  { value: 'diners', label: 'Diners' },
  { value: 'cabal', label: 'Cabal' },
]

export function rotuloBandeira(b: string | null): string {
  return BANDEIRAS.find(x => x.value === b)?.label ?? (b || 'Sem bandeira')
}
