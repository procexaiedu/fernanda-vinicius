'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile, ehAdminGlobal, COOKIE_LOJA } from '@/lib/auth'

/**
 * Guarda na sessão a loja que o admin global escolheu.
 *
 * O id é conferido contra o banco antes de virar cookie. Aceitar o que vem da
 * tela seria confiar no navegador para decidir escopo — e escopo é a coisa que
 * este sistema mais protege desde 04/09.
 *
 * Quem tem loja própria não passa por aqui: a escolha não existe para ela, e
 * deixar essa ação disponível seria uma porta lateral para trocar de loja.
 */
export async function escolherLoja(storeId: string): Promise<{ error?: string }> {
  const perfil = await requireProfile()
  if (!ehAdminGlobal(perfil)) return { error: 'Sua conta já é de uma loja.' }

  const admin = createAdminClient()
  const { data: loja } = await admin
    .from('stores').select('id').eq('id', storeId).eq('is_active', true).maybeSingle()

  if (!loja) return { error: 'Loja não encontrada.' }

  /*
   * Sem `expires`: dura a sessão do navegador. Fechar e abrir volta a
   * perguntar, que é como a dona descreveu — "fecha o sistema, abre o sistema
   * e vejo como se fosse dois clientes".
   */
  ;(await cookies()).set(COOKIE_LOJA, loja.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })

  return {}
}

/** Volta para a escolha — o "trocar de loja" do cabeçalho. */
export async function trocarDeLoja(): Promise<void> {
  const perfil = await requireProfile()
  if (!ehAdminGlobal(perfil)) redirect('/')

  ;(await cookies()).delete(COOKIE_LOJA)
  redirect('/escolher-loja')
}
