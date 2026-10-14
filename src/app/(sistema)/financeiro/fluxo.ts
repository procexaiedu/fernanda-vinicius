'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { exigirAdmin, lojaDoEscopo } from '@/lib/auth'

/**
 * Fluxo de caixa: QUANDO o dinheiro cai, não quando a venda aconteceu.
 *
 * Pix e dinheiro entram no dia da venda. Cartão entra parcela a parcela, já
 * descontada a taxa da maquininha (fv.card_receivables, gerado por gatilho no
 * banco ao gravar o pagamento; ver a migration 20261015). Despesas saem no
 * vencimento.
 *
 * A gestora concilia toda semana: marca o que caiu, ou informa o valor que
 * caiu de fato — se não bate com o previsto, vira "divergente".
 *
 * Escopo de loja sempre aqui (lojaDoEscopo), nunca vindo da tela.
 */

export interface DiaFluxo {
  dia: string
  pixDinheiro: number
  cartaoBruto: number
  cartaoTaxa: number
  cartaoLiquido: number
  outrasEntradas: number
  saidas: number
}

export interface Recebimento {
  id: string
  venda: string
  dataVenda: string
  cliente: string | null
  tipo: 'debit' | 'credit'
  bandeira: string | null
  parcela: number
  parcelas: number
  bruto: number
  taxaPct: number | null
  taxa: number
  liquido: number
  dataPrevista: string
  status: 'previsto' | 'recebido' | 'divergente'
  valorRecebido: number | null
  recebidoEm: string | null
}

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string }

const DATA = /^\d{4}-\d{2}-\d{2}$/

function hojeSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export async function buscarFluxo(de: string, ate: string): Promise<Resultado<DiaFluxo[]>> {
  const perfil = await exigirAdmin()
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) return { ok: false, erro: 'Período inválido.' }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('fluxo_caixa', { p_loja: lojaDoEscopo(perfil), p_de: de, p_ate: ate })
  if (error || !data) return { ok: false, erro: 'Não consegui ler o fluxo de caixa. Tente de novo.' }

  return {
    ok: true,
    dados: (data as any[]).map(d => ({
      dia: String(d.dia).slice(0, 10),
      pixDinheiro: Number(d.pix_dinheiro),
      cartaoBruto: Number(d.cartao_bruto),
      cartaoTaxa: Number(d.cartao_taxa),
      cartaoLiquido: Number(d.cartao_liquido),
      outrasEntradas: Number(d.outras_entradas),
      saidas: Number(d.saidas),
    })),
  }
}

export async function buscarRecebimentos(de: string, ate: string): Promise<Resultado<Recebimento[]>> {
  const perfil = await exigirAdmin()
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) return { ok: false, erro: 'Período inválido.' }

  const admin = createAdminClient()
  let q = admin
    .from('card_receivables')
    .select(`id, sale_id, card_type, brand, installment_number, installments_total, gross_amount,
             fee_pct, fee_amount, net_amount, expected_date, status, received_amount, received_at,
             sales!inner(sale_date, status, customers(full_name))`)
    .gte('expected_date', de)
    .lte('expected_date', ate)
    .neq('sales.status', 'cancelled')
  const loja = lojaDoEscopo(perfil)
  if (loja) q = q.eq('store_id', loja)

  const { data, error } = await q.order('expected_date').order('created_at')
  if (error || !data) return { ok: false, erro: 'Não consegui ler os recebimentos. Tente de novo.' }

  return {
    ok: true,
    dados: (data as any[]).map(r => ({
      id: r.id,
      venda: r.sale_id,
      dataVenda: new Date(r.sales.sale_date).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
      cliente: r.sales.customers?.full_name ?? null,
      tipo: r.card_type,
      bandeira: r.brand,
      parcela: r.installment_number,
      parcelas: r.installments_total,
      bruto: Number(r.gross_amount),
      taxaPct: r.fee_pct === null ? null : Number(r.fee_pct),
      taxa: Number(r.fee_amount),
      liquido: Number(r.net_amount),
      dataPrevista: r.expected_date,
      status: r.status,
      valorRecebido: r.received_amount === null ? null : Number(r.received_amount),
      recebidoEm: r.received_at,
    })),
  }
}

/**
 * Conciliar.
 *   - `valor` ausente: "caiu certinho" — recebido pelo líquido previsto (em lote).
 *   - `valor` informado: recebido se bate com o previsto, divergente se não.
 *   - `desfazer`: volta para previsto.
 * O update filtra pela loja do escopo: um id da outra loja simplesmente não casa.
 */
export async function conciliarRecebimentos(input: {
  ids: string[]
  valor?: number
  data?: string
  desfazer?: boolean
}): Promise<{ ok: boolean; erro?: string; alterados?: number }> {
  const perfil = await exigirAdmin()
  const ids = [...new Set(input.ids)].filter(i => /^[0-9a-f-]{36}$/i.test(i))
  if (ids.length === 0 || ids.length > 200) return { ok: false, erro: 'Selecione de 1 a 200 recebimentos.' }
  const data = input.data ?? hojeSP()
  if (!DATA.test(data)) return { ok: false, erro: 'Data inválida.' }
  if (input.valor !== undefined && (ids.length !== 1 || !Number.isFinite(input.valor) || input.valor < 0)) {
    return { ok: false, erro: 'Valor inválido.' }
  }

  const admin = createAdminClient()
  const loja = lojaDoEscopo(perfil)
  const agora = new Date().toISOString()

  if (input.desfazer) {
    let q = admin.from('card_receivables')
      .update({ status: 'previsto', received_amount: null, received_at: null, conciliated_by: null, conciliated_at: null })
      .in('id', ids)
    if (loja) q = q.eq('store_id', loja)
    const { data: d, error } = await q.select('id')
    if (error) return { ok: false, erro: 'Não consegui desfazer. Tente de novo.' }
    return { ok: true, alterados: d?.length ?? 0 }
  }

  if (input.valor === undefined) {
    const { data: n, error } = await admin.rpc('conciliar_recebimentos', {
      p_ids: ids, p_loja: loja, p_data: data, p_user: perfil.id,
    })
    if (error) return { ok: false, erro: 'Não consegui marcar como recebido. Tente de novo.' }
    return { ok: true, alterados: Number(n) }
  }

  let alvo = admin.from('card_receivables').select('id, net_amount').eq('id', ids[0])
  if (loja) alvo = alvo.eq('store_id', loja)
  const { data: linha, error: errLer } = await alvo.maybeSingle()
  if (errLer) return { ok: false, erro: 'Não consegui ler o recebimento. Tente de novo.' }
  if (!linha) return { ok: false, erro: 'Recebimento não encontrado.' }

  const previsto = Number(linha.net_amount)
  const recebido = Math.round(input.valor * 100) / 100
  const status = Math.abs(recebido - previsto) < 0.005 ? 'recebido' : 'divergente'
  const { error } = await admin.from('card_receivables')
    .update({ status, received_amount: recebido, received_at: data, conciliated_by: perfil.id, conciliated_at: agora })
    .eq('id', linha.id)
  if (error) return { ok: false, erro: 'Não consegui salvar. Tente de novo.' }
  return { ok: true, alterados: 1 }
}
