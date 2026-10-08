'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getProfile, lojaDoEscopo } from '@/lib/auth'
import { generateCode } from '@/lib/productCode'
import { validatePaymentGroups } from '@/lib/compras/validate-payments'
import { formatarNomeProprio } from '@/lib/nomeProprio'
import { normalizarNomeFornecedor } from '@/lib/nomeFornecedor'
import { mensagemConsignacaoMisturada } from '@/lib/compras/consignacao'
import { remessaEstaPendente, itemQueMexeNaRemessa, mensagemRemessaPendente } from '@/lib/compras/remessaPendente'
import {
  idDeRequisicaoValido, violouUnico,
} from '@/lib/idempotencia'

/** Chave de comparação de fornecedor — a mesma no servidor e na tela. */
const chaveFornecedor = normalizarNomeFornecedor

export interface ActionResult {
  success: boolean
  error?: string
  purchaseId?: string
  /**
   * O `clientRequestId` enviado já pertence a OUTRA compra — ver
   * `respostaDaCompraJaGravada`. Nada foi gravado; a tela troca o id.
   */
  idReusado?: boolean
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface GridRow {
  productId: string | null              // null = produto novo
  productName: string
  productExistingCostDiffers: boolean   // true = duplicar produto existente
  supplierId: string | null             // null = fornecedor novo
  supplierName: string
  supplierInitials: string
  category: string
  material: string
  costPrice: number
  salePrice: number
  promoPrice: number | null
  labelFormat: 'A' | 'B'
  quantity: number
  storeId: string
}

export interface PaymentRow {
  method: 'cash' | 'pix' | 'transfer' | 'credit' | 'check'
  totalAmount: number
  installments: number        // 1 para cash/pix/transfer/check
  firstDueDate: string        // YYYY-MM-DD (cheque: data combinada "bom para")
  /**
   * `''` = ainda não declarado. A linha de pagamento nasce assim de propósito:
   * antes, nascia como 'completed' e uma linha nunca preenchida entrava no banco
   * como pagamento de R$ 0,00 já quitado — foi assim que R$ 34 mil de compra
   * ficaram fora do ledger financeiro. Salvar exige declaração explícita.
   */
  status: 'completed' | 'pending' | ''
}

export interface SupplierPaymentGroup {
  groupKey: string
  payments: PaymentRow[]
  nfNumber?: string
  nfUrl?: string
  /**
   * Desconto comercial que o fornecedor deu, em % sobre o subtotal dele.
   *
   * Pedido da dona em 03/09: "tem compras que ela ganha cinco, dez por cento".
   * Reduz o que ela PAGA — é contra o líquido que os pagamentos têm de fechar.
   *
   * NÃO altera o custo gravado de cada peça, e isso é decisão consciente: o
   * custo unitário é o que ela digitou da nota do fornecedor, e é dele que
   * saem etiqueta, margem e CMV. Ratear o desconto nos custos mudaria o preço
   * de venda de peças já etiquetadas. Se um dia for para refletir no custo,
   * é mudança de regra de negócio e precisa ser decidida, não deduzida.
   */
  descontoPct?: number
}

export interface CompraFormData {
  purchaseDate: string        // YYYY-MM-DD
  notes: string
  rows: GridRow[]
  supplierPayments: SupplierPaymentGroup[]
  isConsignment: boolean
  returnDeadline: string      // só se consignação
  minPurchasePct: number | null
  /**
   * Id desta compra NOVA, gerado pela tela e guardado no rascunho — ver
   * `procurarCompraPorPedido`. Impede o reenvio (resposta perdida, rascunho
   * recuperado, duplo clique) de lançar a compra duas vezes.
   */
  clientRequestId?: string | null
  /**
   * Loja de onde as peças SAEM fisicamente (05/10/2026). Linhas de OUTRA loja
   * não entram direto: viram remessa em trânsito ("lote do fornecedor") e só
   * entram no estoque quando a loja de destino conferir. Vazio = as peças já
   * estão na loja de destino (como antes).
   */
  remessaDe?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Subtotal menos o desconto do fornecedor. Percentual fora de 0–100 é ignorado. */
function aplicarDesconto(subtotal: number | undefined, pct: number | undefined): number | undefined {
  if (subtotal === undefined) return undefined
  const p = Number(pct) || 0
  if (p <= 0 || p > 100) return subtotal
  return parseFloat((subtotal * (1 - p / 100)).toFixed(2))
}

async function verifyAdmin(): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()

  if (profile?.role !== 'admin') return { userId: null, error: 'Acesso negado.' }
  return { userId: user.id, error: null }
}

/*
 * Loja da sessão e lojas que têm peça nesta compra (08/10/2026).
 *
 * A compra pertence à loja pelas PEÇAS (`fv.compra_rateio_loja`), não pelo
 * cabeçalho: `purchases.store_id` é nulo, porque a ida a São Paulo abastece as
 * duas. Sem isto, a admin de Brasília abria pelo id qualquer compra, com custo,
 * itens e pagamentos de Campinas.
 */
async function escopoDaCompra(
  admin: ReturnType<typeof createAdminClient>,
  purchaseId: string,
): Promise<{ loja: string | null; lojas: string[]; podeAlterarMista: boolean } | { erro: string }> {
  const perfil = await getProfile()
  if (!perfil) return { erro: 'Não autenticado.' }
  /* A compra com linhas para a outra loja existe DE PROPÓSITO (remessa do
   * fornecedor, 05/10): quem a lança é a admin global, e só ela a altera
   * inteira. Quem tem loja fixa não mexe em compra que tem peça da outra. */
  const podeAlterarMista = perfil.store_id === null
  const loja = lojaDoEscopo(perfil)
  if (!loja) return { loja: null, lojas: [], podeAlterarMista }
  const { data, error } = await admin.from('compra_rateio_loja').select('store_id').eq('purchase_id', purchaseId)
  if (error || !data) return { erro: `Não foi possível conferir a loja da compra: ${error?.message ?? 'sem resposta'}` }
  const lojas = [...new Set(data.map(r => r.store_id as string))]
  if (!lojas.includes(loja)) return { erro: 'Compra não encontrada.' }
  return { loja, lojas, podeAlterarMista }
}

// ─── Transação no banco (RPC) ────────────────────────────────────────────────
//
// Desde 01/10 a compra, a edição e a exclusão são gravadas por funções do
// banco (`fv.salvar_compra`, `fv.editar_compra`, `fv.excluir_compra` — ver
// supabase/migrations/20261001_compra_transacional.sql), numa transação só.
// Padrão "TS calcula, SQL persiste": toda regra continua aqui; a função só
// grava, e qualquer erro desfaz tudo.

/** Mensagem da compra cujo `clientRequestId` já pertence a OUTRA compra. */
const MSG_ID_DE_OUTRA_COMPRA =
  'Este salvamento já foi usado para outra compra. Recarregue a página (F5) e lance de novo — nada desta compra foi gravado.'

/**
 * O texto de uma falha do `rpc()`.
 *
 * Com `code` (erro do Postgres ou do PostgREST) a transação foi desfeita:
 * NADA foi gravado, e dá para dizer isso. Sem `code` a falha foi de rede — a
 * função pode ter terminado e a resposta se perdido, então não se afirma nada.
 */
function falhaDoBanco(
  err: { code?: string; message?: string },
  oQue: string,
  semCodigo: string,
): string {
  if (err.code) return `Não foi possível ${oQue}: ${err.message ?? 'erro do banco'}. Nada foi gravado — confira e tente de novo.`
  return semCodigo
}

type RespostaSalvarCompra =
  | { erro: 'id_reusado'; purchase_id: string }
  | { purchase_id: string; ja_existia: true; itens: number; incompleta: boolean }
  | { purchase_id: string; ja_existia: false; consignment_id: string | null; product_ids: string[] }
// ─── Action: salvar compra ────────────────────────────────────────────────────

export async function salvarCompra(data: CompraFormData): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  if (!data.rows.length) return { success: false, error: 'Adicione ao menos um item.' }

  /*
   * REENVIO DE UMA COMPRA QUE JÁ ENTROU é reconhecido DENTRO de
   * `fv.salvar_compra`, pelo `client_request_id`, antes de gravar qualquer
   * coisa — e, como a gravação agora é uma transação só, não existe mais a
   * compra "pela metade" (peças criadas sem compra) que o reenvio duplicava.
   */
  const admin = createAdminClient()
  const idReq = idDeRequisicaoValido(data.clientRequestId)

