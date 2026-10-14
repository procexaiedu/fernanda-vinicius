'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile } from '@/lib/auth'
import { podeConfigurarLoja } from '@/lib/lojasQueAdministra'
import { MAQUINA } from '@/lib/taxasCartao'

/*
 * Taxas da maquininha (Laranjinha), POR LOJA. Server action é chamável direto
 * (console, curl): só vale a loja da SESSÃO (podeConfigurarLoja), nunca a que
 * a tela mandou. Outra loja = recusa, mesmo para o admin global.
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
  if (!(await podeConfigurarLoja(perfil, input.store_id))) {
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

/**
 * Prazo de recebimento (quando o dinheiro cai) por loja, bandeira e modalidade.
 * Mesma trava de loja das taxas. Vale para as vendas gravadas DAQUI EM DIANTE:
 * recebimento já gerado fica com a data que tinha (como a taxa, que é congelada).
 */
export async function salvarPrazo(input: {
  store_id: string
  brand: string
  card_type: 'debit' | 'credit'
  prazo_dias: number
  intervalo_dias: number
  dia_util: boolean
}): Promise<{ success: boolean; error?: string }> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }
  if (!(await podeConfigurarLoja(perfil, input.store_id))) {
    return { success: false, error: 'Sem permissão para os prazos desta loja.' }
  }
  const { store_id, brand, card_type, prazo_dias, intervalo_dias, dia_util } = input
  if (!/^[a-z_]{2,30}$/.test(brand)) return { success: false, error: 'Bandeira inválida.' }
  if (card_type !== 'debit' && card_type !== 'credit') return { success: false, error: 'Modalidade inválida.' }
  for (const n of [prazo_dias, intervalo_dias]) {
    if (!Number.isInteger(n) || n < 0 || n > 365) return { success: false, error: 'Prazo em dias: de 0 a 365.' }
  }
  if (typeof dia_util !== 'boolean') return { success: false, error: 'Dia útil inválido.' }

  const admin = createAdminClient()
  const { error } = await admin.from('card_prazos').upsert(
    { store_id, acquirer: MAQUINA, brand, card_type, prazo_dias, intervalo_dias, dia_util, updated_at: new Date().toISOString(), updated_by: perfil.id },
    { onConflict: 'store_id,acquirer,card_type,brand' },
  )
  if (error) return { success: false, error: 'Não consegui salvar o prazo. Tente de novo.' }

  revalidatePath('/configuracoes/taxas')
  return { success: true }
}
