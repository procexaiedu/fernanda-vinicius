import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CABECALHO_USUARIO } from '@/lib/auth-header'

/**
 * Autenticação deduplicada por requisição.
 *
 * O problema que isto resolve: `auth.getUser()` NÃO é validação local de token —
 * é uma chamada HTTP à API de Auth do Supabase. E a busca do perfil em `fv.users`
 * é outra. Antes, cada navegação pagava esse par três vezes (proxy, layout e a
 * própria página), em série, com ~300ms de latência cada.
 *
 * `cache()` do React memoiza por passe de render: o layout resolve, e todas as
 * páginas e componentes daquela mesma requisição reaproveitam de graça.
 *
 * Regra: em Server Component, nunca chame `auth.getUser()` nem `from('users')`
 * direto para saber quem é o usuário. Use `requireProfile()`.
 */

export interface UserProfile {
  id: string
  full_name: string
  role: 'admin' | 'operator'
  store_id: string | null
  is_active: boolean
  /** Nome da loja vinculada, quando houver — vem do join, sem query extra. */
  store_name?: string
  /**
   * A loja que o ADMIN GLOBAL escolheu ao entrar. Null para quem tem loja fixa
   * (não escolhe) e para o admin global que ainda não escolheu.
   *
   * Fica separada de `store_id` de propósito: `store_id` é IDENTIDADE (a loja a
   * que a pessoa pertence) e é o que `ehAdminGlobal` usa para liberar a
   * configuração da rede. Sobrescrever `store_id` com a escolha da sessão
   * tiraria do admin global o acesso a lojas, usuários e metas.
   */
  lojaSelecionada: string | null
  lojaSelecionadaNome?: string
}

/** Nome do cookie que guarda a loja escolhida na sessão. */
export const COOKIE_LOJA = 'fv_loja'

/**
 * Id do usuário autenticado (ou null), sem chamada de rede no caminho normal.
 *
 * O proxy já validou o JWT nesta mesma requisição e passou o id no cabeçalho
 * interno (ver src/lib/auth-header.ts) — `getUser()` custa ~200ms de REDE, não é
 * validação local, e repetir aqui era pagar isso duas vezes por navegação.
 *
 * O fallback existe para o caso de a rota não passar pelo proxy: aí volta a
 * chamar a rede. Falha para o lado lento, nunca para o lado inseguro.
 */
export const getAuthUser = cache(async (): Promise<{ id: string } | null> => {
  const doProxy = (await headers()).get(CABECALHO_USUARIO)
  if (doProxy) return { id: doProxy }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? { id: user.id } : null
})

/**
 * Perfil do usuário logado, com o nome da loja no mesmo round trip.
 * Retorna null se não houver sessão ou se o perfil não existir.
 */
export const getProfile = cache(async (): Promise<UserProfile | null> => {
  const user = await getAuthUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, role, store_id, is_active, stores(name)')
    .eq('id', user.id)
    .single()

  if (!data) return null

  // O PostgREST devolve o join como objeto ou array dependendo da inferência de
  // cardinalidade; normalizamos os dois casos.
  const joined = data.stores as unknown
  const store = (Array.isArray(joined) ? joined[0] : joined) as { name: string } | null | undefined

  /*
   * A loja escolhida na sessão só existe para quem NÃO tem loja própria.
   *
   * Pedido da dona em 09/09: "eu quero abrir o sistema e ver só Campinas [...]
   * como se fosse dois clientes". Antes ela trocava de loja por um seletor
   * dentro de cada tela, e isso é o que ela chamava de mistura — dava para
   * estar vendo Campinas numa aba e Brasília em outra, ou clicar errado na
   * vendedora ao lançar uma venda.
   *
   * O cookie é VALIDADO contra o banco, não aceito como veio: um id inventado
   * no navegador daria acesso a uma loja que não existe, ou pior, contornaria
   * a checagem se um dia houver uma terceira.
   */
  let lojaSelecionada: string | null = null
  let lojaSelecionadaNome: string | undefined

  if (data.store_id === null) {
    const escolhida = (await cookies()).get(COOKIE_LOJA)?.value
    if (escolhida) {
      const { data: loja } = await supabase
        .from('stores').select('id, name').eq('id', escolhida).eq('is_active', true).maybeSingle()
      if (loja) {
        lojaSelecionada = loja.id
        lojaSelecionadaNome = loja.name
      }
    }
  }

  return {
    id:         data.id,
    full_name:  data.full_name,
    role:       data.role as 'admin' | 'operator',
    store_id:   data.store_id,
    is_active:  data.is_active,
    store_name: store?.name,
    lojaSelecionada,
    lojaSelecionadaNome,
  }
})

