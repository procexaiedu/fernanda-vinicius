import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'

/** Só para relatórios. Nunca usar o diretório legado para oferecer uma nova venda. */
export async function diretorioVendedoras() {
  const admin = createAdminClient()
  const perfil = await requireProfile()
  const loja = lojaDoEscopo(perfil)
  let p = admin.from('sellers').select('id, full_name, store_id, is_active')
  let u = admin.from('users').select('id, full_name, store_id, is_active')
  if (loja) { p = p.eq('store_id', loja); u = u.or(`store_id.eq.${loja},store_id.is.null`) }
  const [pessoas, contas] = await Promise.all([
    p, u,
  ])
  if (pessoas.error || contas.error) throw new Error('Não foi possível ler as vendedoras e o histórico legado.')
  return [
    ...(pessoas.data ?? []).map(p => ({ ...p, id: `pessoa:${p.id}` })),
    ...(contas.data ?? []).map(u => ({ ...u, full_name: `${u.full_name} (legado)` })),
  ]
}
