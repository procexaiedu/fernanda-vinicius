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

export interface PecaDevolvida {
  product_id: string
  nome: string
  code: string
  barcode_number: string | null
  quantidade: number
  custo_unitario: number
  valor: number
  quando: string
}

export interface ConsignacaoDetalhe {
  id: string
  received_date: string
  return_deadline: string | null
  status: 'active' | 'settled' | 'returned'
  total_pieces: number
  /** O que veio no lote. IMUTÁVEL — é o que a fornecedora entregou. */
  total: number
  acertado: number
  /** Custo das peças que voltaram para a fornecedora. Abate do que se deve. */
  devolvido: number
  /** total − devolvido − acertado. Nunca negativo. */
  falta: number
  fornecedor: string | null
  loja: string | null
  min_purchase_pct: number | null
  acertos: Acerto[]
  devolucoes: PecaDevolvida[]
}

export interface ResultadoAcerto {
  success: boolean
  error?: string
}

/** Centavos inteiros — ver a nota em lib/compras/validate-payments. */
const emCentavos = (v: number) => Math.round(Number(v) * 100)

/**
 * As peças que voltaram para a fornecedora, e quanto elas abatem.
 *
 * ONDE ISSO MORA, E POR QUE NÃO NUMA COLUNA NOVA
 *
 * A devolução é uma baixa de estoque com motivo `devolucao_fornecedor`, feita
 * por `fv.baixar_estoque`, que já existe e já grava em `fv.stock_movements`.
 * Então o fato "esta peça voltou" JÁ está registrado — guardar o abatimento
 * numa coluna de `consignments` criaria uma segunda fonte do mesmo número, que
 * é como o `total_cost` da compra ficou mentindo quando alguém apaga uma peça.
 *
 * O total do lote (`total_cost_value`) continua imutável: é o que a fornecedora
 * entregou. O que muda é o DEVIDO, que é derivado.
 *
 * Custo: uma consulta a mais por lote. Aceitável — um lote tem dezenas de
 * peças, não milhares, e o número certo vale mais que a consulta economizada.
 */
