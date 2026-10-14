/** A maquininha da rede (decisão de 14/10/2026: uma só, nas duas lojas). */
export const MAQUINA = 'Laranjinha'

export interface TaxaCelula {
  brand: string
  card_type: 'debit' | 'credit'
  installments: number
  fee_pct: number
}

/** Bandeiras na ordem da tela (as mesmas do seletor do PDV, mesmo código). */
export const BANDEIRAS: { value: string; label: string }[] = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'elo', label: 'Elo' },
  { value: 'amex', label: 'Amex' },
  { value: 'hipercard', label: 'Hipercard' },
  { value: 'nao_informada', label: 'Sem bandeira no PDV' },
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
