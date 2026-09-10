'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatarNomeProprio } from '@/lib/nomeProprio'
import { getProfile, podeConfigurarRede } from '@/lib/auth'

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

/**
 * MEXER EM USUÁRIO É SÓ DO ADMIN GLOBAL.
 *
 * Conferia apenas `role === 'admin'` — e admin de loja também é admin. A
 * Eleandra, de Brasília, passava nas quatro ações:
 *
 *   createUser        criar gente em Campinas, ou criar um ADMIN GLOBAL
 *   updateUser        mudar papel e loja de qualquer um, inclusive o próprio
 *   toggleUserStatus  desativar a operadora da outra loja
 *   resetPassword     trocar a senha da DONA e tomar a conta
 *
 * A tela `/configuracoes/usuarios` já redirecionava quem não é global, mas
 * redirecionar não é trava: server action é chamável direto, e estas leem com
 * `createAdminClient()` (service_role, ignora RLS). Era o "jeito nº 2 de
 * errar" do nosso próprio artigo de escopo — esconder o caminho e achar que
 * fechou a porta.
 *
 * Pedido do dono em 10/09: "pense como 2 sistemas totalmente distintos. Admin
 * de Brasília não pode tornar-se global, apenas a admin global pode fazer
 * isso."
 *
 * `podeConfigurarRede` é a mesma regra que guarda lojas, metas e as regras do
 * negócio — usuário pertence a esse grupo: quem cria conta decide quem entra
 * nas duas lojas.
 */
async function verifyAdmin(): Promise<{ error: string | null }> {
  const perfil = await getProfile()
  if (!perfil) return { error: 'Não autenticado.' }
  if (!perfil.is_active) return { error: 'Conta inativa.' }

  if (!podeConfigurarRede(perfil)) {
    return { error: 'Só a administradora geral gerencia usuários.' }
  }
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
    full_name: formatarNomeProprio(data.full_name),
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
      full_name: formatarNomeProprio(data.full_name),
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
