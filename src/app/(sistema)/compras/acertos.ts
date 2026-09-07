'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, lojaDoEscopo } from '@/lib/auth'

export interface Acerto {
  id: string
  acerto_date: string
  amount: number
  payment_method: string | null
  notes: string | null
  usuario: string | null
}

export interface ConsignacaoDetalhe {
  id: string
  received_date: string
  return_deadline: string | null
  status: 'active' | 'settled' | 'returned'
  total_pieces: number
  total: number
  acertado: number
  falta: number
  fornecedor: string | null
  loja: string | null
  min_purchase_pct: number | null
  acertos: Acerto[]
}

export interface ResultadoAcerto {
  success: boolean
  error?: string
}

/** Centavos inteiros — ver a nota em lib/compras/validate-payments. */
const emCentavos = (v: number) => Math.round(Number(v) * 100)

/**
 * O lote é da loja de quem pediu?
 *
 * Mesma regra de 04/09: quem tem loja está preso a ela. Sem isto, a admin de
 * Brasília acertaria um lote de Campinas mandando outro id — e acerto vira
 * despesa no financeiro da outra loja.
 */
async function podeMexer(storeIdDoLote: string | null): Promise<boolean> {
  const perfil = await getProfile()
  if (!perfil) return false
  const escopo = lojaDoEscopo(perfil)
  return !escopo || escopo === storeIdDoLote
}

export async function buscarConsignacao(id: string): Promise<ConsignacaoDetalhe | null> {
  const admin = createAdminClient()

  const { data: lote } = await admin
    .from('consignments')
    .select('id, received_date, return_deadline, status, total_pieces, total_cost_value, min_purchase_pct, store_id, suppliers(name), stores(name)')
    .eq('id', id)
    .single()

  if (!lote || !(await podeMexer((lote as any).store_id))) return null

  const { data: acertos } = await admin
    .from('consignment_acertos')
    .select('id, acerto_date, amount, payment_method, notes, users(full_name)')
    .eq('consignment_id', id)
    .order('acerto_date', { ascending: false })

  const linhas = (acertos ?? []) as any[]
  const acertado = linhas.reduce((s, a) => s + Number(a.amount), 0)
  const total = Number((lote as any).total_cost_value)

  return {
    id: (lote as any).id,
    received_date: (lote as any).received_date,
    return_deadline: (lote as any).return_deadline,
    status: (lote as any).status,
    total_pieces: (lote as any).total_pieces,
    total,
    acertado,
    falta: parseFloat((total - acertado).toFixed(2)),
    fornecedor: (lote as any).suppliers?.name ?? null,
    loja: (lote as any).stores?.name ?? null,
    min_purchase_pct: (lote as any).min_purchase_pct,
    acertos: linhas.map(a => ({
      id: a.id,
      acerto_date: a.acerto_date,
      amount: Number(a.amount),
      payment_method: a.payment_method,
      notes: a.notes,
      usuario: a.users?.full_name ?? null,
    })),
  }
}

/**
 * Registra um pagamento parcial ao fornecedor do lote.
 *
 * É AQUI que o consignado vira despesa. Na entrada não vira: a peça ainda é do
 * fornecedor. Cada acerto gera uma `transactions` própria — sem ela o dinheiro
 * que sai para o fornecedor nunca apareceria no financeiro, que é como estava
 * até 07/09.
 *
 * A transação leva a LOJA do lote, diferente da compra própria (que abastece as
 * duas lojas numa ida só e por isso fica com `store_id` nulo). Aqui o lote é de
 * uma loja só, então o custo tem dono.
 */
