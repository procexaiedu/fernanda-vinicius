'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProfile, lojaDoEscopo } from '@/lib/auth'
import { CATEGORIA_OURIVES } from '@/lib/conserto'

/**
 * O balanço do conserto: o que entrou das clientes contra o que saiu ao Ourives.
 *
 * A DONA EXPLICOU ASSIM, na reunião de 09/09:
 *
 *   "Teve 10 vendas de conserto, 50 reais cada: 500 reais. Aí no fim do mês ela
 *    declara: gastei 450 com o Ourives. O sistema pega a receita de conserto
 *    menos o que ela declarou. Dá um balanço positivo de 50 reais de lucro em
 *    cima de conserto. E aí não vai dar falha no caixa."
 *
 * A última frase é o motivo de existir: sem o outro lado, o dinheiro do
 * conserto entra como receita sem contrapartida nenhuma e o caixa fica inflado.
 *
 * OS DOIS LADOS QUASE NUNCA CAEM NO MESMO MÊS, e isso é o normal do negócio:
 *
 *   "Nunca entra no mesmo mês porque a gente avisa o cliente que está lá, às
 *    vezes ela demora para buscar."
 *
 * Por isso a tela mostra o acumulado ao lado do mês. Um mês fechado torto não é
 * erro — é a peça que ainda não foi buscada.
 *
 * O PAGAMENTO AO OURIVES É EM BLOCO, não conserto a conserto: "o Ourives vai
 * passar pra ela: o seu mês ficou 3 mil. Aí ela declara e pagou 3 mil."
 */

export interface LancamentoOurives {
  id: string
  data: string
  valor: number
  observacao: string | null
}

export interface BalancoConserto {
  /** Receita de conserto no período — o que as clientes pagaram. */
  receita: number
  /** Quantos consertos foram cobrados no período. */
  quantidade: number
  /** O que foi declarado como pago ao Ourives no período. */
  pagoAoOurives: number
  /** Receita menos gasto. Negativo significa que ela pagou mais do que cobrou. */
  saldo: number
  /** Os mesmos três números desde sempre — ver a nota sobre os meses. */
  acumulado: { receita: number; pagoAoOurives: number; saldo: number }
  lancamentos: LancamentoOurives[]
}

export interface ConsertoCobrado {
  id: string
  data: string
  cliente: string
  vendedora: string
  valor: number
}

export interface ResultadoOurives {
  success: boolean
  error?: string
}