  /*
   * CONSIGNAÇÃO É POR FORNECEDOR E POR LOJA.
   *
   * O lote (`fv.consignments`) tem UM `supplier_id` e UMA `store_id`. Antes, uma
   * consignação com peças de dois fornecedores (ou para as duas lojas) virava
   * um lote só, no nome do fornecedor da primeira linha — e o acerto, a
   * devolução e o saldo devido passavam a misturar dinheiro de fornecedoras
   * diferentes. A tela também barra; aqui é a trava que não depende dela.
   *
   * Compara pelo NOME normalizado, não pelo id: uma linha ligada ao cadastro e
   * outra digitada com o mesmo nome são o mesmo fornecedor.
   */
  if (data.isConsignment) {
    const fornecedores = new Set(data.rows.map(r => chaveFornecedor(r.supplierName)))
    const lojas        = new Set(data.rows.map(r => r.storeId))
    if (fornecedores.size > 1 || lojas.size > 1) {
      /* A mensagem diz QUAIS se misturaram: numa grade de 47 linhas, "separe"
       * sozinho a deixava caçando a linha diferente. Sem o nome da loja
       * (consulta falhou), sai o texto sem a loja — a trava vale igual. */
      const { data: lojasDb } = await admin.from('stores').select('id, name').in('id', [...lojas])
      const nomeDaLoja = new Map(((lojasDb ?? []) as Array<{ id: string; name: string }>).map(l => [l.id, l.name]))
      return { success: false, error: mensagemConsignacaoMisturada(data.rows, id => nomeDaLoja.get(id)) }
    }
  }

  // ── 0. Pagamentos: valor e situação obrigatórios ───────────────────────────
  // Trava de servidor, além da do formulário. Sem ela, uma linha de pagamento
  // vazia entra como R$ 0,00 e a despesa da compra não chega ao ledger.
  // Subtotal por fornecedor, recalculado a partir dos itens — mesma chave de
  // agrupamento do formulário. Recalcular no servidor é de propósito: um
  // subtotal vindo do cliente poderia ser manipulado ou chegar dessincronizado.
  const subtotalPorGrupo = new Map<string, number>()
  const nomePorGrupo     = new Map<string, string>()
  for (const row of data.rows) {
    if (!row.supplierName?.trim() || !row.costPrice) continue
    const key = row.supplierId ?? row.supplierName.trim().toLowerCase()
    subtotalPorGrupo.set(key, (subtotalPorGrupo.get(key) ?? 0) + row.costPrice * (row.quantity || 1))
    if (!nomePorGrupo.has(key)) nomePorGrupo.set(key, row.supplierName.trim())
  }

  /*
   * CONSIGNAÇÃO NÃO TEM PAGAMENTO, e por isso não passa por aqui.
   *
   * Na consignação o fornecedor DEIXA as peças; a loja só paga o que vender.
   * Não existe valor a informar no recebimento, e exigir um trava a tela: a
   * dona relatou em 07/09 que ao fechar uma consignação o sistema pedia "informe
   * o valor do pagamento" e não salvava. O banco confirma — `fv.consignments`
   * está VAZIA, ou seja, nunca foi possível salvar uma.
   *
   * O formulário já sabia disso (esconde a área de pagamento e pula a própria
   * checagem), mas a trava do servidor não olhava `isConsignment` e reprovava
   * o que a tela nem tinha perguntado.
   */
  /*
   * A validação percorre os FORNECEDORES COM PEÇA, não os grupos que a tela
   * mandou.
   *
   * Antes percorria `data.supplierPayments`. Dois furos: um fornecedor com
   * peças mas sem grupo no payload passava sem pagamento nenhum (despesa fora
   * do ledger de novo), e um grupo sem peça correspondente aparecia na
   * mensagem de erro pelo `groupKey` — um UUID na cara da dona.
   */
  const grupoPorChave = new Map(data.supplierPayments.map(g => [g.groupKey, g]))

  if (!data.isConsignment) {
    const payErr = validatePaymentGroups(
      [...subtotalPorGrupo.entries()].map(([key, subtotal]) => {
        const g = grupoPorChave.get(key)
        return {
          label: nomePorGrupo.get(key) ?? 'fornecedor',
          // O que tem de fechar é o LÍQUIDO. O subtotal continua recalculado aqui
          // (nunca vem do cliente); só o percentual de desconto é declarado.
          subtotal: aplicarDesconto(subtotal, g?.descontoPct),
          payments: (g?.payments ?? []).map(p => ({ amount: p.totalAmount, status: p.status })),
        }
      })
    )
    if (payErr) return { success: false, error: payErr }

    // Pagamento com valor para quem não tem peça na compra viraria despesa sem
    // mercadoria por trás. Não é para acontecer (a tela só manda grupos com
    // peça); se acontecer, é melhor parar do que lançar.
    const orfao = data.supplierPayments.find(
      g => !subtotalPorGrupo.has(g.groupKey) && g.payments.some(p => Number(p.totalAmount) > 0)
    )
    if (orfao) {
      return {
        success: false,
        error: 'Há um pagamento lançado para um fornecedor que não tem peça com custo nesta compra. Confira o fornecedor de cada linha e salve de novo.',
      }
    }
  }

  const purchaseMonth = parseInt(data.purchaseDate.slice(5, 7))
  const purchaseYear  = parseInt(data.purchaseDate.slice(0, 4))

  // ── 1. Resolver fornecedores (só leitura; quem cria é a função do banco) ──
  //
  // Cada linha ganha uma REFERÊNCIA de fornecedor: o id do cadastro, ou
  // `novo:N` — o N-ésimo fornecedor novo, que `fv.salvar_compra` cria na
  // mesma transação da compra (antes era um INSERT solto, que ficava para
  // trás se algo falhasse depois).
  const supplierCache = new Map<string, string>() // key → referência final
  const fornecedoresNovos: Array<{ name: string; initials: string }> = []
  const NOVO = 'novo:'
  const ehNovo = (ref: string) => ref.startsWith(NOVO)

  /*
   * FORNECEDOR "NOVO" QUE JÁ EXISTE É REUSADO, NÃO DUPLICADO.
   *
   * A linha chega sem `supplierId` quando o vínculo com o cadastro se perdeu na
   * digitação (apagar uma letra e redigitar desvinculava) ou quando o nome foi
   * digitado com outra grafia ("SANTA PRATA", "Santa-Prata"). Antes, isso
   * criava um segundo "Santa Prata" a cada compra, com iniciais sugeridas —
   * e as peças saíam com código de fornecedor errado.
   *
   * Agora procura no cadastro ativo pelo nome normalizado. As iniciais que
   * valem são as DO CADASTRO: é delas que sai o código das peças que já estão
   * na loja.
   */
  const existentesPorChave = new Map<string, { id: string; initials: string | null }>()
  const iniciaisDoCadastro = new Map<string, string>() // referência → initials

  if (data.rows.some(r => !r.supplierId)) {
    const { data: cadastrados, error: cadErr } = await admin
      .from('suppliers').select('id, name, initials').eq('is_active', true).order('name')
    if (cadErr) return { success: false, error: `Erro ao conferir os fornecedores cadastrados: ${cadErr.message}` }

    for (const s of (cadastrados ?? []) as Array<{ id: string; name: string; initials: string | null }>) {
      const chave = chaveFornecedor(s.name)
      // Dois cadastros com o mesmo nome já são duplicata antiga; fica com o
      // primeiro em vez de criar um terceiro.
      if (chave && !existentesPorChave.has(chave)) existentesPorChave.set(chave, { id: s.id, initials: s.initials })
    }
  }

  for (const row of data.rows) {
    if (row.supplierId) {
      supplierCache.set(row.supplierId, row.supplierId)
      continue
    }
    const key = row.supplierName.trim().toLowerCase()
    if (supplierCache.has(key)) continue

    const existente = existentesPorChave.get(chaveFornecedor(row.supplierName))
    if (existente) {
      supplierCache.set(key, existente.id)
      if (existente.initials?.trim()) iniciaisDoCadastro.set(existente.id, existente.initials.trim().toUpperCase())
      continue
    }

    const initials = row.supplierInitials.trim().toUpperCase()
    const ref = `${NOVO}${fornecedoresNovos.length}`
    fornecedoresNovos.push({ name: formatarNomeProprio(row.supplierName), initials })
    supplierCache.set(key, ref)
    // Outra grafia do MESMO fornecedor novo, mais abaixo na grade, cai aqui.
    existentesPorChave.set(chaveFornecedor(row.supplierName), { id: ref, initials })
  }

