'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile } from '@/lib/auth'
import { podeConfigurarLoja } from '@/lib/lojasQueAdministra'

export type LabelFormat = 'A' | 'B'

export interface CategoryMapping {
  category: string
  label_format: LabelFormat
}

export interface ActionResult {
  success: boolean
  error?: string
}

/*
 * Etiqueta por categoria é da LOJA desde 16/10/2026 (regra do dev: Campinas e
 * Brasília não compartilham nada). Antes era da rede e só o admin global
 * mexia. Agora a Eleandra muda a de Brasília; a dona escolhe a loja. A loja que
 * chega é conferida aqui (podeConfigurarLoja): server action é chamável direto.
 */
async function verifyAdmin(storeId: string) {
  const perfil = await getProfile()
  if (!perfil) return { error: 'Não autenticado.' }
  if (!(await podeConfigurarLoja(perfil, storeId))) {
    return { error: 'Sem permissão para a configuração desta loja.' }
  }
  return { error: null }
}

export async function upsertCategoryMapping(storeId: string, category: string, label_format: LabelFormat): Promise<ActionResult> {
  const { error: authError } = await verifyAdmin(storeId)
  if (authError) return { success: false, error: authError }

  const admin = createAdminClient()
  // is_active: true reativa categorias que tenham sido excluídas (soft-delete)
  const { error } = await admin
    .from('category_label_mapping')
    .upsert({ store_id: storeId, category: category.trim(), label_format, is_active: true }, { onConflict: 'store_id,category' })

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true }
}

export async function renameCategoryMapping(
  storeId: string,
  oldCategory: string,
  newCategory: string,
  label_format: LabelFormat,
): Promise<ActionResult> {
  const { error: authError } = await verifyAdmin(storeId)
  if (authError) return { success: false, error: authError }

  const admin = createAdminClient()
  await admin.from('category_label_mapping').delete().eq('store_id', storeId).eq('category', oldCategory)
  const { error } = await admin
    .from('category_label_mapping')
    .insert({ store_id: storeId, category: newCategory.trim(), label_format })

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  return { success: true }
}

export async function deleteCategoryMapping(storeId: string, category: string): Promise<ActionResult> {
  const { error: authError } = await verifyAdmin(storeId)
  if (authError) return { success: false, error: authError }

  const admin = createAdminClient()
  // Soft-delete: some das listas mas permanece no banco (produtos vinculados intactos)
  const { error } = await admin
    .from('category_label_mapping')
    .update({ is_active: false })
    .eq('store_id', storeId)
    .eq('category', category)

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true }
}
