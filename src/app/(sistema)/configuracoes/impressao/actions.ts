'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, podeConfigurarRede } from '@/lib/auth'

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
 * SÓ O ADMIN GLOBAL.
 *
 * Conferia `role === 'admin'`, e admin de loja TAMBÉM é admin — a Eleandra, de
 * Brasília, passava. `category_label_mapping` NÃO tem coluna de loja: categoria e formato
 * de etiqueta são da rede, então Brasília mudaria a etiqueta de Campinas.
 *
 * A tela já redirecionava quem não é global, mas redirecionar não é trava:
 * server action é chamável direto, e estas leem com service_role. Pedido do
 * dono em 10/09 — "pense como 2 sistemas totalmente distintos".
 */
async function verifyAdmin() {
  const perfil = await getProfile()
  if (!perfil) return { error: 'Não autenticado.' }
  if (!podeConfigurarRede(perfil)) {
    return { error: 'Só a administradora geral muda esta configuração.' }
  }
  return { error: null }
}

export async function upsertCategoryMapping(category: string, label_format: LabelFormat): Promise<ActionResult> {
  const { error: authError } = await verifyAdmin()
  if (authError) return { success: false, error: authError }

  const admin = createAdminClient()
  // is_active: true reativa categorias que tenham sido excluídas (soft-delete)
  const { error } = await admin
    .from('category_label_mapping')
    .upsert({ category: category.trim(), label_format, is_active: true }, { onConflict: 'category' })

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true }
}

export async function renameCategoryMapping(
  oldCategory: string,
  newCategory: string,
  label_format: LabelFormat,
): Promise<ActionResult> {
  const { error: authError } = await verifyAdmin()
  if (authError) return { success: false, error: authError }

  const admin = createAdminClient()
  await admin.from('category_label_mapping').delete().eq('category', oldCategory)
  const { error } = await admin
    .from('category_label_mapping')
    .insert({ category: newCategory.trim(), label_format })

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  return { success: true }
}

export async function deleteCategoryMapping(category: string): Promise<ActionResult> {
  const { error: authError } = await verifyAdmin()
  if (authError) return { success: false, error: authError }

  const admin = createAdminClient()
  // Soft-delete: some das listas mas permanece no banco (produtos vinculados intactos)
  const { error } = await admin
    .from('category_label_mapping')
    .update({ is_active: false })
    .eq('category', category)

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true }
}
