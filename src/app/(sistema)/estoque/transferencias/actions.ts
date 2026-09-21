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
 * QUEM PODE O QUÊ — e são DOIS eixos, não um.
 *
 * PAPEL (o que a função permite):
 * - Enviar e cancelar: só admin. Tira peça de uma loja e é decisão de gestão.
 * - Conferir o recebimento: quem está na loja de destino, admin ou não. É ela
 *   que abre a caixa; exigir admin faria a caixa esperar dias para virar estoque.
 *
 * ESCOPO (de qual loja):
 * - Envia só da própria loja, confere só o que chega nela, cancela só o que ela
 *   mandou. O DESTINO continua livre — é, por definição, a outra loja.
 *
 * Confundir os dois foi o furo que sobrou da separação de 04/09: a lista já
 * filtrava por escopo, mas aqui só se olhava o papel, e a Eleandra — admin de
 * Brasília — podia tirar peça de Campinas, conferir caixa que estava lá e
 * cancelar romaneio alheio. Esconder o botão não resolve: server action é
 * chamável direto.
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
  /** IDA (envio): entra direto no destino, sem conferência. false = devolução (confere por bipe). */
  autoReceber?: boolean
}): Promise<ActionResult & { transfer_id?: string; autoRecebida?: boolean }> {
  const { perfil, erro } = await admin()
  if (!perfil) return { success: false, error: erro! }

  if (!dados.itens.length) return { success: false, error: 'Bipe ao menos uma peça.' }
  if (dados.from_store_id === dados.to_store_id) {
    return { success: false, error: 'Origem e destino não podem ser a mesma loja.' }
  }

  // A origem vem do escopo, não da tela — mesma regra do bipe logo abaixo.
  const escopo = lojaDoEscopo(perfil)
  if (escopo && dados.from_store_id !== escopo) {
    return { success: false, error: 'Você só pode enviar peças da sua própria loja.' }
  }

  const { data, error } = await createAdminClient().rpc('enviar_transferencia', {
    p_from_store_id: dados.from_store_id,
    p_to_store_id:   dados.to_store_id,
    p_itens:         dados.itens,
    p_user_id:       perfil.id,
    p_notes:         dados.notes?.trim() || null,
    p_auto_receber:  dados.autoReceber ?? false,
  })

  // Erro do banco é erro na tela. Uma peça que falhou derruba o romaneio
  // inteiro (a função é uma transação só), então engolir isso deixaria a
  // pessoa achando que mandou o que não mandou.
  if (error) return { success: false, error: error.message }

  const r = data as { success: boolean; error?: string; transfer_id?: string; auto_recebida?: boolean }
  if (!r.success) return { success: false, error: r.error ?? 'Erro ao enviar.' }

  revalidarTudo()
  return { success: true, transfer_id: r.transfer_id, autoRecebida: r.auto_recebida }
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

  if (lojaDoEscopo(perfil) && lojaDoEscopo(perfil) !== transf.to_store_id) {
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

  /*
   * Cancelar devolve o saldo para a ORIGEM, então quem cancela é quem mandou.
   * Sem esta busca não havia como saber de que loja era o romaneio — e por isso
   * qualquer admin cancelava qualquer um.
   */
  const escopo = lojaDoEscopo(perfil)
  if (escopo) {
    const { data: transf } = await createAdminClient()
      .from('transfers').select('from_store_id').eq('id', transferId).maybeSingle()

    if (!transf) return { success: false, error: 'Transferência não encontrada.' }
    if (transf.from_store_id !== escopo) {
      return { success: false, error: 'Só a loja que enviou pode cancelar esta transferência.' }
    }
  }

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
  /**
   * Preço de venda EFETIVO — promoção já aplicada, mesma regra do PDV e da
   * etiqueta (só vale se estiver ativa e maior que zero).
   *
   * Existe porque a dona precisa ver, enquanto monta o romaneio, quanto está
   * mandando a preço de venda: "eu vou vendo o valor total, eu vejo se tá bom
   * ou se eu mando mais" (15/09). Custo sozinho não responde essa pergunta.
   */
  sale_price: number
}

/** Preço que a cliente paga. Promoção só conta se ativa e maior que zero. */
function precoEfetivo(p: { sale_price: unknown; promotional_price: unknown; promotional_active: unknown }): number {
  const emPromo = !!p.promotional_active
    && p.promotional_price !== null
    && Number(p.promotional_price) > 0
  return Number(emPromo ? p.promotional_price : p.sale_price) || 0
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

  /*
   * PROCURA DENTRO DA LOJA. Desde 16/09 a etiqueta é única por loja, não na
   * rede: a mesma peça transferida existe com a mesma etiqueta em Campinas e
   * em Brasília. Buscar só pela etiqueta traria as duas e `.maybeSingle()`
   * estouraria.
   */
  const db = createAdminClient()
  const cod = barcode.trim()

  const { data, error } = await db
    .from('products')
    .select('id, code, name, barcode_number, quantity_in_stock, cost_price, store_id, is_active, sale_price, promotional_price, promotional_active')
    .eq('store_id', storeId)
    .eq('barcode_number', cod)
    .maybeSingle()

  if (error) return { success: false, error: error.message }

  if (!data) {
    // Não está nesta loja. Existe em outra? Muda a mensagem, que é o que diz à
    // pessoa se ela pegou a caixa errada ou se a etiqueta não existe.
    const { data: outra } = await db
      .from('products').select('name').eq('barcode_number', cod).limit(1).maybeSingle()
    return {
      success: false,
      error: outra ? `${outra.name} não é desta loja.` : `Código ${barcode} não está cadastrado.`,
    }
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
      sale_price:        precoEfetivo(data),
    },
  }
}

