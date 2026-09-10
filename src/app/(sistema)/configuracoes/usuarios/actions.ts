'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatarNomeProprio } from '@/lib/nomeProprio'
import { getProfile, escopoDeUsuarios } from '@/lib/auth'

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
 * Quem pode mexer, e em quem.
 *
 * Conferia só `role === 'admin'` — e admin de loja TAMBÉM é admin. A Eleandra,
 * de Brasília, passava nas quatro ações: criava gente em Campinas, criava admin
 * GLOBAL, desativava a operadora da outra loja e trocava a senha da DONA.
 *
 * A tela já redirecionava, mas redirecionar não é trava: server action é
 * chamável direto, e estas leem com service_role, que ignora RLS.
 *
 * A regra de 10/09 não é "só o global mexe": é que **cada admin manda na
 * própria loja**. A Eleandra cria, edita e desativa gente de Brasília; só não
 * enxerga Campinas nem promove ninguém a global.
 */
async function verifyAdmin(): Promise<{ error: string | null; loja: string | null }> {
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active) return { error: 'Não autenticado.', loja: null }

  const escopo = escopoDeUsuarios(perfil)
  if (!escopo.pode) return { error: 'Acesso negado.', loja: null }

  return { error: null, loja: escopo.loja }
}

/**
 * A loja que este usuário PODE receber.
 *
 * Para admin de loja, é sempre a dele — o que vier da tela é ignorado. Sem
 * isso, bastava mandar outro `store_id` no payload para criar gente na outra
 * loja, ou mandar `null` para fabricar um admin global. As duas coisas foram
 * pedidas de forma explícita: *"não pode fazer nada global e nem ver nada de
 * Campinas"*.
 */
function lojaPermitida(lojaDoAdmin: string | null, lojaPedida: string | null): string | null {
  return lojaDoAdmin ?? lojaPedida
}

/**
 * O admin pode mexer NESTE usuário?
 *
 * Admin de loja só alcança quem é da loja dele. Admin global (`store_id` NULL)
 * nunca casa com uma loja, então fica naturalmente fora do alcance — é o que
 * impede a Eleandra de resetar a senha da dona.
 */
async function alcanca(lojaDoAdmin: string | null, alvoId: string): Promise<boolean> {
  if (!lojaDoAdmin) return true

  const admin = createAdminClient()
  const { data } = await admin.from('users').select('store_id').eq('id', alvoId).maybeSingle()
  return !!data && data.store_id === lojaDoAdmin
}

const FORA_DO_ALCANCE = 'Este usuário é de outra loja.'

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createUser(data: CreateUserData): Promise<ActionResult> {
  const { error: authErr, loja } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  // Admin de loja cria só para a loja dele — e nunca um global.
  const store_id = lojaPermitida(loja, data.store_id)
  if (loja && !store_id) return { success: false, error: 'Você só cria usuários da sua loja.' }
  data = { ...data, store_id }

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
  const { error: authErr, loja } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }
  if (!(await alcanca(loja, id))) return { success: false, error: FORA_DO_ALCANCE }

  // Nem mudar de loja, nem virar global: a loja do admin manda.
  data = { ...data, store_id: lojaPermitida(loja, data.store_id) }

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
  const { error: authErr, loja } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }
  if (!(await alcanca(loja, id))) return { success: false, error: FORA_DO_ALCANCE }

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
  const { error: authErr, loja } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }
  if (!(await alcanca(loja, id))) return { success: false, error: FORA_DO_ALCANCE }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(id, { password: newPassword })

  if (error) return { success: false, error: error.message }
  return { success: true }
}