  function resolveSupplier(row: GridRow): string {
    if (row.supplierId) return row.supplierId
    return supplierCache.get(row.supplierName.trim().toLowerCase())!
  }

  /** A referência no formato do payload: id do cadastro OU índice do novo. */
  function refParaPayload(ref: string | null): { supplier_id: string | null; supplier_novo: number | null } {
    if (!ref) return { supplier_id: null, supplier_novo: null }
    return ehNovo(ref)
      ? { supplier_id: null, supplier_novo: Number(ref.slice(NOVO.length)) }
      : { supplier_id: ref, supplier_novo: null }
  }

  // Mapeia o groupKey de um SupplierPaymentGroup para a referência do fornecedor.
  // O groupKey vem do front como `row.supplierId ?? supplierName.toLowerCase()`.
  function resolveGroupSupplier(groupKey: string): string | null {
    const row = data.rows.find(
      r => (r.supplierId ?? r.supplierName.trim().toLowerCase()) === groupKey
    )
    return row ? resolveSupplier(row) : null
  }

  // ── 2. Resolver iniciais para geração do código ───────────────────────────
  const initialsCache = new Map<string, string>() // referência → initials

  for (const row of data.rows) {
    const supId = resolveSupplier(row)
    if (initialsCache.has(supId)) continue
    const doCadastro = iniciaisDoCadastro.get(supId)
    if (doCadastro) {
      initialsCache.set(supId, doCadastro)
    } else if (row.supplierInitials.trim()) {
      initialsCache.set(supId, row.supplierInitials.trim().toUpperCase())
    } else if (ehNovo(supId)) {
      // Fornecedor novo sem iniciais: é o que o cadastro dele vai guardar
      // (vazio) — mesmo resultado da releitura de antes, que caía em "FV".
      initialsCache.set(supId, fornecedoresNovos[Number(supId.slice(NOVO.length))]?.initials || 'FV')
    } else {
      // Leitura que falha não pode virar "FV": o código da peça sairia com o
      // prefixo errado e a etiqueta já impressa não tem volta.
      const { data: sup, error: supErr } = await admin.from('suppliers').select('initials').eq('id', supId).maybeSingle()
      if (supErr) return { success: false, error: `Erro ao ler as iniciais do fornecedor: ${supErr.message}` }
      initialsCache.set(supId, sup?.initials?.toUpperCase() || 'FV')
    }
  }

  /* ── 3. Linhas: peça nova (criar/duplicar) ou reusada (somar estoque) ─────
   *
   * UMA linha do payload por linha da grade, NA ORDEM: `purchase_items` liga
   * a linha i à peça i, e o `barcode_number` sai da sequência do banco na
   * ordem das linhas (a mesma do INSERT em lote de antes).
   *
   * Peça reusada vai com `product_id` e a função soma o estoque de forma
   * atômica (`quantity_in_stock = quantity_in_stock + x`). A mesma peça em
   * duas linhas soma as duas — o problema do "saldo lido uma vez" (revisão de
   * 16/09) deixa de existir.
   */
  const linhas = data.rows.map(row => {
    const reusa = !!row.productId && !row.productExistingCostDiffers
    const ref = resolveSupplier(row)
    return {
      product_id:        reusa ? row.productId : null,
      ...refParaPayload(ref),
      code:              generateCode(initialsCache.get(ref) ?? 'FV', purchaseMonth, row.costPrice),
      name:              row.productName.trim(),
      category:          row.category.trim().toLowerCase(),
      material:          row.material.trim().toLowerCase(),
      store_id:          row.storeId,
      cost_price:        row.costPrice,
      sale_price:        row.salePrice,
      promotional_price: row.promoPrice ?? null,
      quantity:          row.quantity,
      label_format:      row.labelFormat,
      purchase_month:    purchaseMonth,
      purchase_year:     purchaseYear,
    }
  })

  // ── 4. Totais e lote consignado ───────────────────────────────────────────
  const totalCost  = data.rows.reduce((s, r) => s + r.costPrice * r.quantity, 0)
  const totalItems = data.rows.reduce((s, r) => s + r.quantity, 0)

  /*
   * Consignação cria o lote E a compra (com `consignment_id`), na mesma
   * transação.
   *
   * Consignação era um beco sem saída: criava o lote, marcava as peças e
   * voltava. Como detalhe, edição, exclusão e IMPRESSÃO DE ETIQUETA são todos
   * pendurados em `purchases`, a consignação não tinha nenhum dos quatro. Em
   * 07/09 a dona carregou 65 peças de Brasília e não conseguiu imprimir uma
   * etiqueta sequer. "esse consignado é exatamente igual a compra, mas é uma
   * compra que ela ainda não pagou". O que NÃO acontece é pagamento: essas
   * peças só viram despesa no acerto.
   */
  const consignacao = data.isConsignment
    ? {
        ...refParaPayload(resolveSupplier(data.rows[0])),
        store_id:         data.rows[0]?.storeId ?? null,
        return_deadline:  data.returnDeadline || null,
        min_purchase_pct: data.minPurchasePct ?? null,
        total_pieces:     totalItems,
        total_cost_value: totalCost,
      }
    : null

  // ── 5. Cabeçalho da compra ────────────────────────────────────────────────
  // Concatenar NFs de todos os fornecedores (ex: "CT:001042 | BL:002033")
  const allNfNumbers = data.supplierPayments
    .filter(g => g.nfNumber?.trim())
    .map(g => g.nfNumber!.trim())
    .join(' | ') || null
  const firstNfUrl = data.supplierPayments.find(g => g.nfUrl?.trim())?.nfUrl?.trim() || null

  /*
   * O desconto do fornecedor vira LINHA NA OBSERVAÇÃO da compra.
   *
   * Sem isso a compra fica inexplicável: `total_cost` guarda o BRUTO — a soma
   * dos custos das peças, que é o que alimenta etiqueta, margem e CMV — e os
   * pagamentos somam o LIQUIDO. Quem abrir esta compra em dezembro veria
   * R$640 de custo e R$576 pagos, sem saber se faltou pagar ou se houve
   * desconto.
   *
   * Vai em `notes`, e não numa coluna nova, porque é informação para LER: o
   * número que o financeiro usa já está nas transações. Coluna nova pediria
   * migração para guardar um texto.
   */
  const linhasDesconto = data.supplierPayments
    .filter(g => subtotalPorGrupo.has(g.groupKey) && (Number(g.descontoPct) || 0) > 0)
    .map(g => {
      const nome    = nomePorGrupo.get(g.groupKey) ?? 'fornecedor'
      const bruto   = subtotalPorGrupo.get(g.groupKey) ?? 0
      const liquido = aplicarDesconto(bruto, g.descontoPct) ?? bruto
      return `DESCONTO ${nome.toUpperCase()}: ${g.descontoPct}% (R$ ${bruto.toFixed(2)} -> R$ ${liquido.toFixed(2)})`
    })

  const notasComDesconto =
    [data.notes?.trim(), ...linhasDesconto].filter(Boolean).join('\n') || null

  // ── 6. Parcelas + despesas ────────────────────────────────────────────────
  //
  // CADA PARCELA É UMA LINHA. Antes, uma compra em 3x gravava UMA linha com a
  // contagem em `installment_number` e UMA transação com o valor cheio numa
  // data só — ou seja, o financeiro via uma despesa de R$3.000 hoje em vez de
  // três de R$1.000 nos três meses. Para cheque isso é ainda mais errado:
  // cheque parcelado é literalmente três papéis com três datas.
  /*
   * De novo: consignação não gera pagamento NEM despesa.
   *
   * Sem esta guarda, uma linha de pagamento que sobrou na tela — trocar de
   * "Compra Própria" para "Consignação" depois de preencher, ou um rascunho
   * recuperado — viraria conta a pagar e despesa no financeiro de peças que
   * ainda são do fornecedor. O custo entra quando a peça vende, não quando
   * chega.
   */
  // Só grupos com peça: a validação lá em cima foi feita sobre eles.
  const gruposDePagamento = data.isConsignment
    ? []
    : data.supplierPayments.filter(g => subtotalPorGrupo.has(g.groupKey))

