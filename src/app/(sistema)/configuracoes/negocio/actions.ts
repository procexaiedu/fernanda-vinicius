'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile } from '@/lib/auth'
import { podeConfigurarLoja } from '@/lib/lojasQueAdministra'

export interface ActionResult {
  success: boolean
  error?: string
}

/*
 * Regra do negócio é da LOJA (16/10/2026; regra do dev: na FV nada é global).
 * Eleandra muda só Brasília; a dona escolhe a loja. A loja que chega é
 * conferida aqui (podeConfigurarLoja): server action é chamável direto.
 */
export async function updateSetting(storeId: string, key: string, value: number): Promise<ActionResult> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }
  if (!(await podeConfigurarLoja(perfil, storeId))) {
    return { success: false, error: 'Sem permissão para a configuração desta loja.' }
  }
  if (typeof key !== 'string' || key.startsWith('meta_loja:') || !Number.isFinite(value)) {
    return { success: false, error: 'Configuração inválida.' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('settings')
    .upsert({ store_id: storeId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'store_id,key' })

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/negocio')
  return { success: true }
}
