'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { lojaDoEscopo, requireProfile } from '@/lib/auth'

/**
 * Transferência entre lojas — romaneio, trânsito e conferência no destino.
 *
 * A regra de estoque toda mora nas funções de banco (ver a migration
 * 20260830_transferencias_romaneio.sql). Aqui só há permissão e transporte.
 * O motivo é o de sempre: mover saldo em várias linhas precisa de uma
 * transação e de `FOR UPDATE`; feito em TypeScript, dois envios simultâneos da
 * mesma peça leem o mesmo saldo e mandam a peça duas vezes.
 *
 * QUEM PODE O QUÊ
 * - Enviar e cancelar: só admin. Tira peça de uma loja e é decisão de gestão.
 * - Conferir o recebimento: quem está na loja de destino, admin ou não. É ela
 *   que abre a caixa; exigir admin faria a caixa esperar dias para virar estoque.
 */

export interface ActionResult {
  success: boolean
  error?: string
}

export interface ItemEnvio {
  product_id: string
  quantity: number
}

async function admin() {
  const p = await requireProfile()
  if (p.role !== 'admin') return { perfil: null, erro: 'Apenas administradores podem transferir estoque.' }
  return { perfil: p, erro: null }
}

function revalidarTudo() {
  revalidatePath('/estoque')
  revalidatePath('/estoque/transferencias')
  revalidatePath('/produtos')
}

/** Abre o romaneio e tira o saldo da origem. */
export async function enviarTransferencia(dados: {
  from_store_id: string
  to_store_id: string
  itens: ItemEnvio[]
  notes?: string
}): Promise<ActionResult & { transfer_id?: string }> {
  const { perfil, erro } = await admin()
  if (!perfil) return { success: false, error: erro! }

  if (!dados.itens.length) return { success: false, error: 'Bipe ao menos uma peça.' }
  if (dados.from_store_id === dados.to_store_id) {
    return { success: false, error: 'Origem e destino não podem ser a mesma loja.' }
  }

  const { data, error } = await createAdminClient().rpc('enviar_transferencia', {
    p_from_store_id: dados.from_store_id,
    p_to_store_id:   dados.to_store_id,
    p_itens:         dados.itens,
    p_user_id:       perfil.id,
    p_notes:         dados.notes?.trim() || null,
  })

  // Erro do banco é erro na tela. Uma peça que falhou derruba o romaneio
  // inteiro (a função é uma transação só), então engolir isso deixaria a
  // pessoa achando que mandou o que não mandou.
  if (error) return { success: false, error: error.message }

  const r = data as { success: boolean; error?: string; transfer_id?: string }
  if (!r.success) return { success: false, error: r.error ?? 'Erro ao enviar.' }

  revalidarTudo()
  return { success: true, transfer_id: r.transfer_id }
}

/**
 * Confere o que chegou. `recebidos` é o resultado da bipagem no destino:
 * peça do romaneio que não aparecer aqui conta como NÃO recebida.
 */
export async function receberTransferencia(
  transferId: string,
  recebidos: ItemEnvio[],
  observacao?: string,
): Promise<ActionResult & { status?: string; sobras?: number }> {
  const perfil = await requireProfile()

  const supa = createAdminClient()

  // A conferência é da loja que recebe. Sem isto, uma operadora de Campinas
  // poderia dar entrada numa caixa que está fisicamente em Brasília.
  const { data: transf, error: erroBusca } = await supa
    .from('transfers')
    .select('to_store_id, status')
    .eq('id', transferId)
    .maybeSingle()

  if (erroBusca) return { success: false, error: erroBusca.message }
  if (!transf)   return { success: false, error: 'Transferência não encontrada.' }

  if (perfil.role !== 'admin' && perfil.store_id !== transf.to_store_id) {
    return { success: false, error: 'Só a loja de destino confere esta transferência.' }
  }

  const { data, error } = await supa.rpc('receber_transferencia', {
    p_transfer_id: transferId,
    p_recebidos:   recebidos,
    p_user_id:     perfil.id,
    p_notes:       observacao?.trim() || null,
  })

  if (error) return { success: false, error: error.message }

  const r = data as { success: boolean; error?: string; status?: string; sobras?: number }
  if (!r.success) return { success: false, error: r.error ?? 'Erro ao conferir.' }

  revalidarTudo()
  return { success: true, status: r.status, sobras: r.sobras }
}

