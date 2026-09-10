'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, lojaDoEscopo } from '@/lib/auth'

/**
 * A peça da cliente em conserto.
 *
 * O dinheiro NÃO mora aqui — ele vive na linha da venda, cobrado no PDV quando
 * a cliente vem buscar. Esta tabela responde a outra pergunta, que até agora
 * ninguém conseguia responder: **onde está a peça da fulana?**
 *
 * A ata de 09/09 encosta nisso sem nomear: "nunca entra no mesmo mês porque a
 * gente avisa o cliente que está lá, às vezes ela demora para buscar". A peça
 * fica na loja esperando, e uma peça de ouro esperando sem registro é o tipo de
 * coisa que só vira problema quando some.
 */

export type StatusConserto = 'recebido' | 'no_ourives' | 'pronto' | 'entregue'

export interface Conserto {
  id: string
  cliente: string
  clienteTelefone: string | null
  peca: string
  servico: string | null
  recebidoEm: string
  prometidoPara: string | null
  status: StatusConserto
  entregueEm: string | null
  notes: string | null
  /** Quanto foi cobrado, quando já houve venda. Vem da linha da venda. */
  valorCobrado: number | null
}

export interface ResultadoConserto {
  success: boolean
  error?: string
}

async function escopo(): Promise<{ loja: string | null; userId: string } | null> {
  const perfil = await getProfile()
  if (!perfil) return null
  return { loja: lojaDoEscopo(perfil), userId: perfil.id }
}

/**
 * Traz TUDO — abertos e entregues recentes — e quem separa é a tela.
 *
 * Buscava só os abertos, e isso criou uma armadilha que o dono encontrou na
 * primeira vez: conserto cobrado no PDV nasce ENTREGUE (a cliente pagou e
 * levou na hora), então ele sumia da lista no mesmo instante em que era
 * criado. A tela dizia "nenhuma peça em conserto" logo depois de registrar um.
 *
 * Com tudo em mãos, a tela mostra os abertos por padrão mas SABE quantos
 * entregues existem — e diz isso em vez de fingir que não há nada.
 *
 * O corte de 120 dias evita que a lista cresça para sempre; peça entregue há
 * quatro meses não é mais assunto de ninguém no balcão.
 */
export async function listarConsertos(): Promise<Conserto[]> {
  const ctx = await escopo()
  if (!ctx) return []

  const corte = new Date()
  corte.setDate(corte.getDate() - 120)

  const admin = createAdminClient()
  let q = admin
    .from('consertos')
    .select('id, peca, servico, recebido_em, prometido_para, status, entregue_em, notes, customers(name, phone), sale_items(subtotal)')
    .gte('recebido_em', corte.toISOString().slice(0, 10))

  if (ctx.loja) q = q.eq('store_id', ctx.loja)

  const { data } = await q.order('recebido_em', { ascending: false })

  return ((data ?? []) as any[]).map(c => ({
    id: c.id,
    cliente: c.customers?.name ?? 'Sem cliente',
    clienteTelefone: c.customers?.phone ?? null,
    peca: c.peca,
    servico: c.servico,
    recebidoEm: String(c.recebido_em).slice(0, 10),
    prometidoPara: c.prometido_para ? String(c.prometido_para).slice(0, 10) : null,
    status: c.status,
    entregueEm: c.entregue_em ? String(c.entregue_em).slice(0, 10) : null,
    notes: c.notes,
    valorCobrado: c.sale_items?.subtotal != null ? Number(c.sale_items.subtotal) : null,
  }))
}

export interface ConsertoAberto {
  id: string
  rotulo: string
}

/**
 * Os consertos desta cliente que ainda não foram entregues.
 *
 * Alimenta o PDV: quando a cliente vem buscar a peça e pagar, a linha de
 * conserto da venda aponta para o registro, e ele se fecha sozinho. Sem isto,
 * cobrar e devolver eram dois gestos desligados — ela cobrava na venda e o
 * conserto continuava marcado como "na loja" para sempre.
 */
export async function consertosAbertosDaCliente(customerId: string): Promise<ConsertoAberto[]> {
  const ctx = await escopo()
  if (!ctx || !customerId) return []

  const admin = createAdminClient()
  let q = admin
    .from('consertos')
    .select('id, peca, servico, recebido_em, status')
    .eq('customer_id', customerId)
    .neq('status', 'entregue')

  if (ctx.loja) q = q.eq('store_id', ctx.loja)

  const { data } = await q.order('recebido_em', { ascending: false })

  return ((data ?? []) as any[]).map(c => ({
    id: c.id,
    // O rótulo carrega o que ela precisa para reconhecer a peça no balcão.
    rotulo: [c.peca, c.servico].filter(Boolean).join(' — '),
  }))
}

