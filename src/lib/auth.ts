import { cache } from 'react'
import { headers } from 'next/headers'
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
}

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

  return {
    id:         data.id,
    full_name:  data.full_name,
    role:       data.role as 'admin' | 'operator',
    store_id:   data.store_id,
    is_active:  data.is_active,
    store_name: store?.name,
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
