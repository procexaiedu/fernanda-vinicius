'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, lojaDoEscopo, ehOperadora } from '@/lib/auth'

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
  /** Dia em que voltou pronta do ourives. Nulo nos consertos anteriores a 14/10. */
  prontoEm: string | null
  /** Quando a loja avisou a cliente. Nulo + status pronto = falta ligar. */
  clienteAvisadaEm: string | null
  notes: string | null
  /** Quanto foi cobrado, quando já houve venda. Vem da linha da venda. */
  valorCobrado: number | null
  /** Já passou pelo caixa? É o que decide se ela pode cobrar agora. */
  pago: boolean
}

export interface ResultadoConserto {
  success: boolean
  error?: string
}

async function escopo(): Promise<{ loja: string | null; userId: string; operadora: boolean } | null> {
  const perfil = await getProfile()
  if (!perfil) return null
  return { loja: lojaDoEscopo(perfil), userId: perfil.id, operadora: ehOperadora(perfil) }
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
    .select('id, peca, servico, recebido_em, prometido_para, status, entregue_em, pronto_em, cliente_avisada_em, notes, sale_item_id, customers(name, phone), sale_items(subtotal)')
    .gte('recebido_em', corte.toISOString().slice(0, 10))

  if (ctx.loja) q = q.eq('store_id', ctx.loja)

  const { data, error } = await q.order('recebido_em', { ascending: false })

  /* Falha NÃO é "nenhuma peça em conserto". Lista vazia aqui é a loja dizendo
     à cliente que a peça dela não está — com a peça na gaveta. */
  if (error) throw new Error(`Não foi possível carregar os consertos: ${error.message}`)

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
    prontoEm: c.pronto_em ? String(c.pronto_em).slice(0, 10) : null,
    clienteAvisadaEm: c.cliente_avisada_em ?? null,
    notes: c.notes,
    valorCobrado: c.sale_items?.subtotal != null ? Number(c.sale_items.subtotal) : null,
    pago: !!c.sale_item_id,
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

/*
 * `registrarPagamentoDoConserto` e `registrarConsertoDaVenda` moravam aqui.
 * Foram para `./interno.ts`: este arquivo é `'use server'`, e tudo que ele
 * exporta vira endpoint público — elas não checam login nem loja.
 */

export async function registrarConserto(dados: {
  customerId: string
  peca: string
  servico?: string
  /** Dia em que a peça entrou na loja. Vazio = hoje (o default da coluna). */
  recebidoEm?: string | null
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
  if (dados.recebidoEm && !/^\d{4}-\d{2}-\d{2}$/.test(dados.recebidoEm)) {
    return { success: false, error: 'Data de entrada inválida.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('consertos').insert({
    store_id:       ctx.loja,
    customer_id:    dados.customerId,
    peca:           dados.peca.trim(),
    servico:        dados.servico?.trim() || null,
    // Sem data, o default da coluna (CURRENT_DATE) decide.
    ...(dados.recebidoEm ? { recebido_em: dados.recebidoEm } : {}),
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
    .from('consertos').select('id, store_id, pronto_em').eq('id', id).maybeSingle()

  if (!alvo) return { success: false, error: 'Conserto não encontrado.' }
  if (ctx.loja && alvo.store_id !== ctx.loja) return { success: false, error: 'Este conserto é de outra loja.' }

  const hoje = new Date().toISOString().slice(0, 10)
  /*
   * "Voltou pronta" também vira data: é o que mede o tempo do ourives. Ao
   * entregar, a data de pronta fica (é história); voltar a etapa anterior a
   * apaga, junto com o aviso, porque a peça deixou de estar pronta.
   */
  const voltouAtras = status === 'recebido' || status === 'no_ourives'
  const { error } = await admin.from('consertos').update({
    status,
    entregue_em: status === 'entregue' ? hoje : null,
    pronto_em: status === 'pronto' ? hoje : voltouAtras ? null : alvo.pronto_em,
    ...(voltouAtras || status === 'pronto' ? { cliente_avisada_em: null } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: `Erro ao atualizar: ${error.message}` }

  revalidatePath('/consertos')
  return { success: true }
}

/**
 * "Avisei a cliente": tira a peça pronta da lista de quem falta ligar.
 *
 * Só vale para peça pronta. A loja vem do escopo, como em todo o arquivo.
 */
export async function marcarClienteAvisada(id: string): Promise<ResultadoConserto> {
  const ctx = await escopo()
  if (!ctx) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const { data: alvo, error: erroAlvo } = await admin
    .from('consertos').select('id, store_id, status').eq('id', id).maybeSingle()

  if (erroAlvo) return { success: false, error: `Não foi possível carregar o conserto: ${erroAlvo.message}` }
  if (!alvo) return { success: false, error: 'Conserto não encontrado.' }
  if (ctx.loja && alvo.store_id !== ctx.loja) return { success: false, error: 'Este conserto é de outra loja.' }
  if (alvo.status !== 'pronto') return { success: false, error: 'Só dá para avisar a cliente quando a peça está pronta.' }

  const agora = new Date().toISOString()
  const { error } = await admin.from('consertos')
    .update({ cliente_avisada_em: agora, updated_at: agora }).eq('id', id)
  if (error) return { success: false, error: `Erro ao salvar o aviso: ${error.message}` }

  revalidatePath('/consertos')
  return { success: true }
}

export async function removerConserto(id: string): Promise<ResultadoConserto> {
  const ctx = await escopo()
  if (!ctx) return { success: false, error: 'Não autenticado.' }

  /*
   * Mesma regra do `podeApagar` da tela (operadora não apaga). A tela só
   * esconde o botão; sem esta linha, a ação continuava aberta para quem a
   * chamasse direto — e apagar é o único gesto daqui que não deixa rastro.
   */
  if (ctx.operadora) return { success: false, error: 'Só administradores podem apagar um conserto.' }

  const admin = createAdminClient()
  const { data: alvo, error: erroAlvo } = await admin
    .from('consertos').select('id, store_id').eq('id', id).maybeSingle()

  if (erroAlvo) return { success: false, error: `Não foi possível carregar o conserto: ${erroAlvo.message}` }
  if (!alvo) return { success: false, error: 'Conserto não encontrado.' }
  if (ctx.loja && alvo.store_id !== ctx.loja) return { success: false, error: 'Este conserto é de outra loja.' }

  // O erro era ignorado: a tela recarregava, a peça continuava lá e ninguém
  // sabia por quê.
  const { error } = await admin.from('consertos').delete().eq('id', id)
  if (error) return { success: false, error: `Erro ao apagar: ${error.message}` }

  revalidatePath('/consertos')
  return { success: true }
}
