'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile } from '@/lib/auth'
import { lojasDasTaxas } from './lojas'
import { MAQUINA } from '@/lib/taxasCartao'

/*
 * Taxas da maquininha (Laranjinha), POR LOJA. Server action é chamável direto
 * (console, curl): a loja que chega é conferida aqui contra as lojas da pessoa
 * (lojasDasTaxas), nunca aceita só porque a tela mandou.
 */

export async function salvarTaxa(input: {
  store_id: string
  brand: string
  card_type: 'debit' | 'credit'
  installments: number
  /** null = sem taxa (apaga a linha). */
  fee_pct: number | null
}): Promise<{ success: boolean; error?: string }> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }
  const lojas = await lojasDasTaxas(perfil)
  if (!lojas.some(l => l.id === input.store_id)) {
    return { success: false, error: 'Sem permissão para as taxas desta loja.' }
  }

  const { store_id, brand, card_type, installments, fee_pct } = input
  if (!/^[a-z_]{2,30}$/.test(brand)) return { success: false, error: 'Bandeira inválida.' }
  if (card_type !== 'debit' && card_type !== 'credit') return { success: false, error: 'Modalidade inválida.' }
  if (!Number.isInteger(installments) || installments < 1 || installments > 12
      || (card_type === 'debit' && installments !== 1)) {
    return { success: false, error: 'Parcelas inválidas.' }
  }
  if (fee_pct !== null && (!Number.isFinite(fee_pct) || fee_pct < 0 || fee_pct >= 100)) {
    return { success: false, error: 'A taxa deve ficar entre 0% e 99,99%.' }
  }

  const admin = createAdminClient()
  const chave = { store_id, acquirer: MAQUINA, brand, card_type, installments }
  const { error } = fee_pct === null
    ? await admin.from('card_fees').delete().match(chave)
    : await admin.from('card_fees').upsert(
        { ...chave, fee_pct: Math.round(fee_pct * 10000) / 10000, updated_at: new Date().toISOString(), updated_by: perfil.id },
        { onConflict: 'store_id,acquirer,card_type,brand,installments' },
      )
  if (error) return { success: false, error: 'Não consegui salvar a taxa. Tente de novo.' }

  revalidatePath('/configuracoes/taxas')
  return { success: true }
}
