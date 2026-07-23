/**
 * Normalização de texto para busca "inteligente" em dropdowns/comboboxes.
 *
 * Remove acentos e caixa para que a busca por trecho case independentemente de
 * acentuação: "claudia" encontra "Cláudia", "jose" encontra "José".
 *
 * Usar nos filtros client-side (CustomerCombobox, ProductCombobox, SearchableSelect, etc).
 */
export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** true se `haystack` contém o trecho `needle` ignorando acento e caixa. */
export function matchText(haystack: string | null | undefined, needle: string): boolean {
  const q = normalize(needle)
  if (q === '') return true
  return normalize(haystack).includes(q)
}

/** Só os dígitos de uma string (para busca por telefone/CPF). */
export function onlyDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}
