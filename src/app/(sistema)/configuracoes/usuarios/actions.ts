'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean
  error?: string
}

export interface CreateUserData {
  full_name: string
  email: string
  password: string
  role: 'admin' | 'operator'
  store_id: string | null
}

export interface UpdateUserData {
  full_name: string
  role: 'admin' | 'operator'
  store_id: string | null
}

// ─── Guard ────────────────────────────────────────────────────────────────────

async function verifyAdmin(): Promise<{ error: string | null }> {
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

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createUser(data: CreateUserData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  // 1. Criar no Supabase Auth
  const { data: authData, error: createErr } = await admin.auth.admin.createUser({
    email: data.email.trim().toLowerCase(),
    password: data.password,
    email_confirm: true,
  })

  if (createErr || !authData.user) {
    return { success: false, error: createErr?.message ?? 'Erro ao criar usuário no Auth.' }
  }

  // 2. Inserir em fv.users
  const { error: dbErr } = await admin.from('users').insert({
    id: authData.user.id,
    full_name: data.full_name.trim(),
    role: data.role,
    store_id: data.store_id || null,
    is_active: true,
  })

  if (dbErr) {
    // Rollback: remover do auth para não deixar usuário órfão
    await admin.auth.admin.deleteUser(authData.user.id)
    return { success: false, error: dbErr.message }
  }

  revalidatePath('/configuracoes/usuarios')
  return { success: true }
}

export async function updateUser(id: string, data: UpdateUserData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error: dbErr } = await admin
    .from('users')
    .update({
      full_name: data.full_name.trim(),
      role: data.role,
      store_id: data.store_id || null,
    })
    .eq('id', id)

  if (dbErr) return { success: false, error: dbErr.message }

  revalidatePath('/configuracoes/usuarios')
  return { success: true }
}

export async function toggleUserStatus(id: string, isActive: boolean): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  const { error: dbErr } = await admin
    .from('users')
    .update({ is_active: isActive })
    .eq('id', id)

  if (dbErr) return { success: false, error: dbErr.message }

  const { error: banErr } = await admin.auth.admin.updateUserById(id, {
    ban_duration: isActive ? 'none' : '876600h',
  })

  if (banErr) return { success: false, error: banErr.message }

  revalidatePath('/configuracoes/usuarios')
  return { success: true }
}

export async function resetPassword(id: string, newPassword: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(id, { password: newPassword })

  if (error) return { success: false, error: error.message }
  return { success: true }
}