  const pagamentos: Array<Record<string, unknown>> = []
  for (const group of gruposDePagamento) {
    const nfNum    = group.nfNumber?.trim() || null
    const supplier = refParaPayload(resolveGroupSupplier(group.groupKey))

    for (const payment of group.payments) {
      const parcelas = PARCELAVEL.has(payment.method) ? Math.max(1, payment.installments) : 1

      // A situação declarada é respeitada. Antes, `(isCredit || !isPending)`
      // forçava 'completed': crédito sempre virava pago, e qualquer status não
      // 'pending' também — o que tornava a declaração da usuária irrelevante.
      // (`paid_at` = agora, para os pagos, é posto pela função do banco.)
      const status = payment.status === 'pending' ? 'pending' : 'completed'
      const valores = dividirEmParcelas(payment.totalAmount, parcelas)

      for (let i = 0; i < parcelas; i++) {
        pagamentos.push({
          ...supplier,
          payment_method:     payment.method,
          amount:             valores[i],
          // ORDINAL (1, 2, 3…), não a contagem. Antes guardava o TOTAL de
          // parcelas aqui, o que tornava a coluna inútil para saber "qual
          // parcela é esta". Conferido em 03/09: 282 pagamentos no banco, o
          // campo sempre nulo — nunca foi usado, então dá para acertar sem
          // migrar nada.
          installment_number: parcelas > 1 ? i + 1 : null,
          due_date:           vencimentoDaParcela(payment.firstDueDate, i),
          status,
          description:        descricaoDaDespesa(payment.method, i + 1, parcelas, nfNum),
        })
      }
    }
  }

  // ── 7. Grava tudo numa transação ──────────────────────────────────────────
  const payload = {
    client_request_id:  idReq,
    user_id:            userId,
    purchase_date:      data.purchaseDate,
    is_consignment:     data.isConsignment,
    fornecedores_novos: fornecedoresNovos,
    linhas,
    consignacao,
    compra: {
      total_cost:  totalCost,
      total_items: totalItems,
      nf_number:   allNfNumbers,
      nf_url:      firstNfUrl,
      notes:       notasComDesconto,
    },
    pagamentos,
  }

  /*
   * Com remessa: `salvar_compra_com_remessa` grava a compra e abre a remessa na
   * MESMA transação (migration 20261005_transferencia_duas_pontas). Só se
   * alguma linha é de outra loja; senão, o caminho de sempre.
   */
  const remessaDe = data.remessaDe && data.rows.some(r => r.storeId !== data.remessaDe) ? data.remessaDe : null
  const gravar = () => remessaDe
    ? admin.rpc('salvar_compra_com_remessa', { p: payload, p_remessa_de: remessaDe })
    : admin.rpc('salvar_compra', { p: payload })

  let { data: resp, error: rpcErr } = await gravar()

  /* Índice único do `client_request_id` disparou: outro envio desta MESMA
   * compra passou na frente. A função trava pelo id (advisory lock), então é
   * raro — e a transação deste envio já foi desfeita. Chamar de novo cai no
   * reconhecimento do reenvio e devolve a compra que entrou. */
  if (rpcErr && idReq && violouUnico(rpcErr)) {
    ;({ data: resp, error: rpcErr } = await gravar())
  }

  if (rpcErr || !resp) {
    console.error('[salvarCompra] fv.salvar_compra falhou', rpcErr)
    return {
      success: false,
      error: falhaDoBanco(
        rpcErr ?? {},
        'salvar a compra',
        idReq
          ? 'Não foi possível confirmar se a compra foi gravada (falha de conexão). Salve de novo: se ela já tiver entrado, o sistema reconhece e não duplica.'
          : 'Não foi possível confirmar se a compra foi gravada (falha de conexão). Confira em Compras antes de salvar de novo.',
      ),
    }
  }

  const r = resp as RespostaSalvarCompra

  if ('erro' in r) {
    /*
     * O id já pertence a OUTRA compra (custo total, nº de peças ou nº de
     * linhas diferentes). Nada foi gravado; `idReusado` faz a tela trocar o id.
     */
    console.error('[salvarCompra] clientRequestId de OUTRA compra — nada gravado', {
      purchaseId: r.purchase_id, enviada: { custo: totalCost, pecas: totalItems, linhas: data.rows.length },
    })
    return { success: false, idReusado: true, error: MSG_ID_DE_OUTRA_COMPRA }
  }

  if (r.ja_existia) {
    /* Só compra gravada ANTES da transação (código antigo) pode estar pela
     * metade. Devolver "sucesso" aí esconderia isso atrás das etiquetas. */
    if (r.incompleta) {
      console.error('[salvarCompra] reenvio de compra gravada pela metade', {
        purchaseId: r.purchase_id, itens: r.itens, esperado: data.rows.length,
      })
      return {
        success: false,
        error: 'Esta compra JÁ TINHA SIDO gravada (o primeiro envio chegou), mas pode ter ficado incompleta. '
          + 'NÃO salve de novo — isso duplicaria as peças. Confira em Compras.',
      }
    }
    console.info('[salvarCompra] reenvio reconhecido — devolvendo a compra já gravada', { purchaseId: r.purchase_id })
  }

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true, purchaseId: r.purchase_id }
}


// ─── Parcelamento ─────────────────────────────────────────────────────────────

/**
 * Métodos que aceitam parcela. Precisa bater com o `PARCELAVEL` da tela.
 *
 * Cheque entrou em 03/09: a dona compra em São Paulo e paga em cheques
 * pré-datados, um por mês. Pix, dinheiro, transferência e débito saem de uma
 * vez por natureza.
 */
const PARCELAVEL = new Set(['credit', 'check'])

const METODO_ROTULO: Record<string, string> = {
  credit: 'Crédito', check: 'Cheque', pix: 'PIX',
  cash: 'Dinheiro', transfer: 'Transferência', debit: 'Débito',
}

/**
 * Texto da despesa no financeiro — o MESMO na criação e na edição.
 *
 * A edição regravava tudo como "Compra", e a dona perdia no financeiro o que
 * distinguia uma linha da outra: "Cheque 2/3 NF 1042" virava só "Compra",
 * três vezes.
 */
function descricaoDaDespesa(metodo: string, parcela: number, parcelas: number, nfNum: string | null): string {
  const rotulo = METODO_ROTULO[metodo] ?? 'Compra'
  return parcelas > 1
    ? `Compra — ${rotulo} ${parcela}/${parcelas}${nfNum ? ` NF ${nfNum}` : ''}`
    : `Compra${metodo === 'check' ? ' — Cheque' : ''}${nfNum ? ` NF ${nfNum}` : ''}`
}

/**
 * Divide um total em N parcelas que somam EXATAMENTE o total.
 *
 * R$100 em 3x não dá 33,33 três vezes — dá 99,99, e some um centavo do que ela
 * deve ao fornecedor. A última parcela absorve o resto.
 *
 * É a mesma regra do rateio de desconto da NFC-e: o erro de arredondamento tem
 * de morar em algum lugar, e concentrá-lo numa parcela é melhor que espalhá-lo.
 */
function dividirEmParcelas(total: number, parcelas: number): number[] {
  if (parcelas <= 1) return [parseFloat((total || 0).toFixed(2))]
  const base = Math.floor((total * 100) / parcelas) / 100
  const valores = Array.from({ length: parcelas - 1 }, () => base)
  const somaAteAqui = parseFloat((base * (parcelas - 1)).toFixed(2))
  valores.push(parseFloat((total - somaAteAqui).toFixed(2)))
  return valores
}

/**
 * Vencimento da parcela `i`, contando meses a partir da primeira data.
 *
 * Usa o dia 1 como âncora ao somar meses e depois recoloca o dia, para 31/01
 * + 1 mês não virar 03/03. Quem paga em cheque marca "todo dia 10" — e o
 * sistema tem de respeitar isso mesmo em fevereiro.
 */
function vencimentoDaParcela(primeira: string | null | undefined, i: number): string | null {
  if (!primeira) return null
  const [ano, mes, dia] = primeira.slice(0, 10).split('-').map(Number)
  if (!ano || !mes || !dia) return null

  const alvo = new Date(Date.UTC(ano, mes - 1 + i, 1))
  // Dia 31 num mês de 30 cai para o último dia daquele mês, não para o mês seguinte.
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(dia, ultimoDia))
  return alvo.toISOString().slice(0, 10)
}

