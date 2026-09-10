'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, podeConfigurarRede } from '@/lib/auth'

export interface ActionResult {
  success: boolean
  error?: string
}

/*
 * SÓ O ADMIN GLOBAL.
 *
 * Conferia `role === 'admin'`, e admin de loja TAMBÉM é admin — a Eleandra, de
 * Brasília, passava. Desconto, reserva de compra e prazos valem para a REDE:
 * um admin de loja mudando aqui muda a outra loja junto.
 *
 * A tela já redirecionava quem não é global, mas redirecionar não é trava:
 * server action é chamável direto, e estas leem com service_role. Pedido do
 * dono em 10/09 — "pense como 2 sistemas totalmente distintos".
 */
async function verifyAdmin(): Promise<{ error: string | null }> {
  const perfil = await getProfile()
  if (!perfil) return { error: 'Não autenticado.' }
  if (!podeConfigurarRede(perfil)) {
    return { error: 'Só a administradora geral muda esta configuração.' }
  }
  return { error: null }
}

export async function updateSetting(key: string, value: number): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin
    .from('settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/negocio')
  return { success: true }
}
