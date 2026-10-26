/** Identidades de pessoas e contas legadas nunca são intercambiáveis. */
export function chaveVendedora(s: { seller_person_id?: string | null; seller_id?: string | null }): string | null {
  return s.seller_person_id ? `pessoa:${s.seller_person_id}` : s.seller_id ?? null
}

export function pessoaDaChave(id: string | null): string | null {
  return id?.startsWith('pessoa:') ? id.slice(7) : null
}

