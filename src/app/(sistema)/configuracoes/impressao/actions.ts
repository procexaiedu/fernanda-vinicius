'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type LabelFormat = 'A' | 'B'

export interface CategoryMapping {
  category: string
  label_format: LabelFormat
}

export interface ActionResult {
  success: boolean
  error?: string
}

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { error: 'Acesso negado.' }
  return { error: null }
}

export async function upsertCategoryMapping(category: string, label_format: LabelFormat): Promise<ActionResult> {
  const { error: authError } = await verifyAdmin()
  if (authError) return { success: false, error: authError }

  const admin = createAdminClient()
  const { error } = await admin
    .from('category_label_mapping')
    .upsert({ category: category.trim(), label_format }, { onConflict: 'category' })

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
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
  const { error } = await admin
    .from('category_label_mapping')
    .delete()
    .eq('category', category)

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  return { success: true }
}