/**
 * PAGAR NÃO É ENTREGAR, e confundir os dois foi o meu erro.
 *
 * O dono corrigiu em 10/09: "ela diz se a cliente paga o conserto depois ou
 * antes". Quando paga adiantado, a peça CONTINUA NA LOJA — esperando o
 * ourives, ou esperando ela voltar. Marcar como entregue na hora do pagamento
 * apagaria da tela justamente a peça que ainda está aqui.
 *
 * Então a venda registra só o PAGAMENTO. Quem diz que a peça saiu é quem a
 * entregou, no botão "Cliente levou".
 */
export async function registrarPagamentoDoConserto(consertoId: string, saleItemId: string): Promise<void> {
  const admin = createAdminClient()
  await admin.from('consertos').update({
    sale_item_id: saleItemId,
    updated_at:   new Date().toISOString(),
  }).eq('id', consertoId)
}

/**
 * Registra um conserto que nasceu da própria cobrança no PDV.
 *
 * Existe porque o desenho anterior deixava um buraco que o dono encontrou na
 * primeira vez que usou: ele cobrou dois consertos no PDV e não apareceu nada
 * na tela de Consertos. A linha da venda só sabia LIGAR a uma peça já
 * registrada — sem registro anterior, o conserto existia só como dinheiro.
 *
 * `ficouNaLoja` decide em que estado ele nasce, e é a diferença entre os dois
 * jeitos de a loja trabalhar:
 *
 *   pagou e levou na hora  → nasce ENTREGUE, vira histórico
 *   pagou adiantado        → nasce NA LOJA, e segue o fluxo até ela buscar
 */
export async function registrarConsertoDaVenda(dados: {
  storeId: string
  customerId: string | null
  descricao: string | null
  saleItemId: string
  userId: string
  ficouNaLoja: boolean
}): Promise<void> {
  const admin = createAdminClient()
  const hoje = new Date().toISOString().slice(0, 10)

  await admin.from('consertos').insert({
    store_id:     dados.storeId,
    customer_id:  dados.customerId,
    // Sem descrição digitada sobra o genérico — melhor que perder o registro.
    peca:         dados.descricao?.trim() || 'Conserto',
    recebido_em:  hoje,
    status:       dados.ficouNaLoja ? 'recebido' : 'entregue',
    entregue_em:  dados.ficouNaLoja ? null : hoje,
    sale_item_id: dados.saleItemId,
    user_id:      dados.userId,
  })
}

export async function registrarConserto(dados: {
  customerId: string
  peca: string
  servico?: string
  prometidoPara?: string | null
  notes?: string
}): Promise<ResultadoConserto> {
  const ctx = await escopo()
  if (!ctx) return { success: false, error: 'Não autenticado.' }

  /*
   * A loja vem do escopo, nunca da tela. Desde 04/09 é assim em todo o
   * sistema: quem tem loja está preso a ela, e o admin global escolhe ao
   * entrar.
   */
  if (!ctx.loja) return { success: false, error: 'Escolha a loja antes de registrar um conserto.' }
  if (!dados.customerId) return { success: false, error: 'Selecione a cliente — a peça é dela.' }
  if (!dados.peca?.trim()) return { success: false, error: 'Diga qual é a peça.' }

  const admin = createAdminClient()
  const { error } = await admin.from('consertos').insert({
    store_id:       ctx.loja,
    customer_id:    dados.customerId,
    peca:           dados.peca.trim(),
    servico:        dados.servico?.trim() || null,
    prometido_para: dados.prometidoPara || null,
    notes:          dados.notes?.trim() || null,
    user_id:        ctx.userId,
  })

  if (error) return { success: false, error: `Erro ao registrar: ${error.message}` }

  revalidatePath('/consertos')
  return { success: true }
}

/**
 * Move a peça no fluxo.
 *
 * "Entregue" grava a data — é a única mudança de status que vira registro de
 * quando aconteceu, porque é a que encerra a responsabilidade da loja sobre uma
 * peça que não é dela.
 */
export async function mudarStatus(id: string, status: StatusConserto): Promise<ResultadoConserto> {
  const ctx = await escopo()
  if (!ctx) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()

  const { data: alvo } = await admin
    .from('consertos').select('id, store_id').eq('id', id).maybeSingle()

  if (!alvo) return { success: false, error: 'Conserto não encontrado.' }
  if (ctx.loja && alvo.store_id !== ctx.loja) return { success: false, error: 'Este conserto é de outra loja.' }

  const hoje = new Date().toISOString().slice(0, 10)
  const { error } = await admin.from('consertos').update({
    status,
    entregue_em: status === 'entregue' ? hoje : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: `Erro ao atualizar: ${error.message}` }

  revalidatePath('/consertos')
  return { success: true }
}

export async function removerConserto(id: string): Promise<ResultadoConserto> {
  const ctx = await escopo()
  if (!ctx) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: alvo } = await admin
    .from('consertos').select('id, store_id').eq('id', id).maybeSingle()

  if (!alvo) return { success: false, error: 'Conserto não encontrado.' }
  if (ctx.loja && alvo.store_id !== ctx.loja) return { success: false, error: 'Este conserto é de outra loja.' }

  await admin.from('consertos').delete().eq('id', id)

  revalidatePath('/consertos')
  return { success: true }
}