// ─── Action: detalhe de uma compra ───────────────────────────────────────────

export interface PurchaseDetail {
  id: string
  purchase_date: string
  /** Preenchido quando esta compra é um lote consignado — abre o bloco de acertos. */
  consignment_id: string | null
  nf_number: string | null
  nf_url: string | null
  notes: string | null
  total_cost: number
  total_items: number
  items: Array<{
    id: string
    product_name: string
    supplier_name: string
    category: string
    material: string
    unit_cost: number
    sale_price: number
    quantity: number
    subtotal: number
    label_format: string
    store_name: string
    code: string
    barcode_number: string | null
  }>
  payments: Array<{
    id: string
    payment_method: string
    amount: number
    installment_number: number | null
    due_date: string
    status: string
  }>
}

export async function buscarDetalheCompra(purchaseId: string): Promise<{ data: PurchaseDetail | null; error?: string }> {
  // Custo e pagamento a fornecedor: só admin (antes nem pedia login, 07/10/2026).
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { data: null, error: authErr }
  const admin = createAdminClient()

  const escopo = await escopoDaCompra(admin, purchaseId)
  if ('erro' in escopo) return { data: null, error: escopo.erro }

  const { data: purchase, error: purchErr } = await admin
    .from('purchases')
    .select('id, purchase_date, nf_number, nf_url, notes, total_cost, total_items, consignment_id')
    .eq('id', purchaseId)
    .single()

  if (purchErr || !purchase) return { data: null, error: purchErr?.message }

  /*
   * Falha de leitura é ERRO, não lista vazia. Com `?? []`, uma queda de rede
   * mostrava a compra sem peças e sem pagamentos — e a folha de conferência
   * impressa dali dizia à fornecedora que não havia nada. Ver CLAUDE.md.
   */
  // Só as peças da loja da sessão: numa compra das duas, a outra metade é da outra loja.
  let qItens = admin
    .from('purchase_items')
    .select('id, quantity, unit_cost, subtotal, label_format, products!inner(name, code, barcode_number, category, material, sale_price, store_id, suppliers(name), stores(name))')
    .eq('purchase_id', purchaseId)
  if (escopo.loja) qItens = qItens.eq('products.store_id', escopo.loja)
  const { data: rawItems, error: itemsErr } = await qItens

  if (itemsErr || !rawItems) {
    return { data: null, error: `Não foi possível ler as peças da compra: ${itemsErr?.message ?? 'sem resposta'}` }
  }

  const { data: payments, error: payErr } = await admin
    .from('purchase_payments')
    .select('id, payment_method, amount, installment_number, due_date, status')
    .eq('purchase_id', purchaseId)
    .order('due_date', { ascending: true })

  if (payErr || !payments) {
    return { data: null, error: `Não foi possível ler os pagamentos da compra: ${payErr?.message ?? 'sem resposta'}` }
  }

  const items = rawItems.map((item: any) => ({
    id: item.id,
    product_name: item.products?.name ?? '—',
    supplier_name: item.products?.suppliers?.name ?? '—',
    category: item.products?.category ?? '—',
    material: item.products?.material ?? '—',
    unit_cost: item.unit_cost,
    sale_price: item.products?.sale_price ?? 0,
    quantity: item.quantity,
    subtotal: item.subtotal,
    label_format: item.label_format ?? 'A',
    store_name: item.products?.stores?.name ?? '—',
    code: item.products?.code ?? '—',
    barcode_number: item.products?.barcode_number ?? null,
  }))

  /* Compra das duas lojas vista de uma: total e peças são só os desta loja. */
  const mista = escopo.lojas.length > 1
  return {
    data: {
      ...purchase,
      ...(mista ? {
        total_cost:  items.reduce((s: number, i: { subtotal: number }) => s + Number(i.subtotal), 0),
        total_items: items.reduce((s: number, i: { quantity: number }) => s + Number(i.quantity), 0),
      } : {}),
      items,
      payments,
    }
  }
}

// ─── Action: deletar compra ───────────────────────────────────────────────────

export async function deletarCompra(purchaseId: string): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  /* Só compra que é inteira desta loja (08/10/2026): excluir ou editar uma
   * compra das duas de dentro de uma loja mexeria nas peças da outra. */
  const escopo = await escopoDaCompra(admin, purchaseId)
  if ('erro' in escopo) return { success: false, error: escopo.erro }
  if (escopo.lojas.length > 1 && !escopo.podeAlterarMista) {
    return { success: false, error: 'Esta compra tem peças das duas lojas: só a administração da rede pode alterá-la.' }
  }

  /*
   * TUDO OU NADA, desde 01/10 (`fv.excluir_compra`).
   *
   * Antes eram sete escritas soltas, ordenadas para que o "tentar de novo" não
   * estornasse o estoque duas vezes — e ainda assim o pior caso era um estorno
   * que faltava, peça por peça, para corrigir na conferência. Agora a função
   * apaga financeiro, parcelas, vínculo das peças, itens, estorna o estoque
   * (nunca abaixo de zero, como antes) e apaga o cabeçalho numa transação só.
   *
   * Peça que já vendeu continua barrando a exclusão: o estorno tiraria do
   * estoque unidades que já saíram pela venda, e a venda ficaria apontando
   * para uma compra que não existe mais. O caminho é editar a compra.
   *
   * Cada peça estornada deixa rastro em `stock_movements` (quem excluiu):
   * sem isso a conferência de estoque não enxergaria a saída.
   */
  const { data: resp, error: rpcErr } = await admin.rpc('excluir_compra', {
    p_purchase_id: purchaseId,
    p_user_id:     userId,
  })

  if (rpcErr || !resp) {
    console.error('[deletarCompra] fv.excluir_compra falhou', rpcErr)
    return {
      success: false,
      error: falhaDoBanco(
        rpcErr ?? {},
        'excluir a compra',
        'Não foi possível confirmar a exclusão (falha de conexão). Atualize a lista: se a compra ainda aparecer, exclua de novo.',
      ),
    }
  }

  const r = resp as { ok: true } | { erro: 'nao_encontrada' } | { erro: 'tem_venda'; pecas: string[] }

  if ('erro' in r) {
    if (r.erro === 'nao_encontrada') {
      return { success: false, error: 'Compra não encontrada — ela pode já ter sido excluída. Atualize a lista.' }
    }
    const lista = r.pecas ?? []
    const exemplos = lista.slice(0, 3).join(', ') + (lista.length > 3 ? ` e mais ${lista.length - 3}` : '')
    return {
      success: false,
      error: `Esta compra não pode ser excluída: ${lista.length} ${lista.length === 1 ? 'peça dela já tem venda' : 'peças dela já têm venda'} registrada (${exemplos}). Use "Editar compra" para corrigir o que for preciso.`,
    }
  }

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  return { success: true }
}

// ─── Tipos para edição de compra ─────────────────────────────────────────────

export interface CompraItemParaEdicao {
  purchaseItemId: string
  productId: string
  name: string
  category: string
  material: string
  costPrice: number
  salePrice: number
  promoPrice: number | null
  labelFormat: 'A' | 'B'
  quantity: number
  unitsSold: number
  currentStock: number
  storeId: string
  storeName: string
  supplierId: string
  supplierName: string
}

export interface CompraParaEdicao {
  id: string
  purchaseDate: string
  notes: string
  nfNumber: string
  items: CompraItemParaEdicao[]
  payments: Array<{
    id: string
    paymentMethod: string
    amount: number
    installmentNumber: number | null
    dueDate: string
    status: 'completed' | 'pending'
    supplierId: string | null
  }>
  stores: Array<{ id: string; name: string; city: string }>
  suppliers: Array<{ id: string; name: string; initials: string }>
  hasAnySale: boolean
  /** Lojas com remessa de lote ainda não conferida (vazio = nenhuma). Trava os itens. */
  remessaPendentePara: string[]
}

export interface EditItemData {
  purchaseItemId: string
  productId: string
  name: string
  category: string
  material: string
  costPrice: number
  salePrice: number
  promoPrice: number | null
  labelFormat: 'A' | 'B'
  quantity: number
  storeId: string
  supplierId: string
}

