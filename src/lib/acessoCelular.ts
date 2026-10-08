/**
 * Quem pode usar o sistema pelo CELULAR.
 *
 * Decisão da reunião de 06/10/2026 com a Eleandra: as vendedoras usam só o
 * computador da loja; ela (admin de Brasília) e a administração geral também
 * pelo celular, porque às vezes estão fora da loja e precisam consultar.
 *
 * Por PERFIL, não por pessoa: liberar a Eleandra é liberar o papel dela. Para
 * mudar a regra de um perfil, troque o valor aqui (um lugar só, sem migration).
 *
 * Isto é foco, não segurança: quem quiser engana o navegador. O que protege
 * dado é o corte de servidor (escopo de loja, acessoOperadora, exigirAdmin).
 * Puro, sem Next, para testar com `node --test`.
 */
export const CELULAR_LIBERADO: Record<'admin' | 'operator', boolean> = {
  admin: true,
  operator: false,
}

/**
 * O aparelho é celular ou tablet, pelo que o navegador declara.
 *
 * `Sec-CH-UA-Mobile: ?1` é o sinal do Chrome/Edge no Android. O User-Agent
 * cobre o resto (Safari no iPhone não manda client hints). iPad com "versão
 * para computador" se diz Macintosh: esse quem pega é o teste do navegador
 * (`semMouse`), no BloqueioCelular.
 */
export function ehCelular(userAgent: string | null | undefined, chUaMobile?: string | null): boolean {
  if (chUaMobile === '?1') return true
  if (!userAgent) return false
  return /Android|iPhone|iPod|iPad|Windows Phone|Mobi|webOS|BlackBerry/i.test(userAgent)
}

export function bloqueiaNoCelular(role: 'admin' | 'operator'): boolean {
  return !CELULAR_LIBERADO[role]
}

/** O que a tela diz quando barra. Uma frase só, a mesma no login e no sistema. */
export const MSG_USE_O_COMPUTADOR =
  'O sistema da loja abre só no computador da loja. Use o computador do balcão, por favor.'
