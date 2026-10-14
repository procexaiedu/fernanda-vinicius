import 'server-only'
import { ehAdmin, type UserProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * As lojas cujas taxas esta pessoa pode ver e mudar.
 *
 * Taxa é da LOJA (regra do dev, 14/10/2026: na FV nada é global, Campinas e
 * Brasília não compartilham configuração). Quem tem `store_id` está preso a
 * ela: a Eleandra mexe só em Brasília. O admin global (a dona) mexe nas duas,
 * uma de cada vez. Operadora: nenhuma.
 *
 * É a mesma regra para a tela e para a server action: o servidor decide,
 * nunca o que vem do navegador.
 */
export async function lojasDasTaxas(perfil: UserProfile): Promise<{ id: string; name: string }[]> {
  if (!perfil.is_active || !ehAdmin(perfil)) return []
  const admin = createAdminClient()
  let q = admin.from('stores').select('id, name').eq('is_active', true)
  if (perfil.store_id) q = q.eq('id', perfil.store_id)
  const { data, error } = await q.order('name')
  if (error || !data) throw new Error('Não consegui ler as lojas.')
  return data
}
