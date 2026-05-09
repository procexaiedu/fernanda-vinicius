'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export interface ActionResult {
  success: boolean
  error?: string
}

async function verifyAdmin(): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { userId: null, error: 'Apenas administradores podem transferir estoque.' }
  return { userId: user.id, error: null }
}

export async function createTransfer(data: {
  product_id: string
  from_store_id: string
  to_store_id: string
  quantity: number
  notes: string
}): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Não autenticado.' }

  const admin = createAdminClient()

  const { data: result, error } = await admin.rpc('transfer_stock', {
    p_product_id:    data.product_id,
    p_from_store_id: data.from_store_id,
    p_to_store_id:   data.to_store_id,
    p_quantity:      data.quantity,
    p_user_id:       userId,
    p_notes:         data.notes || null,
  })

  if (error) return { success: false, error: error.message }

  const json = result as { success: boolean; error?: string; transfer_id?: string }
  if (!json.success) return { success: false, error: json.error ?? 'Erro na transferência.' }

  revalidatePath('/estoque')
  revalidatePath('/estoque/transferencias')
  revalidatePath('/produtos')
  return { success: true }
}