/**
 * Reconfere um romaneio em montagem que foi retomado do rascunho.
 *
 * O rascunho sobrevive a fechar a tela (ver NovaTransferenciaModal), e entre
 * bipar e enviar pode ter passado um dia: a peça pode ter sido vendida,
 * transferida por outra pessoa ou desativada. Devolver a lista velha como se
 * nada tivesse mudado é o mesmo erro de `(res.data ?? [])` — dado morto
 * entregue como dado vivo.
 *
 * Em blocos de 150, não uma consulta por peça. Antes era uma consulta só com
 * `.slice(0, 200)` — e a revisão de 16/09 pegou o furo: romaneio com mais de
 * 200 peças diferentes voltava com o excedente marcado como "sem saldo", e
 * sumia da lista. A dona manda "muita peça" de uma vez; 200 não é teto seguro.
 * O bloco existe porque `.in()` vai na URL e o PostgREST devolve 414 perto de
 * ~500 ids.
 */
export async function revalidarRascunho(
  productIds: string[],
  storeId: string,
): Promise<{ success: true; pecas: PecaBipada[] } | { success: false; error: string }> {
  const perfil = await requireProfile()
  storeId = lojaDoEscopo(perfil, storeId) ?? storeId

  if (!productIds.length) return { success: true, pecas: [] }

  const db = createAdminClient()
  const data = []
  for (let de = 0; de < productIds.length; de += 150) {
    const { data: bloco, error } = await db
      .from('products')
      .select('id, code, name, barcode_number, quantity_in_stock, cost_price, sale_price, promotional_price, promotional_active')
      .in('id', productIds.slice(de, de + 150))
      .eq('store_id', storeId)
      .eq('is_active', true)
      .gt('quantity_in_stock', 0)

    // Erro é erro. Devolver lista vazia aqui apagaria o romaneio inteiro da
    // tela e ela acharia que perdeu o trabalho de novo — exatamente o que isto
    // veio resolver.
    if (error) return { success: false, error: error.message }
    data.push(...(bloco ?? []))
  }

  return {
    success: true,
    pecas: data.map(p => ({
      id:                p.id as string,
      code:              p.code as string,
      name:              p.name as string,
      barcode_number:    p.barcode_number as string,
      quantity_in_stock: p.quantity_in_stock as number,
      cost_price:        Number(p.cost_price ?? 0),
      sale_price:        precoEfetivo(p),
    })),
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
 *
 * Desde 16/09 a mesma etiqueta pode existir nas duas lojas (é a mesma peça,
 * transferida). Prefere a linha da loja que está conferindo; se não houver,
 * aceita qualquer uma — basta para dizer o nome da peça.
 */
export async function identificarEtiqueta(
  barcode: string,
  lojaPreferida?: string | null,
): Promise<{ id: string; name: string; code: string } | null> {
  await requireProfile()

  const { data: linhas } = await createAdminClient()
    .from('products')
    .select('id, name, code, store_id')
    .eq('barcode_number', barcode.trim())
    .limit(10)

  const lista = (linhas ?? []) as Array<{ id: string; name: string; code: string; store_id: string | null }>
  const data = lista.find(p => p.store_id === lojaPreferida) ?? lista[0]

  if (!data) return null
  return { id: data.id, name: data.name, code: data.code }
}