export interface EditPaymentData {
  id: string
  paymentMethod: string
  amount: number
  dueDate: string
  installmentNumber: number | null
  status: 'completed' | 'pending'
  supplierId: string | null
}

export interface EditCompraPayload {
  purchaseId: string
  purchaseDate: string
  notes: string
  nfNumber: string
  items: EditItemData[]
  payments: EditPaymentData[]
}

// ─── Action: buscar compra para edição ────────────────────────────────────────

export async function buscarCompraParaEdicao(
  purchaseId: string
): Promise<{ data: CompraParaEdicao | null; error?: string }> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { data: null, error: authErr }

  const admin = createAdminClient()

  /* A edição mostra a compra INTEIRA (salvar com metade das peças apagaria a
   * outra metade), então compra das duas lojas só abre para a admin global. */
  const escopo = await escopoDaCompra(admin, purchaseId)
  if ('erro' in escopo) return { data: null, error: escopo.erro }
  const mista = escopo.lojas.length > 1
  if (mista && !escopo.podeAlterarMista) {
    return { data: null, error: 'Esta compra tem peças das duas lojas: só a administração da rede pode editá-la.' }
  }

  const { data: purchase } = await admin
    .from('purchases')
    .select('id, purchase_date, notes, nf_number')
    .eq('id', purchaseId)
    .single()

  if (!purchase) return { data: null, error: 'Compra não encontrada.' }

  const { data: rawItems } = await admin
    .from('purchase_items')
    .select(`
      id, quantity, unit_cost, label_format,
      products!inner (
        id, name, category, material,
        cost_price, sale_price, promotional_price,
        label_format, quantity_in_stock, store_id, supplier_id,
        suppliers!supplier_id(name, initials),
        stores!store_id(name)
      )
    `)
    .eq('purchase_id', purchaseId)

  const items = (rawItems ?? []) as unknown as Array<{
    id: string; quantity: number; unit_cost: number; label_format: string | null
    products: {
      id: string; name: string; category: string; material: string
      cost_price: number; sale_price: number; promotional_price: number | null
      label_format: string; quantity_in_stock: number; store_id: string; supplier_id: string
      suppliers: { name: string; initials: string } | null
      stores: { name: string } | null
    }
  }>

  const productIds = items.map(i => i.products.id)
  const soldCounts = new Map<string, number>()

  if (productIds.length > 0) {
    const { data: soldData } = await admin
      .from('sale_items')
      .select('product_id, quantity')
      .in('product_id', productIds)
    for (const row of (soldData ?? []) as Array<{ product_id: string; quantity: number }>) {
      soldCounts.set(row.product_id, (soldCounts.get(row.product_id) ?? 0) + row.quantity)
    }
  }

  const { data: payments } = await admin
    .from('purchase_payments')
    .select('id, payment_method, amount, installment_number, due_date, status, supplier_id')
    .eq('purchase_id', purchaseId)
    .order('due_date', { ascending: true })

  const [storesRes, suppliersRes] = await Promise.all([
    (() => {
      let q = admin.from('stores').select('id, name, city').eq('is_active', true)
      if (escopo.loja && !mista) q = q.eq('id', escopo.loja)
      return q
    })(),
    admin.from('suppliers').select('id, name, initials').eq('is_active', true).order('name'),
  ])

  const hasAnySale = productIds.some(pid => (soldCounts.get(pid) ?? 0) > 0)
  const remessa = await lerRemessaPendente(admin, purchaseId)
  if ('erro' in remessa) return { data: null, error: remessa.erro }

  return {
    data: {
      id: purchase.id,
      purchaseDate: purchase.purchase_date,
      notes: purchase.notes ?? '',
      nfNumber: purchase.nf_number ?? '',
      items: items.map(item => {
        const p = item.products
        return {
          purchaseItemId: item.id,
          productId:      p.id,
          name:           p.name,
          category:       p.category,
          material:       p.material,
          costPrice:      p.cost_price,
          salePrice:      p.sale_price,
          promoPrice:     p.promotional_price ?? null,
          labelFormat:    ((item.label_format ?? p.label_format) as 'A' | 'B') || 'B',
          quantity:       item.quantity,
          unitsSold:      soldCounts.get(p.id) ?? 0,
          currentStock:   p.quantity_in_stock,
          storeId:        p.store_id,
          storeName:      p.stores?.name ?? '—',
          supplierId:     p.supplier_id,
          supplierName:   p.suppliers?.name ?? '—',
        }
      }),
      payments: (payments ?? []).map(p => ({
        id:                p.id,
        paymentMethod:     p.payment_method,
        amount:            p.amount,
        installmentNumber: p.installment_number,
        dueDate:           p.due_date ?? '',
        status:            p.status as 'completed' | 'pending',
        supplierId:        (p as { supplier_id: string | null }).supplier_id ?? null,
      })),
      stores:    (storesRes.data    ?? []) as Array<{ id: string; name: string; city: string }>,
      suppliers: (suppliersRes.data ?? []) as Array<{ id: string; name: string; initials: string }>,
      hasAnySale,
      remessaPendentePara: remessa.lojas,
    }
  }
}

/*
 * Remessa de lote do fornecedor ainda não conferida pela loja de destino (ver
 * src/lib/compras/remessaPendente.ts). Falha de leitura não vira "sem remessa":
 * liberaria a edição que joga peça em trânsito direto no estoque.
 */
async function lerRemessaPendente(
  admin: ReturnType<typeof createAdminClient>,
  purchaseId: string,
): Promise<{ lojas: string[] } | { erro: string }> {
  const { data, error } = await admin
    .from('transfers')
    .select('status, stores!to_store_id(name)')
    .eq('purchase_id', purchaseId)
    .eq('kind', 'lote_fornecedor')
  if (error || !data) {
    return { erro: `Não foi possível conferir a remessa desta compra: ${error?.message ?? 'sem resposta'}. Nada foi alterado.` }
  }
  const lojas = (data as unknown as Array<{ status: string; stores: { name: string } | null }>)
    .filter(t => remessaEstaPendente(t.status))
    .map(t => t.stores?.name ?? 'outra loja')
  return { lojas: [...new Set(lojas)] }
}

// ─── Action: salvar edição de compra ─────────────────────────────────────────

