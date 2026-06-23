'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// ─── Quick-create de itens de catálogo a partir do grid de compra ─────────────
// Cadastro leve de fornecedor / categoria / material direto da tela Nova Compra,
// quando o valor digitado ainda não existe.

export interface QuickSupplierResult {
  success: boolean
  error?: string
  supplier?: { id: string; name: string; initials: string }
}

export interface QuickCategoryResult {
  success: boolean
  error?: string
  category?: { name: string; labelFormat: 'A' | 'B' }
}

export interface QuickMaterialResult {
  success: boolean
  error?: string
  material?: string
}

async function verifyAdmin(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()

  if (profile?.role !== 'admin') return { error: 'Acesso negado.' }
  return { error: null }
}

// ─── Fornecedor ────────────────────────────────────────────────────────────────

export async function criarFornecedorRapido(
  name: string,
  initials: string,
): Promise<QuickSupplierResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const cleanName     = name.trim()
  const cleanInitials = initials.trim().toUpperCase().slice(0, 2)
  if (!cleanName)     return { success: false, error: 'Informe o nome do fornecedor.' }
  if (!cleanInitials) return { success: false, error: 'Informe as iniciais.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('suppliers')
    .insert({ name: cleanName, initials: cleanInitials })
    .select('id, name, initials')
    .single()

  if (error || !data) return { success: false, error: error?.message ?? 'Erro ao criar fornecedor.' }

  revalidatePath('/fornecedores')
  revalidatePath('/compras/nova')
  return { success: true, supplier: { id: data.id, name: data.name, initials: data.initials } }
}

// ─── Categoria (com tipo de etiqueta) ────────────────────────────────────────────

export async function criarCategoriaRapida(
  name: string,
  labelFormat: 'A' | 'B',
): Promise<QuickCategoryResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const cleanName = name.trim()
  if (!cleanName) return { success: false, error: 'Informe o nome da categoria.' }

  const admin = createAdminClient()
  // is_active: true reativa caso a categoria tenha sido excluída (soft-delete) antes
  const { error } = await admin
    .from('category_label_mapping')
    .upsert({ category: cleanName, label_format: labelFormat, is_active: true }, { onConflict: 'category' })

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true, category: { name: cleanName, labelFormat } }
}

// ─── Material ────────────────────────────────────────────────────────────────────

export async function criarMaterialRapido(name: string): Promise<QuickMaterialResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const cleanName = name.trim()
  if (!cleanName) return { success: false, error: 'Informe o nome do material.' }

  const admin = createAdminClient()

  // Evita duplicar (índice é case-insensitive). Se já existe, reativa (caso tenha
  // sido excluído por soft-delete) e retorna o nome existente.
  const { data: existing } = await admin
    .from('materials')
    .select('id, name')
    .ilike('name', cleanName)
    .maybeSingle()

  if (existing) {
    await admin.from('materials').update({ is_active: true }).eq('id', existing.id)
    revalidatePath('/produtos')
    revalidatePath('/compras/nova')
    return { success: true, material: existing.name }
  }

  const { data, error } = await admin
    .from('materials')
    .insert({ name: cleanName })
    .select('name')
    .single()

  if (error || !data) return { success: false, error: error?.message ?? 'Erro ao criar material.' }

  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true, material: data.name }
}

// ─── Soft-delete (exclusão "visual": some do front, permanece no banco) ──────────

export interface DeleteResult { success: boolean; error?: string }

export async function excluirFornecedorRapido(id: string): Promise<DeleteResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin
    .from('suppliers')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/fornecedores')
  revalidatePath('/compras/nova')
  return { success: true }
}

export async function excluirCategoriaRapida(name: string): Promise<DeleteResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin
    .from('category_label_mapping')
    .update({ is_active: false })
    .eq('category', name)

  if (error) return { success: false, error: error.message }

  revalidatePath('/configuracoes/impressao')
  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true }
}

export async function excluirMaterialRapido(name: string): Promise<DeleteResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin
    .from('materials')
    .update({ is_active: false })
    .ilike('name', name)

  if (error) return { success: false, error: error.message }

  revalidatePath('/produtos')
  revalidatePath('/compras/nova')
  return { success: true }
}