export async function registrarAcerto(dados: {
  consignmentId: string
  data: string
  valor: number
  formaPagamento: string
  observacao?: string
}): Promise<ResultadoAcerto> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()

  const { data: lote } = await admin
    .from('consignments')
    .select('id, store_id, status, total_cost_value, suppliers(name)')
    .eq('id', dados.consignmentId)
    .single()

  if (!lote) return { success: false, error: 'Consignação não encontrada.' }
  if (!(await podeMexer((lote as any).store_id))) {
    return { success: false, error: 'Esta consignação é de outra loja.' }
  }

  const valor = Number(dados.valor)
  if (!Number.isFinite(valor) || valor <= 0) return { success: false, error: 'Informe o valor do acerto.' }
  if (!dados.data) return { success: false, error: 'Informe a data do acerto.' }

  // Quanto já foi pago — recalculado no servidor, nunca vindo da tela.
  const { data: jaFeitos } = await admin
    .from('consignment_acertos').select('amount').eq('consignment_id', dados.consignmentId)
  const acertado = (jaFeitos ?? []).reduce((s: number, a: any) => s + Number(a.amount), 0)
  const total = Number((lote as any).total_cost_value)
  const falta = total - acertado

  /*
   * Acertar mais do que falta é erro de digitação, não pagamento a maior.
   *
   * Barrar aqui evita duas coisas de uma vez: um lote marcado como acertado com
   * número que não fecha com nada, e uma despesa inflada no financeiro.
   */
  if (emCentavos(valor) > emCentavos(falta) + 1) {
    return {
      success: false,
      error: `Falta R$ ${falta.toFixed(2).replace('.', ',')} neste lote — o acerto não pode ser maior que isso.`,
    }
  }

  const fornecedor = (lote as any).suppliers?.name ?? 'fornecedor'

  const { data: tx, error: txErr } = await admin.from('transactions').insert({
    store_id: (lote as any).store_id,
    type: 'expense',
    amount: valor,
    category: 'acerto_consignacao',
    description: `Acerto de consignação — ${fornecedor}`,
    reference_type: 'consignment',
    reference_id: dados.consignmentId,
    user_id: perfil.id,
    payment_method: dados.formaPagamento || null,
    transaction_date: dados.data,
    due_date: dados.data,
    status: 'completed',
    paid_at: new Date().toISOString(),
  }).select('id').single()

  if (txErr || !tx) return { success: false, error: `Erro ao lançar a despesa: ${txErr?.message}` }

  const { error: acErr } = await admin.from('consignment_acertos').insert({
    consignment_id: dados.consignmentId,
    acerto_date: dados.data,
    amount: valor,
    payment_method: dados.formaPagamento || null,
    notes: dados.observacao?.trim() || null,
    transaction_id: tx.id,
    user_id: perfil.id,
  })

  if (acErr) {
    // A despesa já entrou: desfaz, senão sobra lançamento sem acerto por trás.
    await admin.from('transactions').delete().eq('id', tx.id)
    return { success: false, error: `Erro ao registrar o acerto: ${acErr.message}` }
  }

  await fecharSeQuitou(dados.consignmentId)

  revalidatePath('/compras')
  revalidatePath('/financeiro')
  return { success: true }
}

/** Remove um acerto e a despesa que ele gerou. */
export async function removerAcerto(acertoId: string): Promise<ResultadoAcerto> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()

  const { data: acerto } = await admin
    .from('consignment_acertos')
    .select('id, consignment_id, transaction_id, consignments(store_id)')
    .eq('id', acertoId)
    .single()

  if (!acerto) return { success: false, error: 'Acerto não encontrado.' }
  if (!(await podeMexer((acerto as any).consignments?.store_id ?? null))) {
    return { success: false, error: 'Esta consignação é de outra loja.' }
  }

  await admin.from('consignment_acertos').delete().eq('id', acertoId)
  if ((acerto as any).transaction_id) {
    await admin.from('transactions').delete().eq('id', (acerto as any).transaction_id)
  }

  // Desfazer um acerto pode reabrir um lote que estava fechado.
  await fecharSeQuitou((acerto as any).consignment_id)

  revalidatePath('/compras')
  revalidatePath('/financeiro')
  return { success: true }
}

/**
 * Fecha o lote quando a soma alcança o total — e REABRE se cair abaixo.
 *
 * Os dois sentidos importam: sem o segundo, remover um acerto deixaria o lote
 * marcado como acertado enquanto ainda se deve ao fornecedor.
 */
async function fecharSeQuitou(consignmentId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: lote } = await admin
    .from('consignments').select('total_cost_value, status').eq('id', consignmentId).single()
  if (!lote) return

  const { data: acertos } = await admin
    .from('consignment_acertos').select('amount').eq('consignment_id', consignmentId)

  const soma = (acertos ?? []).reduce((s: number, a: any) => s + Number(a.amount), 0)
  const quitou = emCentavos(soma) >= emCentavos(Number((lote as any).total_cost_value)) - 1

  /* Lote devolvido não volta a 'active' por conta de acerto — devolução é outra
   * decisão, tomada por quem devolveu as peças. */
  if ((lote as any).status === 'returned') return

  const novo = quitou ? 'settled' : 'active'
  if (novo === (lote as any).status) return

  await admin.from('consignments').update({
    status: novo,
    settled_at: quitou ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', consignmentId)
}