export async function editarCompra(payload: EditCompraPayload): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  /* Só compra que é inteira desta loja (08/10/2026): excluir ou editar uma
   * compra das duas de dentro de uma loja mexeria nas peças da outra. */
  const escopo = await escopoDaCompra(admin, payload.purchaseId)
  if ('erro' in escopo) return { success: false, error: escopo.erro }
  if (escopo.lojas.length > 1 && !escopo.podeAlterarMista) {
    return { success: false, error: 'Esta compra tem peças das duas lojas: só a administração da rede pode alterá-la.' }
  }

  /*
   * TS CONFERE, O BANCO GRAVA NUMA TRANSAÇÃO SÓ (desde 01/10).
   *
   *   1. TODAS as leituras e TODAS as conferências aqui, com as mensagens de
   *      sempre (vendas, estoque que ficaria negativo, peça/pagamento que não
   *      é desta compra, pareamento pagamento ↔ despesa).
   *   2. `fv.editar_compra` grava peças, estoque (delta atômico), itens,
   *      pagamentos, financeiro, cabeçalho e totais — tudo ou nada. Antes eram
   *      escritas soltas, e uma falha no meio deixava "as peças anteriores já
   *      foram salvas" e o estoque para corrigir à mão.
   *   3. Pagamentos e despesas continuam atualizados NO LUGAR (mesmos ids),
   *      preservando descrição e data de pagamento.
   */

  // ── 1. Leituras ─────────────────────────────────────────────────────────
  const { data: compra, error: compraErr } = await admin
    .from('purchases').select('id, consignment_id').eq('id', payload.purchaseId).maybeSingle()
  if (compraErr) return { success: false, error: `Não foi possível ler a compra: ${compraErr.message}` }
  if (!compra) return { success: false, error: 'Compra não encontrada.' }

  /*
   * CONSIGNAÇÃO NÃO TEM PAGAMENTO — mesma regra do salvarCompra.
   *
   * Aqui a trava de pagamento reprovava TODA edição de consignação ("adicione
   * ao menos um pagamento"), porque o lote não tem linha nenhuma para somar.
   * E o financeiro não é mexido: a despesa do consignado nasce no acerto.
   */
  const ehConsignacao = !!(compra as { consignment_id: string | null }).consignment_id

  /*
   * Remessa do lote ainda em trânsito: quantidade, loja, custo e preço travados
   * até a loja conferir (src/lib/compras/remessaPendente.ts). Compara com o que
   * está GRAVADO, não com a tela, para que salvar só a data/NF/pagamento passe.
   */
  const remessa = await lerRemessaPendente(admin, payload.purchaseId)
  if ('erro' in remessa) return { success: false, error: remessa.erro }
  if (remessa.lojas.length > 0) {
    const { data: gravados, error: gravErr } = await admin
      .from('purchase_items')
      .select('id, quantity, products!inner(name, store_id, cost_price, sale_price, promotional_price)')
      .eq('purchase_id', payload.purchaseId)
    if (gravErr || !gravados) {
      return { success: false, error: `Não foi possível ler as peças da compra: ${gravErr?.message ?? 'sem resposta'}. Nada foi alterado.` }
    }
    const mudou = itemQueMexeNaRemessa(
      (gravados as unknown as Array<{
        id: string; quantity: number
        products: { name: string; store_id: string; cost_price: number; sale_price: number; promotional_price: number | null }
      }>).map(g => ({
        purchaseItemId: g.id,
        name:           g.products.name,
        quantity:       g.quantity,
        storeId:        g.products.store_id,
        costPrice:      g.products.cost_price,
        salePrice:      g.products.sale_price,
        promoPrice:     g.products.promotional_price,
      })),
      payload.items,
    )
    if (mudou) return { success: false, error: mensagemRemessaPendente(remessa.lojas, mudou) }
  }

  if (!ehConsignacao) {
    // Mesma trava da criação: editar não pode zerar o valor, apagar a situação,
    // nem deixar a soma dos pagamentos diferente do custo dos itens. Aqui a
    // checagem é sobre o total da compra, e não por fornecedor: nesta tela os
    // pagamentos são editados em lista única.
    const custoItens = payload.items.reduce((s, it) => s + it.costPrice * (it.quantity || 1), 0)
    const payErr = validatePaymentGroups([
      {
        label: 'pagamentos da compra',
        subtotal: custoItens,
        payments: payload.payments.map(p => ({ amount: p.amount, status: p.status })),
      },
    ])
    if (payErr) return { success: false, error: payErr }
  }

  // Quantidades gravadas — base do delta de estoque.
  const { data: originalItems, error: origErr } = await admin
    .from('purchase_items')
    .select('id, product_id, quantity')
    .eq('purchase_id', payload.purchaseId)
  if (origErr || !originalItems) {
    return { success: false, error: `Não foi possível ler as peças da compra: ${origErr?.message ?? 'sem resposta'}. Nada foi alterado.` }
  }

  const originalPorItem = new Map(
    (originalItems as Array<{ id: string; product_id: string; quantity: number }>).map(i => [i.id, i])
  )

  // O item e a peça vêm da tela; a tela não é autoridade sobre o que é desta compra.
  for (const item of payload.items) {
    const orig = originalPorItem.get(item.purchaseItemId)
    if (!orig || orig.product_id !== item.productId) {
      return { success: false, error: `"${item.name}" não pertence mais a esta compra. Recarregue a página antes de salvar.` }
    }
  }

  const productIds = [...new Set(payload.items.map(i => i.productId))]
  const soldCounts = new Map<string, number>()
  const estoqueAtual = new Map<string, { store_id: string; quantity_in_stock: number }>()

  for (let de = 0; de < productIds.length; de += 150) {
    const bloco = productIds.slice(de, de + 150)

    const { data: soldData, error: soldErr } = await admin
      .from('sale_items').select('product_id, quantity').in('product_id', bloco)
    // Venda não lida como "nenhuma venda" liberaria diminuir abaixo do vendido.
    if (soldErr) return { success: false, error: `Não foi possível conferir as vendas: ${soldErr.message}. Nada foi alterado.` }
    for (const row of (soldData ?? []) as Array<{ product_id: string; quantity: number }>) {
      soldCounts.set(row.product_id, (soldCounts.get(row.product_id) ?? 0) + row.quantity)
    }

    const { data: prods, error: prodErr } = await admin
      .from('products').select('id, store_id, quantity_in_stock').in('id', bloco)
    // Estoque não lido NÃO vira zero: gravaria "0 + delta" por cima do saldo real.
    if (prodErr || !prods) {
      return { success: false, error: `Não foi possível ler o estoque atual: ${prodErr?.message ?? 'sem resposta'}. Nada foi alterado.` }
    }
    for (const p of prods as Array<{ id: string; store_id: string; quantity_in_stock: number | null }>) {
      estoqueAtual.set(p.id, { store_id: p.store_id, quantity_in_stock: Number(p.quantity_in_stock ?? 0) })
    }
  }

  // ── 2. Conferências de estoque (antes de qualquer escrita) ──────────────
  // A mesma peça pode estar em duas linhas: soma os deltas antes.
  const deltaPorPeca = new Map<string, number>()
  for (const item of payload.items) {
    const unitsSold = soldCounts.get(item.productId) ?? 0
    if (item.quantity < unitsSold) {
      return {
        success: false,
        error: `"${item.name}": quantidade (${item.quantity}) não pode ser menor que unidades já vendidas (${unitsSold}).`
      }
    }

    const prod = estoqueAtual.get(item.productId)
    if (!prod) return { success: false, error: `"${item.name}": a peça não foi encontrada no estoque. Recarregue a página.` }

    if (prod.store_id !== item.storeId && unitsSold > 0) {
      return { success: false, error: `"${item.name}": não é possível mudar de loja pois já possui vendas registradas.` }
    }

    const originalQty = originalPorItem.get(item.purchaseItemId)!.quantity
    deltaPorPeca.set(item.productId, (deltaPorPeca.get(item.productId) ?? 0) + (item.quantity - originalQty))
  }

  for (const [pid, delta] of deltaPorPeca) {
    const atual = estoqueAtual.get(pid)!.quantity_in_stock
    const novo = atual + delta
    if (novo < 0) {
      /*
       * Estoque negativo não se grava. Acontece quando a quantidade da compra é
       * reduzida abaixo do que já SAIU da loja — por venda, transferência ou
       * baixa. Antes gravava o negativo e a conferência de estoque herdava.
       */
      const nome = payload.items.find(i => i.productId === pid)?.name ?? 'peça'
      const qtdCompra = payload.items.filter(i => i.productId === pid).reduce((s, i) => s + i.quantity, 0)
      const minimo = qtdCompra - novo
      return {
        success: false,
        error: `"${nome}": só há ${atual} em estoque — as outras já saíram (venda, transferência ou baixa). A quantidade desta compra não pode ficar abaixo de ${minimo}.`,
      }
    }
  }

  // ── 3. Pagamentos e financeiro: leituras e conferências ─────────────────
  type PagamentoGravado = {
    id: string; payment_method: string; amount: number; due_date: string | null
    status: string; paid_at: string | null; installment_number: number | null; supplier_id: string | null
  }
  type DespesaGravada = {
    id: string; amount: number; payment_method: string | null; due_date: string | null
    paid_at: string | null; description: string | null
  }

  const pagamentosOriginais = new Map<string, PagamentoGravado>()
  const despesaDoPagamento = new Map<string, DespesaGravada>()
  let despesasSobrando: DespesaGravada[] = []

  if (!ehConsignacao) {
    const { data: pps, error: ppErr } = await admin
      .from('purchase_payments')
      .select('id, payment_method, amount, due_date, status, paid_at, installment_number, supplier_id')
      .eq('purchase_id', payload.purchaseId)
    if (ppErr || !pps) {
      return { success: false, error: `Não foi possível ler os pagamentos: ${ppErr?.message ?? 'sem resposta'}. Nada foi alterado.` }
    }
    for (const p of pps as PagamentoGravado[]) pagamentosOriginais.set(p.id, p)

    for (const pay of payload.payments) {
      if (!pagamentosOriginais.has(pay.id)) {
        return { success: false, error: 'Um dos pagamentos não pertence mais a esta compra. Recarregue a página antes de salvar.' }
      }
    }

    const { data: txs, error: txLerErr } = await admin
      .from('transactions')
      .select('id, amount, payment_method, due_date, paid_at, description')
      .eq('reference_id', payload.purchaseId)
      .eq('reference_type', 'purchase')
    if (txLerErr || !txs) {
      return { success: false, error: `Não foi possível ler o financeiro da compra: ${txLerErr?.message ?? 'sem resposta'}. Nada foi alterado.` }
    }

    /*
     * Cada pagamento é pareado com a despesa que nasceu junto com ele, pelo
     * mesmo critério do "marcar como pago" do financeiro: método + valor +
     * vencimento, com os valores de ANTES da edição. É isso que permite
     * atualizar a despesa no lugar e preservar a descrição e a data em que foi
     * paga — antes tudo era apagado e recriado com `paid_at = agora` e
     * descrição "Compra".
     */
    const livres = [...(txs as DespesaGravada[])]
    for (const pay of payload.payments) {
      const orig = pagamentosOriginais.get(pay.id)!
      const idx = livres.findIndex(t =>
        (t.payment_method ?? '') === (orig.payment_method ?? '') &&
        Math.round(Number(t.amount) * 100) === Math.round(Number(orig.amount) * 100) &&
        (t.due_date ?? '') === (orig.due_date ?? '')
      )
      if (idx >= 0) {
        despesaDoPagamento.set(pay.id, livres[idx])
        livres.splice(idx, 1)
      }
    }
    // Despesa sem pagamento por trás: a regravação antiga já as apagava.
    despesasSobrando = livres
  }

  // ── 4. Monta a edição já resolvida ──────────────────────────────────────
  /*
   * `quantidade_original` é a quantidade do item LIDA acima — base de todos os
   * deltas. A função trava os itens e, se alguma mudou desde a leitura (outra
   * edição salva no meio), aborta sem gravar: o delta estaria errado.
   */
  const itens = payload.items.map(item => ({
    purchase_item_id:    item.purchaseItemId,
    product_id:          item.productId,
    quantidade_original: originalPorItem.get(item.purchaseItemId)!.quantity,
    quantity:            item.quantity,
    name:                item.name.trim(),
    category:            item.category.trim().toLowerCase(),
    material:            item.material.trim().toLowerCase(),
    cost_price:          item.costPrice,
    sale_price:          item.salePrice,
    promotional_price:   item.promoPrice ?? null,
    label_format:        item.labelFormat,
    supplier_id:         item.supplierId,
    store_id:            item.storeId,
  }))

  const pagamentos: Array<Record<string, unknown>> = []
  const despesas: Array<Record<string, unknown>> = []

  if (!ehConsignacao) {
    // Só o que a tela edita. `status` e `paid_at` NÃO vêm da tela: quem quita
    // é o financeiro, e reescrever aqui zerava a data do pagamento.
    for (const pay of payload.payments) {
      pagamentos.push({
        id:             pay.id,
        payment_method: pay.paymentMethod,
        amount:         pay.amount,
        due_date:       pay.dueDate || null,
        supplier_id:    pay.supplierId ?? null,
      })
    }

    // NF de fallback para despesa nova: só quando a compra tem UMA nota.
    const nfUnica = payload.nfNumber?.trim() && !payload.nfNumber.includes('|') ? payload.nfNumber.trim() : null

    for (const pay of payload.payments) {
      const orig   = pagamentosOriginais.get(pay.id)!
      const antiga = despesaDoPagamento.get(pay.id)

      const status = orig.status === 'pending' ? 'pending' : 'completed'
      // Nulo em pago = "agora", posto pela função do banco.
      const paidAt = status === 'completed' ? (antiga?.paid_at ?? orig.paid_at ?? null) : null

      /* Descrição: a que já existe vale, a não ser que o MÉTODO mudou (aí o
         "Cheque 2/3" antigo mentiria). Nesse caso remonta com a regra da
         criação, contando as parcelas do mesmo método e fornecedor. */
      let descricao = antiga?.description ?? null
      if (!descricao || pay.paymentMethod !== orig.payment_method) {
        const parcelas = Math.max(1, ...payload.payments
          .filter(p => p.paymentMethod === pay.paymentMethod && (p.supplierId ?? null) === (pay.supplierId ?? null))
          .map(p => pagamentosOriginais.get(p.id)?.installment_number ?? 1))
        const nfDaAntiga = antiga?.description?.match(/ NF (.+)$/)?.[1] ?? null
        descricao = descricaoDaDespesa(
          pay.paymentMethod,
          orig.installment_number ?? 1,
          parcelas,
          nfDaAntiga ?? nfUnica,
        )
      }

      despesas.push({
        id:             antiga?.id ?? null,   // nulo = despesa nova
        payment_method: pay.paymentMethod,
        amount:         pay.amount,
        due_date:       pay.dueDate || null,
        status,
        paid_at:        paidAt,
        description:    descricao,
      })
    }
  }

  // ── 5. Grava tudo numa transação ────────────────────────────────────────
  /*
   * Peças, estoque (por delta atômico, recusando negativo), itens, pagamentos,
   * financeiro, cabeçalho e os totais — refeitos a partir dos itens gravados,
   * não do payload. Qualquer erro desfaz tudo: acabou o "as peças anteriores a
   * ela já foram salvas".
   */
  const { error: rpcErr } = await admin.rpc('editar_compra', {
    p: {
      purchase_id:      payload.purchaseId,
      user_id:          userId,
      purchase_date:    payload.purchaseDate,
      notes:            payload.notes || null,
      nf_number:        payload.nfNumber || null,
      itens,
      pagamentos,
      despesas,
      // Despesa sem pagamento por trás: a regravação antiga já as apagava.
      despesas_remover: despesasSobrando.map(t => t.id),
    },
  })

  if (rpcErr) {
    console.error('[editarCompra] fv.editar_compra falhou', rpcErr)
    return {
      success: false,
      error: falhaDoBanco(
        rpcErr,
        'salvar a edição',
        'Não foi possível confirmar se a edição foi salva (falha de conexão). Recarregue a página e confira antes de salvar de novo.',
      ),
    }
  }

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')
  return { success: true }
}