/**
 * Igual a `getProfile`, mas manda para /login se não houver sessão, se o perfil
 * não existir ou se a conta estiver inativa. É o guardião padrão das páginas.
 */
export async function requireProfile(): Promise<UserProfile> {
  const profile = await getProfile()
  if (!profile || !profile.is_active) redirect('/login')
  return profile
}

// ─── Hierarquia de acesso ─────────────────────────────────────────────────────

/**
 * Três níveis, e o banco já os representa — não precisou de coluna nova.
 *
 *   ADMIN GLOBAL    role='admin'    · store_id NULL   → vê as duas lojas
 *   ADMIN DE LOJA   role='admin'    · store_id setado → vê só a loja dele
 *   OPERADORA       role='operator' · store_id setado → só PDV e vendas do dia
 *
 * A regra que faz tudo funcionar é uma só: **quem tem `store_id` está preso a
 * ela**, seja admin ou não. Antes o código assumia que admin nunca tinha loja
 * (`isAdmin ? params.store_id : profile.store_id`), então um admin com loja
 * veria a rede inteira — o nível do meio não existia na prática.
 */

export function ehAdmin(p: UserProfile): boolean {
  return p.role === 'admin'
}

/** Vê as duas lojas e manda na configuração da rede. */
export function ehAdminGlobal(p: UserProfile): boolean {
  return p.role === 'admin' && p.store_id === null
}

/** Administra de verdade, mas dentro de uma loja só. */
export function ehAdminDeLoja(p: UserProfile): boolean {
  return p.role === 'admin' && p.store_id !== null
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
 */
export function lojaDoEscopo(p: UserProfile, filtroDaUrl?: string | null): string | null {
  return p.store_id ?? p.lojaSelecionada ?? (filtroDaUrl || null)
}

/**
 * Ainda faz sentido oferecer um seletor de loja DENTRO da tela?
 *
 * Desde 09/09, não. O admin global escolhe a loja ao entrar e fica nela até
 * trocar de propósito; um filtro por tela recriaria exatamente a mistura que a
 * dona pediu para acabar — "vai que eu clique errado" na vendedora.
 *
 * Continua sendo uma função, e não um `false` cravado nas telas, porque a regra
 * é essa: só quem vê as duas lojas ao mesmo tempo poderia filtrar entre elas. Se
 * um dia a escolha na entrada sair, o comportamento volta sozinho, certo.
 */
export function podeFiltrarPorLoja(p: UserProfile): boolean {
  return ehAdminGlobal(p) && !p.lojaSelecionada
}

/**
 * Precisa escolher a loja antes de usar o sistema?
 *
 * Só o admin global, e só enquanto não escolheu. Quem tem loja própria nunca vê
 * essa tela — entra direto, como sempre entrou.
 */
export function precisaEscolherLoja(p: UserProfile): boolean {
  return ehAdminGlobal(p) && !p.lojaSelecionada
}

/**
 * Configuração que vale para a rede: lojas, usuários, metas, regras do negócio.
 * Só o admin global. Um admin de loja que pudesse criar usuário ou mudar a
 * regra de desconto estaria mexendo na outra loja por tabela.
 */
export function podeConfigurarRede(p: UserProfile): boolean {
  return ehAdminGlobal(p)
}

/**
 * A operadora só tem PDV e as vendas do dia.
 *
 * Não é desconfiança: é foco. Ela atende no balcão com um computador só, e
 * cada tela a mais é uma tela onde dá para mudar preço, apagar peça ou ver
 * margem sem querer.
 */
export function ehOperadora(p: UserProfile): boolean {
  return p.role === 'operator'
}
