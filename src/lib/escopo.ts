/**
 * Escopo de loja — a parte PURA, sem Next nem Supabase, para dar para testar
 * com `node --test`. `src/lib/auth.ts` reexporta `lojaDoEscopo` daqui; importe
 * de lá nas telas, como sempre.
 */

/** O mínimo do perfil que decide a loja. `UserProfile` (auth.ts) encaixa aqui. */
export interface PerfilDeEscopo {
  role: 'admin' | 'operator'
  store_id: string | null
  lojaSelecionada: string | null
}

/**
 * A loja desta requisição; `null` significa "vê todas".
 *
 * Três origens, nesta ordem:
 *
 *   1. `store_id` — quem tem loja está PRESO a ela, admin ou não.
 *   2. `lojaSelecionada` — a que o admin global escolheu ao entrar (09/09).
 *   3. `filtroDaUrl` — o seletor da tela, que sobrou de antes.
 *
 * A escolha da sessão vence o filtro da tela de propósito. Enquanto os dois
 * competiam, dava para estar numa loja e ver dado da outra sem perceber, que é
 * exatamente o que a dona pediu para acabar.
 *
 * Para quem tem loja fixa o filtro é ignorado desde 01/09 — senão bastaria
 * editar a URL para ver a outra, e o escopo viraria enfeite.
 *
 * ⚠️ NUNCA filtre leitura por `profile.store_id` direto: para o admin global ele
 * é NULL mesmo com loja escolhida, e o "sem filtro" vira a rede inteira. Foi o
 * que vazou Campinas na lista de Vendas de Brasília em 08/10/2026.
 */
export function lojaDoEscopo(p: PerfilDeEscopo, filtroDaUrl?: string | null): string | null {
  return p.store_id ?? p.lojaSelecionada ?? (filtroDaUrl || null)
}

/** O pedaço do query builder do PostgREST que o escopo usa. */
interface ConsultaFiltravel<Q> {
  eq(coluna: string, valor: string): Q
  gte(coluna: string, valor: string): Q
  lte(coluna: string, valor: string): Q
}

/**
 * Corte de servidor da lista de Vendas (`/vendas`).
 *
 *   - loja: a de `lojaDoEscopo`. Sem loja só o admin global que ainda não
 *     escolheu, e esse é mandado para /escolher-loja antes de chegar aqui.
 *   - operadora: só HOJE (no fuso de Brasília). Não é sigilo, é o que ela
 *     precisa; e limitar aqui é o que impede que mudar o período na tela
 *     revele o resto.
 *
 * Os períodos da tela (hoje, 7 dias, 30 dias, mês, intervalo) filtram DEPOIS,
 * no navegador, sobre o que saiu daqui. Por isso o corte de loja tem que estar
 * aqui: o navegador só esconde, quem decide o que chega é o servidor.
 */
export function escopoDaListaDeVendas<Q extends ConsultaFiltravel<Q>>(
  consulta: Q,
  perfil: PerfilDeEscopo,
  hoje: string,
): Q {
  let q = consulta
  const loja = lojaDoEscopo(perfil)
  if (loja) q = q.eq('store_id', loja)
  if (perfil.role === 'operator') q = q.gte('sale_date', hoje).lte('sale_date', hoje)
  return q
}
