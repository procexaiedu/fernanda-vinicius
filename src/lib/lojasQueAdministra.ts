import 'server-only'
import { ehAdmin, type UserProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * As lojas cuja CONFIGURAÇÃO esta pessoa pode ver e mudar: taxas de cartão,
 * regras do negócio, etiquetas por categoria.
 *
 * Config é da LOJA (regra do dev, 14/10/2026: na FV nada é global, Campinas e
 * Brasília não compartilham configuração). Quem tem `store_id` está preso a
 * ela: a Eleandra mexe só em Brasília. O admin global (a dona) mexe nas duas,
 * uma de cada vez. Operadora: nenhuma.
 *
 * É a mesma regra para a tela e para a server action: o servidor decide,
 * nunca o que vem do navegador.
 */
export async function lojasQueAdministra(perfil: UserProfile): Promise<{ id: string; name: string }[]> {
  if (!perfil.is_active || !ehAdmin(perfil)) return []
  const admin = createAdminClient()
  let q = admin.from('stores').select('id, name').eq('is_active', true)
  if (perfil.store_id) q = q.eq('id', perfil.store_id)
  const { data, error } = await q.order('name')
  if (error || !data) throw new Error('Não consegui ler as lojas.')
  return data
}

/**
 * A loja da tela de configuração: a pedida na URL só vale se for uma das dela;
 * senão a da sessão; senão a primeira. Sem loja nenhuma → null (não é admin).
 */
export async function lojaDaConfiguracao(
  perfil: UserProfile,
  pedida: string | undefined,
): Promise<{ loja: { id: string; name: string }; lojas: { id: string; name: string }[] } | null> {
  const lojas = await lojasQueAdministra(perfil)
  if (lojas.length === 0) return null
  const loja = lojas.find(l => l.id === pedida) ?? lojas.find(l => l.id === perfil.lojaSelecionada) ?? lojas[0]
  return { loja, lojas }
}

/** Guarda das server actions de configuração: a loja que chegou é dela? */
export async function podeConfigurarLoja(perfil: UserProfile | null, storeId: string): Promise<boolean> {
  if (!perfil || typeof storeId !== 'string') return false
  return (await lojasQueAdministra(perfil)).some(l => l.id === storeId)
}