async function calcularDevolucoes(
  admin: ReturnType<typeof createAdminClient>,
  consignmentId: string,
): Promise<{ devolvido: number; devolucoes: PecaDevolvida[] }> {
  const { data: pecas } = await admin
    .from('products')
    .select('id, name, code, barcode_number, cost_price')
    .eq('consignment_id', consignmentId)

  const lista = (pecas ?? []) as Array<{
    id: string; name: string; code: string; barcode_number: string | null; cost_price: number
  }>
  if (!lista.length) return { devolvido: 0, devolucoes: [] }

  const { data: movs } = await admin
    .from('stock_movements')
    .select('product_id, delta, created_at')
    .eq('reason', 'devolucao_fornecedor')
    .in('product_id', lista.map(p => p.id))
    .order('created_at', { ascending: false })

  const porPeca = new Map(lista.map(p => [p.id, p]))
  const devolucoes: PecaDevolvida[] = []
  let devolvido = 0

  for (const m of (movs ?? []) as Array<{ product_id: string; delta: number; created_at: string }>) {
    const p = porPeca.get(m.product_id)
    if (!p) continue
    // `delta` é negativo na baixa; o que voltou é o módulo dele.
    const qtd = Math.abs(Number(m.delta ?? 0))
    if (!qtd) continue
    const custo = Number(p.cost_price ?? 0)
    const valor = qtd * custo
    devolvido += valor
    devolucoes.push({
      product_id: p.id,
      nome: p.name,
      code: p.code,
      barcode_number: p.barcode_number,
      quantidade: qtd,
      custo_unitario: custo,
      valor,
      quando: m.created_at,
    })
  }

  return { devolvido: parseFloat(devolvido.toFixed(2)), devolucoes }
}

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

  const { devolvido, devolucoes } = await calcularDevolucoes(admin, id)

  /* `Math.max(0, …)` porque devolver quase tudo DEPOIS de já ter pago pode
     passar do total. O saldo negativo existiria de verdade — é crédito com a
     fornecedora —, mas o sistema não tem onde guardar isso e mostrar "falta
     -R$ 200" na tela dela não ajudaria em nada. Fica em zero e o extrato conta
     a história. */
  const falta = Math.max(0, total - devolvido - acertado)

  return {
    id: (lote as any).id,
    received_date: (lote as any).received_date,
    return_deadline: (lote as any).return_deadline,
    status: (lote as any).status,
    total_pieces: (lote as any).total_pieces,
    total,
    acertado,
    devolvido,
    devolucoes,
    falta: parseFloat(falta.toFixed(2)),
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
  /* Peça devolvida não se paga. Sem descontar aqui, o teto do acerto continuaria
     sendo o lote inteiro e ela conseguiria pagar por peça que já voltou. */
  const { devolvido } = await calcularDevolucoes(admin, dados.consignmentId)
  const falta = Math.max(0, total - devolvido - acertado)

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
 * Fecha o lote quando não se deve mais nada — e REABRE se voltar a dever.
 *
 * Os dois sentidos importam: sem o segundo, remover um acerto deixaria o lote
 * marcado como acertado enquanto ainda se deve ao fornecedor.
 *
 * O ALVO NÃO É MAIS O TOTAL DO LOTE. Desde a devolução por peça, o que se deve
 * é `total − devolvido`. Um lote de R$ 1.000 com R$ 400 em peça devolvida
 * fecha com R$ 600 pagos; comparar com os R$ 1.000 originais deixaria ele
 * aberto para sempre, cobrando um saldo que ela não deve mais.
 *
 * Três destinos, e a ordem importa:
 *   - voltou TUDO          → `returned`, mesmo sem acerto nenhum
 *   - pagou o que restava  → `settled`
 *   - ainda deve           → `active`
 */
async function fecharSeQuitou(consignmentId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: lote } = await admin
    .from('consignments').select('total_cost_value, status').eq('id', consignmentId).single()
  if (!lote) return

  const { data: acertos } = await admin
    .from('consignment_acertos').select('amount').eq('consignment_id', consignmentId)

  const soma = (acertos ?? []).reduce((s: number, a: any) => s + Number(a.amount), 0)
  const total = Number((lote as any).total_cost_value)
  const { devolvido } = await calcularDevolucoes(admin, consignmentId)

  const devido = total - devolvido
  const voltouTudo = emCentavos(devido) <= 1 && emCentavos(total) > 1
  const quitou = emCentavos(soma) >= emCentavos(devido) - 1

  const novo = voltouTudo ? 'returned' : quitou ? 'settled' : 'active'
  if (novo === (lote as any).status) return

  await admin.from('consignments').update({
    status: novo,
    settled_at: novo === 'settled' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', consignmentId)
}

/**
 * Acha uma peça DO LOTE pelo código bipado ou digitado.
 *
 * Ela pediu as duas entradas em 15/09: "eu vou estar com as peças na mão, eu
 * vou ter que ficar procurando... é melhor eu bipar ou digitar". Procurar numa
 * lista de 46 linhas com a peça na mão é o que faz alguém desistir e anotar no
 * papel.
 *
 * Casa por ETIQUETA, não por `code`: no lote da Emília, `FEF0989` cobre um
 * colar E uma pulseira. Casar por código devolveria a peça errada — o mesmo
 * erro que `receber_transferencia` evita usando `dest_product_id`.
 */
export async function buscarPecaDoLote(consignmentId: string, codigo: string): Promise<
  | { success: true; peca: { id: string; nome: string; code: string; barcode_number: string; saldo: number; custo: number } }
  | { success: false; error: string }
> {
  const admin = createAdminClient()

  const { data: lote } = await admin
    .from('consignments').select('store_id').eq('id', consignmentId).single()
  if (!lote) return { success: false, error: 'Consignação não encontrada.' }
  if (!(await podeMexer((lote as any).store_id))) {
    return { success: false, error: 'Esta consignação é de outra loja.' }
  }

  const termo = codigo.trim()
  if (!termo) return { success: false, error: 'Bipe ou digite o código.' }

  const { data: peca } = await admin
    .from('products')
    .select('id, name, code, barcode_number, quantity_in_stock, cost_price, consignment_id')
    .eq('barcode_number', termo)
    .maybeSingle()

  if (!peca) return { success: false, error: `Etiqueta ${termo} não está cadastrada.` }
  if ((peca as any).consignment_id !== consignmentId) {
    return { success: false, error: `${(peca as any).name} não é deste lote.` }
  }
  if (Number((peca as any).quantity_in_stock) <= 0) {
    return { success: false, error: `${(peca as any).name} já está sem saldo — vendida ou devolvida.` }
  }

  return {
    success: true,
    peca: {
      id: (peca as any).id,
      nome: (peca as any).name,
      code: (peca as any).code,
      barcode_number: (peca as any).barcode_number,
      saldo: Number((peca as any).quantity_in_stock),
      custo: Number((peca as any).cost_price ?? 0),
    },
  }
}

export interface ResultadoDevolucao extends ResultadoAcerto {
  devolvidas?: number
  falhas?: Array<{ nome: string; erro: string }>
}

/**
 * Devolve peças do lote para a fornecedora.
 *
 * "Eu não faço por valor, eu faço por peça, Felipe. Assim por valor pra mim não
 * é legal, eu tenho que saber a peça." (15/09)
 *
 * Cada peça sai por `fv.baixar_estoque` com motivo `devolucao_fornecedor` — a
 * mesma função da baixa manual, que já trata saldo, desativa o cadastro quando
 * zera e deixa rastro em `fv.stock_movements`. Não há caminho novo de escrita
 * em estoque aqui, de propósito: dois caminhos divergem com o tempo.
 *
 * O abatimento no saldo do lote é DERIVADO desse rastro (ver
 * `calcularDevolucoes`), então não existe número para desencontrar.
 *
 * PARCIAL É SUCESSO PARCIAL, e a tela precisa saber disso. Sem transação entre
 * as peças — cada `baixar_estoque` é a sua —, uma que falhe no meio não desfaz
 * as anteriores. Devolver em silêncio o que deu certo e calar o resto faria ela
 * entregar à fornecedora peça que o sistema ainda acha que está na loja.
 */
export async function devolverPecas(
  consignmentId: string,
  itens: Array<{ productId: string; quantidade: number }>,
  observacao?: string,
): Promise<ResultadoDevolucao> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()

  const { data: lote } = await admin
    .from('consignments').select('id, store_id, status').eq('id', consignmentId).single()
  if (!lote) return { success: false, error: 'Consignação não encontrada.' }
  if (!(await podeMexer((lote as any).store_id))) {
    return { success: false, error: 'Esta consignação é de outra loja.' }
  }
  if (!itens.length) return { success: false, error: 'Bipe ao menos uma peça.' }

  /* As peças são reconferidas contra o lote no servidor. O id vem da tela, e a
     tela não é autoridade sobre a qual lote a peça pertence. */
  const { data: doLote } = await admin
    .from('products')
    .select('id, name, quantity_in_stock')
    .eq('consignment_id', consignmentId)
    .in('id', itens.map(i => i.productId))

  const validas = new Map(
    ((doLote ?? []) as Array<{ id: string; name: string; quantity_in_stock: number }>)
      .map(p => [p.id, p]),
  )

  const falhas: Array<{ nome: string; erro: string }> = []
  let devolvidas = 0

  for (const item of itens) {
    const p = validas.get(item.productId)
    if (!p) {
      falhas.push({ nome: item.productId, erro: 'não é deste lote' })
      continue
    }

    const { data: r, error } = await admin.rpc('baixar_estoque', {
      p_product_id: item.productId,
      p_quantidade: item.quantidade,
      p_motivo:     'devolucao_fornecedor',
      p_user_id:    perfil.id,
      p_notas:      observacao?.trim() || 'Devolução de lote consignado',
    })

    if (error) { falhas.push({ nome: p.name, erro: error.message }); continue }

    const res = r as { success: boolean; error?: string }
    if (!res?.success) { falhas.push({ nome: p.name, erro: res?.error ?? 'erro desconhecido' }); continue }

    devolvidas += item.quantidade
  }

  // Devolver pode fechar o lote — ou reabrir um que estava 'settled'.
  await fecharSeQuitou(consignmentId)

  revalidatePath('/compras')
  revalidatePath('/estoque')
  revalidatePath('/produtos')

  if (falhas.length && !devolvidas) {
    return { success: false, error: 'Nenhuma peça foi devolvida.', falhas }
  }

  return { success: true, devolvidas, falhas: falhas.length ? falhas : undefined }
}
