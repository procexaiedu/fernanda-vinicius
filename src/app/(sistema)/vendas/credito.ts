'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, ehAdmin, lojaDoEscopo } from '@/lib/auth'

/**
 * Crédito da cliente (sobra de troca guardada) — ver
 * supabase/migrations/20261023_credito_cliente_troca.sql.
 *
 * O crédito é da LOJA que gerou: a loja sai sempre do perfil (`lojaDoEscopo`),
 * nunca só do navegador — Campinas não vê nem usa o crédito de Brasília. O
 * navegador não tem acesso às tabelas (RLS sem policy); tudo passa por aqui.
 *
 * Vendedora vê o saldo e usa no PDV; ajustar/zerar é só do admin.
 */

export interface MovimentoCredito {
  id: string
  quando: string
  tipo: 'gerou' | 'usou' | 'ajuste' | 'estorno'
  valor: number
  saldoDepois: number
  notas: string | null
}

export interface CreditoDaCliente {
  saldo: number
  /** Só vem quando pedido (ficha da cliente). */
  extrato?: MovimentoCredito[]
  podeAjustar: boolean
}

export async function buscarCreditoDaCliente(
  customerId: string,
  storeId: string | null,
  comExtrato = false,
): Promise<{ data: CreditoDaCliente | null; error?: string }> {
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active) return { data: null, error: 'Não autenticado.' }
  const loja = lojaDoEscopo(perfil, storeId)
  if (!loja || !customerId) return { data: { saldo: 0, extrato: [], podeAjustar: false } }

  const admin = createAdminClient()
  const [saldoRes, extratoRes] = await Promise.all([
    admin.from('customer_credits').select('balance').eq('store_id', loja).eq('customer_id', customerId).maybeSingle(),
    comExtrato
      ? admin.from('customer_credit_movements')
          .select('id, created_at, kind, amount, balance_after, notes')
          .eq('store_id', loja).eq('customer_id', customerId)
          .order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: null, error: null }),
  ])
  /* Falha de leitura NÃO vira "saldo zero": a vendedora diria à cliente que
   * ela não tem crédito. */
  if (saldoRes.error || extratoRes.error) {
    console.error('[credito] falha ao ler o crédito da cliente', saldoRes.error ?? extratoRes.error)
    return { data: null, error: 'Não consegui ler o crédito da cliente agora.' }
  }

  return {
    data: {
      saldo: Number(saldoRes.data?.balance ?? 0),
      extrato: comExtrato
        ? (extratoRes.data ?? []).map((m: Record<string, unknown>) => ({
            id:          m.id as string,
            quando:      m.created_at as string,
            tipo:        m.kind as MovimentoCredito['tipo'],
            valor:       Number(m.amount),
            saldoDepois: Number(m.balance_after),
            notas:       (m.notes as string | null) ?? null,
          }))
        : undefined,
      podeAjustar: ehAdmin(perfil),
    },
  }
}

export async function ajustarCreditoDaCliente(
  customerId: string,
  storeId: string | null,
  novoSaldo: number,
  motivo: string,
): Promise<{ success: boolean; error?: string; saldo?: number }> {
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active) return { success: false, error: 'Não autenticado.' }
  if (!ehAdmin(perfil)) return { success: false, error: 'Só a administração pode ajustar o crédito.' }
  const loja = lojaDoEscopo(perfil, storeId)
  if (!loja) return { success: false, error: 'Escolha a loja.' }
  if (!Number.isFinite(novoSaldo) || novoSaldo < 0) return { success: false, error: 'Saldo inválido.' }
  if (!motivo.trim()) return { success: false, error: 'Diga o motivo do ajuste.' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('ajustar_credito_cliente', {
    p_store_id: loja, p_customer_id: customerId, p_novo_saldo: Math.round(novoSaldo * 100) / 100,
    p_user_id: perfil.id, p_notes: motivo.trim(),
  })
  if (error) {
    console.error('[credito] ajuste falhou', error)
    return { success: false, error: 'Não consegui ajustar o crédito. Nada foi alterado — tente de novo.' }
  }
  revalidatePath('/clientes')
  return { success: true, saldo: Number(data) }
}
