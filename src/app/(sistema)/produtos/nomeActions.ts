'use server'

import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

/** Contexto do romaneio é conferido novamente, sob trava, pelo banco. */
export async function corrigirNomeProduto(productId: string, storeId: string, nome: string, nomeAnterior: string,
  romaneio?: { transferId: string; itemId: string }) {
  const perfil = await requireProfile()
  if (perfil.role !== 'admin') return { success: false, error: 'Somente administradores podem corrigir o nome.' }
  const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  if (!uuid(productId) || !uuid(storeId) || typeof nome !== 'string' || typeof nomeAnterior !== 'string'
    || (romaneio && (!uuid(romaneio.transferId) || !uuid(romaneio.itemId)))) {
    return { success: false, error: 'Cadastro da peça inválido. Reabra a peça.' }
  }
  const name = nome.trim()
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) {
    return { success: false, error: 'Informe um nome sem quebras de linha ou caracteres de controle.' }
  }
  const { data, error } = await createAdminClient().rpc('corrigir_nome_produto', {
    p_product_id: productId, p_store_id: storeId, p_name: name, p_expected_name: nomeAnterior,
    p_user_id: perfil.id, p_store_scope: lojaDoEscopo(perfil),
    p_transfer_id: romaneio?.transferId ?? null, p_item_id: romaneio?.itemId ?? null,
  })
  if (error || !data) return { success: false, error: 'Não foi possível confirmar o nome. Reabra a peça antes de tentar novamente.' }
  if (data.success) {
    for (const path of ['/produtos', '/estoque', '/estoque/transferencias', '/compras']) revalidatePath(path)
  }
  return data as { success: boolean; name?: string; error?: string }
}
