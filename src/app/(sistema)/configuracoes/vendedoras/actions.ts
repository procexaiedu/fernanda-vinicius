'use server'

import { revalidatePath } from 'next/cache'
import { getProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function salvarVendedora(data: { id?: string; full_name: string; store_id: string; is_active: boolean }) {
  const perfil = await getProfile()
  if (!perfil?.is_active || perfil.role !== 'admin') return { success: false, error: 'Acesso restrito a administradores.' }
  const loja = lojaDoEscopo(perfil)
  if (!data || typeof data.full_name !== 'string' || typeof data.is_active !== 'boolean') return { success: false, error: 'Cadastro inválido.' }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(data.store_id) || (data.id && !uuid.test(data.id))) return { success: false, error: 'Cadastro inválido.' }
  const nome = data.full_name.trim().replace(/\s+/g, ' ')
  if (!nome || nome.length > 120 || !data.store_id) return { success: false, error: 'Informe nome (até 120 caracteres) e loja.' }
  if (loja && data.store_id !== loja) return { success: false, error: 'Escolha a loja da sua sessão.' }
  const admin = createAdminClient()
  if (data.id) {
    const { data: atual, error } = await admin.from('sellers').select('store_id').eq('id', data.id).single()
    if (error || !atual || (loja && atual.store_id !== loja)) return { success: false, error: 'Vendedora não encontrada.' }
    // Transferir um cadastro mudaria o sentido de referências históricas.
    if (atual.store_id !== data.store_id) return { success: false, error: 'A loja do cadastro não pode ser alterada. Cadastre a pessoa na outra loja.' }
  }
  const { data: destino, error: lojaErro } = await admin.from('stores').select('id').eq('id', data.store_id).eq('is_active', true).single()
  if (lojaErro || !destino) return { success: false, error: 'Loja inválida ou inativa.' }
  const valores = { full_name: nome, store_id: data.store_id, is_active: data.is_active }
  const { error } = data.id
    ? await admin.from('sellers').update(valores).eq('id', data.id)
    : await admin.from('sellers').insert(valores)
  if (error) return { success: false, error: error.code === '23505' ? 'Já existe uma vendedora com esse nome nesta loja, inclusive inativas.' : 'Não foi possível salvar a vendedora.' }
  for (const path of ['/configuracoes/vendedoras', '/pdv', '/vendas/nova']) revalidatePath(path)
  return { success: true }
}