function limites(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split('-').map(Number)
  const ultimo = new Date(ano, m, 0).getDate()
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

/**
 * Soma o que foi cobrado de conserto num intervalo.
 *
 * Reconhece pelo produto ser SERVIÇO — a mesma marca que dispensa o conserto de
 * baixar estoque e que o tira da base de comissão. Uma verdade só sobre o que é
 * serviço, em vez de três definições que podem divergir.
 */
async function receitaDeConserto(
  admin: ReturnType<typeof createAdminClient>,
  loja: string | null,
  de?: string,
  ate?: string,
): Promise<{ total: number; quantidade: number }> {
  let q = admin
    .from('sale_items')
    .select('subtotal, sales!inner(sale_date, store_id, status), products!inner(is_service)')
    .eq('products.is_service', true)
    .neq('sales.status', 'cancelled')

  if (loja) q = q.eq('sales.store_id', loja)
  if (de)   q = q.gte('sales.sale_date', de)
  if (ate)  q = q.lte('sales.sale_date', ate)

  const { data } = await q
  const linhas = (data ?? []) as { subtotal: number | string }[]
  return {
    total: linhas.reduce((s, l) => s + Number(l.subtotal), 0),
    quantidade: linhas.length,
  }
}

/** O que foi declarado como pago ao Ourives num intervalo. */
async function gastoComOurives(
  admin: ReturnType<typeof createAdminClient>,
  loja: string | null,
  de?: string,
  ate?: string,
): Promise<{ total: number; linhas: LancamentoOurives[] }> {
  let q = admin
    .from('transactions')
    .select('id, transaction_date, amount, description')
    .eq('type', 'expense')
    .eq('category', CATEGORIA_OURIVES)

  if (loja) q = q.eq('store_id', loja)
  if (de)   q = q.gte('transaction_date', de)
  if (ate)  q = q.lte('transaction_date', ate)

  const { data } = await q.order('transaction_date', { ascending: false })
  const linhas = (data ?? []) as any[]

  return {
    total: linhas.reduce((s, l) => s + Number(l.amount), 0),
    linhas: linhas.map(l => ({
      id: l.id,
      data: String(l.transaction_date).slice(0, 10),
      valor: Number(l.amount),
      observacao: l.description || null,
    })),
  }
}

export async function buscarBalancoConserto(mes: string): Promise<BalancoConserto | null> {
  const perfil = await getProfile()
  if (!perfil) return null

  const loja = lojaDoEscopo(perfil)
  const admin = createAdminClient()
  const { de, ate } = limites(mes)

  const [noMes, pagoNoMes, sempre, pagoSempre] = await Promise.all([
    receitaDeConserto(admin, loja, de, ate),
    gastoComOurives(admin, loja, de, ate),
    receitaDeConserto(admin, loja),
    gastoComOurives(admin, loja),
  ])

  return {
    receita: noMes.total,
    quantidade: noMes.quantidade,
    pagoAoOurives: pagoNoMes.total,
    saldo: parseFloat((noMes.total - pagoNoMes.total).toFixed(2)),
    acumulado: {
      receita: sempre.total,
      pagoAoOurives: pagoSempre.total,
      saldo: parseFloat((sempre.total - pagoSempre.total).toFixed(2)),
    },
    lancamentos: pagoNoMes.linhas,
  }
}

/**
 * Cada conserto cobrado no mês, para a dona ver de onde vem o número.
 *
 * O saldo sozinho não responde a pergunta que ela faz olhando para ele: "cobrei
 * isso tudo de conserto mesmo?". Com a lista, ela confere atendimento por
 * atendimento — e é assim que uma cobrança esquecida ou digitada errada
 * aparece.
 */
export async function buscarConsertosDoMes(mes: string): Promise<ConsertoCobrado[]> {
  const perfil = await getProfile()
  if (!perfil) return []

  const loja = lojaDoEscopo(perfil)
  const admin = createAdminClient()
  const { de, ate } = limites(mes)

  let q = admin
    .from('sale_items')
    .select('id, subtotal, sales!inner(sale_date, store_id, status, seller_id, customers(name)), products!inner(is_service)')
    .eq('products.is_service', true)
    .neq('sales.status', 'cancelled')
    .gte('sales.sale_date', de)
    .lte('sales.sale_date', ate)

  if (loja) q = q.eq('sales.store_id', loja)

  const { data } = await q
  const linhas = (data ?? []) as any[]
  if (!linhas.length) return []

  // Nome da vendedora numa consulta só — o join aninhado do PostgREST não
  // alcança `users` a partir daqui.
  const ids = [...new Set(linhas.map(l => l.sales?.seller_id).filter(Boolean))] as string[]
  const { data: pessoas } = ids.length
    ? await admin.from('users').select('id, full_name').in('id', ids)
    : { data: [] as { id: string; full_name: string }[] }
  const nome = new Map((pessoas ?? []).map(p => [p.id, p.full_name]))

  return linhas
    .map(l => ({
      id: l.id as string,
      data: String(l.sales?.sale_date ?? '').slice(0, 10),
      cliente: l.sales?.customers?.name ?? 'Sem cliente',
      vendedora: nome.get(l.sales?.seller_id) ?? '—',
      valor: Number(l.subtotal),
    }))
    .sort((a, b) => b.data.localeCompare(a.data))
}

/**
 * Declara o que foi pago ao Ourives.
 *
 * Vira uma `transactions` de despesa comum, com categoria própria. Não precisou
 * de tabela nova: é dinheiro que saiu, e o financeiro já sabe o que fazer com
 * isso — aparece no extrato, entra no resultado, e o balanço aqui só o lê de
 * volta pela categoria.
 */
export async function declararGastoOurives(dados: {
  data: string
  valor: number
  observacao?: string
}): Promise<ResultadoOurives> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }

  const valor = Number(dados.valor)
  if (!Number.isFinite(valor) || valor <= 0) return { success: false, error: 'Informe o valor pago.' }
  if (!dados.data) return { success: false, error: 'Informe a data do pagamento.' }

  const loja = lojaDoEscopo(perfil)
  const admin = createAdminClient()

  const { error } = await admin.from('transactions').insert({
    store_id:         loja,
    type:             'expense',
    amount:           valor,
    category:         CATEGORIA_OURIVES,
    description:      dados.observacao?.trim() || 'Pagamento ao Ourives',
    reference_type:   'manual',
    reference_id:     null,
    user_id:          perfil.id,
    transaction_date: dados.data,
    due_date:         dados.data,
    status:           'completed',
    paid_at:          new Date().toISOString(),
  })

  if (error) return { success: false, error: `Erro ao lançar: ${error.message}` }

  revalidatePath('/financeiro')
  revalidatePath('/')
  return { success: true }
}

/** Remove um pagamento declarado — erro de digitação acontece. */
export async function removerGastoOurives(id: string): Promise<ResultadoOurives> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()

  /*
   * Confere a categoria antes de apagar: este id vem da tela, e sem a
   * checagem a ação viraria um "apague qualquer transação" — inclusive uma
   * compra de fornecedor.
   */
  const { data: alvo } = await admin
    .from('transactions').select('id, category, store_id').eq('id', id).maybeSingle()

  if (!alvo || alvo.category !== CATEGORIA_OURIVES) {
    return { success: false, error: 'Lançamento não encontrado.' }
  }

  const loja = lojaDoEscopo(perfil)
  if (loja && alvo.store_id !== loja) return { success: false, error: 'Este lançamento é de outra loja.' }

  await admin.from('transactions').delete().eq('id', id)

  revalidatePath('/financeiro')
  revalidatePath('/')
  return { success: true }
}
