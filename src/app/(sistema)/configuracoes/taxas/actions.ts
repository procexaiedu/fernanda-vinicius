'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, podeConfigurarRede } from '@/lib/auth'
import { MAQUINA } from '@/lib/taxasCartao'

/*
 * Taxas da maquininha (Laranjinha). Valem para a REDE — uma máquina, a mesma
 * taxa nas duas lojas — então só o admin global muda. Server action é chamável
 * direto: a trava é aqui, não só na tela.
 */

export async function salvarTaxa(input: {
  brand: string
  card_type: 'debit' | 'credit'
  installments: number
  /** null = sem taxa (apaga a linha). */
  fee_pct: number | null
}): Promise<{ success: boolean; error?: string }> {
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active || !podeConfigurarRede(perfil)) {
    return { success: false, error: 'Só a administradora geral muda as taxas.' }
  }

  const { brand, card_type, installments, fee_pct } = input
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
  const chave = { acquirer: MAQUINA, brand, card_type, installments }
  const { error } = fee_pct === null
    ? await admin.from('card_fees').delete().match(chave)
    : await admin.from('card_fees').upsert(
        { ...chave, fee_pct: Math.round(fee_pct * 10000) / 10000, updated_at: new Date().toISOString(), updated_by: perfil.id },
        { onConflict: 'acquirer,card_type,brand,installments' },
      )
  if (error) return { success: false, error: 'Não consegui salvar a taxa. Tente de novo.' }

  revalidatePath('/configuracoes/taxas')
  return { success: true }
}
