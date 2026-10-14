import 'server-only'
import { redirect } from 'next/navigation'
import { ehAdmin, type UserProfile } from '@/lib/auth'
import { lojaDoEscopo } from '@/lib/escopo'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * A loja cuja CONFIGURAÇÃO esta pessoa vê e muda agora: taxas de cartão,
 * prazos, regras do negócio, etiquetas por categoria.
 *
 * Regra do dono (14/10/2026, inegociável): Campinas e Brasília são dois
 * sistemas separados. Nada de outra loja aparece na sessão de uma loja, nem
 * para o admin global. A loja é SEMPRE a do escopo da sessão (`lojaDoEscopo`):
 * a fixa de quem tem `store_id`, ou a que o admin global escolheu no "Trocar".
 * Nada vindo da URL ou do navegador escolhe loja. Operadora: nenhuma.
 */
export async function lojaDaSessaoParaConfig(perfil: UserProfile): Promise<{ id: string; name: string } | null> {
  if (!perfil.is_active || !ehAdmin(perfil)) return null
  const id = lojaDoEscopo(perfil)
  if (!id) return null
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('stores').select('id, name').eq('id', id).eq('is_active', true).maybeSingle()
  if (error) throw new Error('Não consegui ler a loja.')
  return data
}

/**
 * Para as páginas: a loja da sessão. Admin global sem loja escolhida vai
 * escolher (como o resto do sistema); quem não é admin volta ao início.
 */
export async function lojaDaConfiguracao(perfil: UserProfile): Promise<{ id: string; name: string }> {
  if (perfil.is_active && ehAdmin(perfil) && !lojaDoEscopo(perfil)) redirect('/escolher-loja')
  const loja = await lojaDaSessaoParaConfig(perfil)
  if (!loja) redirect('/')
  return loja
}

/** Guarda das server actions de configuração: só a loja da sessão, e ela precisa administrá-la. */
export async function podeConfigurarLoja(perfil: UserProfile | null, storeId: string): Promise<boolean> {
  if (!perfil || typeof storeId !== 'string') return false
  const loja = await lojaDaSessaoParaConfig(perfil)
  return !!loja && loja.id === storeId
}