/** Devolve tudo para a origem. Só enquanto ainda está em trânsito. */
export async function cancelarTransferencia(
  transferId: string,
  motivo: string,
): Promise<ActionResult> {
  const { perfil, erro } = await admin()
  if (!perfil) return { success: false, error: erro! }

  if (!motivo.trim()) return { success: false, error: 'Diga o motivo do cancelamento.' }

  const { data, error } = await createAdminClient().rpc('cancelar_transferencia', {
    p_transfer_id: transferId,
    p_user_id:     perfil.id,
    p_motivo:      motivo.trim(),
  })

  if (error) return { success: false, error: error.message }

  const r = data as { success: boolean; error?: string }
  if (!r.success) return { success: false, error: r.error ?? 'Erro ao cancelar.' }

  revalidarTudo()
  return { success: true }
}

export interface PecaBipada {
  id: string
  code: string
  name: string
  barcode_number: string
  quantity_in_stock: number
  cost_price: number
}

/**
 * Acha a peça pelo código bipado, dentro de uma loja.
 *
 * Busca no servidor em vez de mandar o catálogo inteiro para o navegador: são
 * 1.244 produtos, e a lista cresce. Também evita o erro clássico de bipar uma
 * peça de outra loja e o sistema aceitar.
 */
export async function buscarPecaPorCodigo(
  barcode: string,
  storeId: string,
): Promise<{ success: true; peca: PecaBipada } | { success: false; error: string }> {
  const perfil = await requireProfile()
  // Quem tem loja só bipa peça dela — o id que vem da tela é sugestão.
  storeId = lojaDoEscopo(perfil, storeId) ?? storeId

  const { data, error } = await createAdminClient()
    .from('products')
    .select('id, code, name, barcode_number, quantity_in_stock, cost_price, store_id, is_active')
    .eq('barcode_number', barcode.trim())
    .maybeSingle()

  if (error)  return { success: false, error: error.message }
  if (!data)  return { success: false, error: `Código ${barcode} não está cadastrado.` }

  if (data.store_id !== storeId) {
    return { success: false, error: `${data.name} não é desta loja.` }
  }
  if (!data.is_active || data.quantity_in_stock <= 0) {
    return { success: false, error: `${data.name} está sem saldo nesta loja.` }
  }

  return {
    success: true,
    peca: {
      id:                data.id as string,
      code:              data.code as string,
      name:              data.name as string,
      barcode_number:    data.barcode_number as string,
      quantity_in_stock: data.quantity_in_stock as number,
      cost_price:        Number(data.cost_price ?? 0),
    },
  }
}

/**
 * Identifica uma etiqueta na CONFERÊNCIA do destino — sem exigir loja nem saldo.
 *
 * É outra pergunta que a da tela de envio. Aqui a peça bipada não está no
 * romaneio: pode ser de outra loja, pode estar zerada, pode nem ser cadastrada.
 * Só se quer saber quem ela é para registrar a sobra com um `product_id` de
 * verdade — sobra sem produto identificado não tem onde ser gravada, e viraria
 * um número solto na observação.
 */
export async function identificarEtiqueta(
  barcode: string,
): Promise<{ id: string; name: string; code: string } | null> {
  await requireProfile()

  const { data } = await createAdminClient()
    .from('products')
    .select('id, name, code')
    .eq('barcode_number', barcode.trim())
    .maybeSingle()

  if (!data) return null
  return { id: data.id as string, name: data.name as string, code: data.code as string }
}