// ─── Buscar itens de uma compra para impressão de etiquetas ──────────────────

export interface ItemParaEtiqueta {
  id: string
  name: string
  supplier_reference: string | null
  sale_price: number
  barcode_number: string
  label_format: 'A' | 'B'
  quantity: number
  category: string
}

export async function getItensCompraParaEtiquetas(purchaseId: string): Promise<ItemParaEtiqueta[]> {
  // O código da peça embute o custo: só admin (antes nem pedia login).
  const { error: authErr } = await verifyAdmin()
  if (authErr) throw new Error(authErr)
  const admin = createAdminClient()
  const escopo = await escopoDaCompra(admin, purchaseId)
  if ('erro' in escopo) throw new Error(escopo.erro)
  let q = admin
    .from('purchase_items')
    .select(`
      quantity,
      label_format,
      products!inner (
        id,
        name,
        code,
        sale_price,
        promotional_price,
        promotional_active,
        barcode_number,
        label_format,
        category,
        store_id
      )
    `)
    .eq('purchase_id', purchaseId)
  if (escopo.loja) q = q.eq('products.store_id', escopo.loja)
  const { data, error } = await q

  if (error || !data) return []

  return data.map((row) => {
    const p = row.products as unknown as {
      id: string
      name: string
      code: string
      sale_price: number
      promotional_price: number | null
      promotional_active: boolean | null
      barcode_number: string
      label_format: 'A' | 'B'
      category: string
    }
    return {
      id: p.id,
      name: p.name,
      // A 2ª linha da etiqueta (referência interna) usa o code do produto (ex: FGS0545000)
      supplier_reference: p.code,
      // Preço efetivo: só usa a promo se estiver ATIVA e > 0 (mesma regra do PDV,
      // da lista de produtos e do detalhe). `??` sozinho deixava a promo desligada
      // valer e deixava promotional_price=0 passar, imprimindo R$ 0,00.
      sale_price: p.promotional_active && p.promotional_price && p.promotional_price > 0
        ? p.promotional_price
        : p.sale_price,
      barcode_number: p.barcode_number,
      // Preferência: label_format do item da compra; fallback no produto
      label_format: (row.label_format as 'A' | 'B') ?? p.label_format,
      quantity: row.quantity ?? 1,
      category: p.category ?? '',
    }
  })
}
