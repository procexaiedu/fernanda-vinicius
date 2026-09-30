'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { generateCode } from '@/lib/productCode'
import { validatePaymentGroups } from '@/lib/compras/validate-payments'
import { formatarNomeProprio } from '@/lib/nomeProprio'
import { recalcularTotaisDaCompra } from '@/lib/compras/totais'
import { normalizarNomeFornecedor } from '@/lib/nomeFornecedor'
import { mensagemConsignacaoMisturada } from '@/lib/compras/consignacao'
import {
  idDeRequisicaoValido, colunaDeIdempotenciaAusente, violouUnico, avisarIdempotenciaDesligada,
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

// ─── Idempotência ─────────────────────────────────────────────────────────────

type Admin = ReturnType<typeof createAdminClient>

/**
 * A compra com este `client_request_id` — o reenvio de uma compra que já entrou.
 *
 * `colunaAusente` = a migration de 30/09 ainda não foi aplicada: segue SEM
 * idempotência, como antes (o deploy não pode travar a compra pela ordem).
 */
async function procurarCompraPorPedido(
  admin: Admin, idReq: string,
): Promise<{ purchaseId: string | null } | { colunaAusente: true } | { erro: true }> {
  const { data, error } = await admin
    .from('purchases').select('id').eq('client_request_id', idReq).maybeSingle()
  if (error) {
    if (colunaDeIdempotenciaAusente(error)) {
      avisarIdempotenciaDesligada('purchases', error)
      return { colunaAusente: true }
    }
    console.error('[salvarCompra] falha ao procurar compra pelo client_request_id', error)
    return { erro: true }
  }
  return { purchaseId: (data?.id as string | undefined) ?? null }
}

/**
 * A resposta para um reenvio cuja compra JÁ EXISTE.
 *
 * O primeiro envio pode ter criado a compra e parado depois (itens,
 * pagamentos) — e o erro dele é que se perdeu, ou ela o viu e clicou de novo.
 * Devolver "sucesso" aí esconderia uma compra pela metade atrás da tela de
 * etiquetas. Confere pelo menos as linhas: cada linha da grade vira um
 * `purchase_items`, 1 para 1.
 *
 * ANTES disso confere se é MESMO a mesma compra: nº de peças e custo total,
 * gravados no cabeçalho num insert só (não ficam "pela metade"). Loja e
 * fornecedor não entram porque `purchases` não os guarda (ficam nulos; estão
 * nas peças). Um id que sobrou de uma compra já salva e foi mandado com OUTRA
 * devolvia "sucesso" e abria as etiquetas da compra antiga — e a nova nunca
 * entrava. Divergiu: erro claro, nada gravado, `idReusado` para a tela.
 */
async function respostaDaCompraJaGravada(
  admin: Admin, purchaseId: string, data: CompraFormData,
): Promise<ActionResult> {
  const [compraRes, itensRes] = await Promise.all([
    admin.from('purchases').select('total_cost, total_items').eq('id', purchaseId).maybeSingle(),
    admin.from('purchase_items').select('id', { count: 'exact', head: true }).eq('purchase_id', purchaseId),
  ])
  const count = itensRes.count

  if (!compraRes.error && compraRes.data && !itensRes.error) {
    /* A mesma conta do insert lá embaixo (`totalCost`/`totalItems`). */
    const custoEnviado = data.rows.reduce((s, r) => s + r.costPrice * r.quantity, 0)
    const pecasEnviadas = data.rows.reduce((s, r) => s + r.quantity, 0)
    const outraCompra =
      Math.abs((Number(compraRes.data.total_cost) || 0) - custoEnviado) > 0.011
      || (Number(compraRes.data.total_items) || 0) !== pecasEnviadas
      /* Mais linhas gravadas que as mandadas não é pendência — é outra compra. */
      || (count ?? 0) > data.rows.length
    if (outraCompra) {
      console.error('[salvarCompra] clientRequestId de OUTRA compra — nada gravado', {
        purchaseId,
        gravada: { custo: compraRes.data.total_cost, pecas: compraRes.data.total_items, linhas: count },
        enviada: { custo: custoEnviado, pecas: pecasEnviadas, linhas: data.rows.length },
      })
      return {
        success: false, idReusado: true,
        error: 'Este salvamento já foi usado para outra compra. Recarregue a página (F5) e lance de novo — nada desta compra foi gravado.',
      }
    }
  }

  if (compraRes.error || !compraRes.data || itensRes.error || (count ?? 0) < data.rows.length) {
    console.error('[salvarCompra] reenvio de compra gravada pela metade (ou sem como conferir)', {
      purchaseId, itens: count, esperado: data.rows.length, error: compraRes.error ?? itensRes.error,
    })
    return {
      success: false,
      error: 'Esta compra JÁ TINHA SIDO gravada (o primeiro envio chegou), mas pode ter ficado incompleta. '
        + 'NÃO salve de novo — isso duplicaria as peças. Confira em Compras.',
    }
  }
  console.info('[salvarCompra] reenvio reconhecido — devolvendo a compra já gravada', { purchaseId })
  return { success: true, purchaseId }
}

// ─── Action: salvar compra ────────────────────────────────────────────────────

export async function salvarCompra(data: CompraFormData): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  if (!data.rows.length) return { success: false, error: 'Adicione ao menos um item.' }

  /*
   * REENVIO DE UMA COMPRA QUE JÁ ENTROU? Confere ANTES de criar fornecedor ou
   * peça. Se a resposta do primeiro envio se perdeu com tudo gravado, o
   * segundo clique (ou o rascunho recuperado) criava a compra inteira de novo:
   * peças duplicadas, estoque somado duas vezes, parcelas em dobro.
   *
   * O LIMITE, e ele é real: a coluna só existe em `purchases`, que é gravada
   * DEPOIS de fornecedores e peças. Se a falha foi ANTES desse insert (peças
   * já criadas, compra não), não há o que achar aqui e o reenvio cria as peças
   * de novo. Isto protege o caso "gravou tudo e a resposta se perdeu" e o
   * duplo clique — não substitui uma transação.
   */
  const admin = createAdminClient()
  let idReq = idDeRequisicaoValido(data.clientRequestId)
  if (idReq) {
    const achada = await procurarCompraPorPedido(admin, idReq)
    if ('colunaAusente' in achada) idReq = null
    else if ('erro' in achada) {
      /* Na dúvida não grava: seguir às cegas é exatamente o que duplica. */
      return { success: false, error: 'Não consegui conferir se esta compra já tinha sido gravada. Nada foi registrado agora — tente salvar de novo em instantes.' }
    } else if (achada.purchaseId) {
      return respostaDaCompraJaGravada(admin, achada.purchaseId, data)
    }
  }

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

  // ── 1. Criar fornecedores novos ───────────────────────────────────────────
  // supplierKey = supplierId existente OU supplierName (novo)
  const supplierCache = new Map<string, string>() // key → id final

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
  const iniciaisDoCadastro = new Map<string, string>() // supplierId → initials

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

    const { data: created, error } = await admin
      .from('suppliers')
      .insert({ name: formatarNomeProprio(row.supplierName), initials: row.supplierInitials.trim().toUpperCase() })
      .select('id, initials')
      .single()

    if (error || !created) return { success: false, error: `Erro ao criar fornecedor "${row.supplierName}": ${error?.message}` }
    supplierCache.set(key, created.id)
    // Outra grafia do MESMO fornecedor novo, mais abaixo na grade, cai aqui.
    existentesPorChave.set(chaveFornecedor(row.supplierName), { id: created.id, initials: created.initials })
  }

  function resolveSupplier(row: GridRow): string {
    if (row.supplierId) return row.supplierId
    return supplierCache.get(row.supplierName.trim().toLowerCase())!
  }

  // Mapeia o groupKey de um SupplierPaymentGroup para o id real do fornecedor.
  // O groupKey vem do front como `row.supplierId ?? supplierName.toLowerCase()`.
  function resolveGroupSupplier(groupKey: string): string | null {
    const row = data.rows.find(
      r => (r.supplierId ?? r.supplierName.trim().toLowerCase()) === groupKey
    )
    return row ? resolveSupplier(row) : null
  }

  // ── 2. Resolver iniciais para geração do código ───────────────────────────
  const initialsCache = new Map<string, string>() // supplierId → initials

  for (const row of data.rows) {
    const supId = resolveSupplier(row)
    if (initialsCache.has(supId)) continue
    const doCadastro = iniciaisDoCadastro.get(supId)
    if (doCadastro) {
      initialsCache.set(supId, doCadastro)
    } else if (row.supplierInitials.trim()) {
      initialsCache.set(supId, row.supplierInitials.trim().toUpperCase())
    } else {
      // Leitura que falha não pode virar "FV": o código da peça sairia com o
      // prefixo errado e a etiqueta já impressa não tem volta.
      const { data: sup, error: supErr } = await admin.from('suppliers').select('initials').eq('id', supId).maybeSingle()
      if (supErr) return { success: false, error: `Erro ao ler as iniciais do fornecedor: ${supErr.message}` }
      initialsCache.set(supId, sup?.initials?.toUpperCase() || 'FV')
    }
  }

  /*
   * `.in('id', [...])` vai na URL, e URL tem teto: o PostgREST devolve 414 a
   * partir de ~500 ids, e o CLAUDE.md manda paginar acima de ~200. Uma mala de
   * São Paulo tem 300 peças — exatamente a faixa que quebra. 150 por bloco
   * deixa folga para o resto da querystring.
   */
  const BLOCO_IN = 150
  const emBlocos = <T,>(xs: T[]): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < xs.length; i += BLOCO_IN) out.push(xs.slice(i, i + BLOCO_IN))
    return out
  }

  /* ── 3. Criar / reusar / duplicar produtos ─────────────────────────────────
   *
   * EM LOTE, NÃO UMA PEÇA POR VEZ.
   *
   * Antes era um `for` com `await` dentro: cada peça nova custava um INSERT e
   * cada peça reusada um SELECT mais um UPDATE, em fila. Uma mala de São Paulo
   * traz 300 linhas — são 300 a 600 idas ao banco em série, mais 300 depois
   * para gravar o `purchase_id`. Com ~40ms de ida e volta cada, passa de meio
   * minuto de tela travada, e a dona relatou a compra grande "travando no
   * salvar".
   *
   * Agora é um INSERT só para as peças novas.
   *
   * A ORDEM DO RETORNO IMPORTA: `purchase_items` liga `data.rows[i]` a
   * `resolvedProductIds[i]`, então trocar duas peças de lugar penduraria o
   * subtotal de uma na outra. O Postgres devolve as linhas de um
   * `INSERT ... VALUES ... RETURNING` na ordem em que foram inseridas — e a
   * conferência de quantidade logo abaixo é o que impede de seguir com a
   * suposição quebrada.
   */
  const ownership = data.isConsignment ? 'consignment' : 'own'

  const reusar = data.rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row.productId && !row.productExistingCostDiffers)

  const novas = data.rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => !row.productId || row.productExistingCostDiffers)

  const resolvedProductIds: string[] = new Array(data.rows.length)

  // ── Peças novas: um INSERT para todas ──
  if (novas.length) {
    const linhas = novas.map(({ row }) => {
      const supId    = resolveSupplier(row)
      const initials = initialsCache.get(supId) ?? 'FV'
      return {
        code:              generateCode(initials, purchaseMonth, row.costPrice),
        name:              row.productName.trim(),
        category:          row.category.trim().toLowerCase(),
        material:          row.material.trim().toLowerCase(),
        supplier_id:       supId,
        store_id:          row.storeId,
        cost_price:        row.costPrice,
        sale_price:        row.salePrice,
        promotional_price: row.promoPrice ?? null,
        quantity_in_stock: row.quantity,
        ownership_type:    ownership,
        purchase_month:    purchaseMonth,
        purchase_year:     purchaseYear,
        is_active:         true,
      }
    })

    const { data: criadas, error } = await admin.from('products').insert(linhas).select('id')

    if (error || !criadas) {
      return { success: false, error: `Erro ao criar as peças: ${error?.message}` }
    }
    if (criadas.length !== novas.length) {
      // Voltou quantidade diferente: a correspondência por posição não vale
      // mais, e seguir aqui ligaria peça à linha errada da compra.
      return {
        success: false,
        error: `O banco criou ${criadas.length} peças de ${novas.length}. A compra não foi salva.`,
      }
    }

    novas.forEach(({ i }, n) => { resolvedProductIds[i] = criadas[n].id as string })
  }

  // ── Peças reusadas: um SELECT para todas, depois os UPDATEs em paralelo ──
  if (reusar.length) {
    const ids = reusar.map(({ row }) => row.productId as string)
    const saldo = new Map<string, number>()

    for (const bloco of emBlocos(ids)) {
      const { data: atuais, error } = await admin
        .from('products').select('id, quantity_in_stock').in('id', bloco)

      if (error) return { success: false, error: `Erro ao ler o estoque atual: ${error.message}` }

      for (const p of (atuais ?? []) as Array<{ id: string; quantity_in_stock: number }>) {
        saldo.set(p.id, Number(p.quantity_in_stock ?? 0))
      }
    }

    /*
     * SOMA POR PEÇA ANTES DE GRAVAR.
     *
     * A mesma peça pode aparecer em duas linhas da grade. Gravando linha a
     * linha a partir do saldo lido UMA vez, as duas escreveriam "saldo + a
     * sua quantidade" e a segunda apagaria a primeira: 3 + 2 e 3 + 1 viravam
     * 4, não 6. O loop antigo, em série, relia o saldo entre uma e outra e não
     * tinha o problema — o lote introduziu, a revisão de 16/09 pegou.
     */
    const somaPorPeca = new Map<string, number>()
    for (const { row, i } of reusar) {
      const id = row.productId as string
      resolvedProductIds[i] = id
      somaPorPeca.set(id, (somaPorPeca.get(id) ?? 0) + row.quantity)
    }

    /* Cada peça soma um valor diferente, então não há UPDATE único — mas agora
     * cada id aparece uma vez só, e podem ir juntas. Em blocos de 20 para não
     * abrir 300 conexões de uma vez contra o PostgREST. */
    const agora = new Date().toISOString()
    const pecas = [...somaPorPeca.entries()]
    for (let de = 0; de < pecas.length; de += 20) {
      const bloco = pecas.slice(de, de + 20)
      const erros = await Promise.all(bloco.map(([id, qtd]) =>
        admin.from('products')
          .update({ quantity_in_stock: (saldo.get(id) ?? 0) + qtd, updated_at: agora })
          .eq('id', id)
          .then(r => r.error)
      ))
      const falhou = erros.find(Boolean)
      if (falhou) return { success: false, error: `Erro ao somar o estoque: ${falhou.message}` }
    }
  }

  // ── 4. Consignação ────────────────────────────────────────────────────────
  let consignmentId: string | null = null

  if (data.isConsignment) {
    const totalPieces = data.rows.reduce((s, r) => s + r.quantity, 0)
    const totalCost   = data.rows.reduce((s, r) => s + r.costPrice * r.quantity, 0)
    const firstSupId  = resolveSupplier(data.rows[0])

    const { data: consignment, error } = await admin
      .from('consignments')
      .insert({
        supplier_id:      firstSupId,
        store_id:         data.rows[0]?.storeId ?? null,
        user_id:          userId,
        received_date:    data.purchaseDate,
        return_deadline:  data.returnDeadline || null,
        min_purchase_pct: data.minPurchasePct ?? null,
        total_pieces:     totalPieces,
        total_cost_value: totalCost,
        status:           'active',
      })
      .select('id')
      .single()

    if (error || !consignment) return { success: false, error: `Erro ao criar consignação: ${error?.message}` }

    consignmentId = consignment.id

    // Um UPDATE por bloco: todas as peças recebem o mesmo valor.
    for (const bloco of emBlocos(resolvedProductIds)) {
      const { error: ligaErr } = await admin.from('products')
        .update({ consignment_id: consignment.id })
        .in('id', bloco)

      if (ligaErr) {
        return { success: false, error: `Erro ao ligar as peças ao lote: ${ligaErr.message}` }
      }
    }

    /*
     * E SEGUE PARA CRIAR A COMPRA — não retorna mais aqui.
     *
     * Consignação era um beco sem saída: criava o lote, marcava as peças e
     * voltava. Como detalhe, edição, exclusão e IMPRESSÃO DE ETIQUETA são todos
     * pendurados em `purchases`, a consignação não tinha nenhum dos quatro. Em
     * 07/09 a dona carregou 65 peças de Brasília e não conseguiu imprimir uma
     * etiqueta sequer — precisei criar a compra na mão, no banco, para
     * destravá-la.
     *
     * Nas palavras dele: "esse consignado é exatamente igual a compra, mas é
     * uma compra que ela ainda não pagou". Então é isso que ele é agora — uma
     * `purchase` como qualquer outra, com `consignment_id` ligando ao lote. O
     * que NÃO acontece é pagamento: essas peças só viram despesa no acerto.
     */
  }

  // ── 5. Criar purchase ─────────────────────────────────────────────────────
  const totalCost  = data.rows.reduce((s, r) => s + r.costPrice * r.quantity, 0)
  const totalItems = data.rows.reduce((s, r) => s + r.quantity, 0)

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

  const linhaDaCompra = {
    supplier_id:   null,
    store_id:      null,
    user_id:       userId,
    purchase_date: data.purchaseDate,
    total_cost:    totalCost,
    total_items:   totalItems,
    nf_number:     allNfNumbers,
    nf_url:        firstNfUrl,
    notes:         notasComDesconto,
    // Nulo em compra própria; preenchido quando o lote é consignado.
    consignment_id: consignmentId,
  }
  /* O `as` só silencia a checagem de propriedade extra da inferência do
   * insert — a coluna é opcional e pode nem existir ainda (ver abaixo). */
  const inserirCompra = (comId: boolean) => admin
    .from('purchases')
    .insert(comId && idReq ? { ...linhaDaCompra, client_request_id: idReq } as typeof linhaDaCompra : linhaDaCompra)
    .select('id')
    .single()

  let { data: purchase, error: purchErr } = await inserirCompra(true)

  if (purchErr && idReq) {
    if (violouUnico(purchErr)) {
      /*
       * Corrida: outro envio desta MESMA compra (duas abas com o mesmo
       * rascunho — o duplo clique já é barrado na tela por `envioTravado`)
       * gravou a compra entre a conferência lá de cima e aqui. O índice único
       * impede a compra dupla, mas as peças que ESTE envio criou/somou acima
       * ficam soltas — é o limite descrito no início da função; vai para o
       * log para alguém conferir.
       */
      const outra = await procurarCompraPorPedido(admin, idReq)
      if ('purchaseId' in outra && outra.purchaseId) {
        console.error('[salvarCompra] envio duplo barrado pelo índice único — peças deste envio ficaram sem compra', {
          purchaseId: outra.purchaseId, pecas: resolvedProductIds,
        })
        return { success: true, purchaseId: outra.purchaseId }
      }
    } else if (colunaDeIdempotenciaAusente(purchErr)) {
      /* A conferência passou (cache velho?) mas o insert não conhece a coluna:
       * grava sem ela, como antes da migration. */
      avisarIdempotenciaDesligada('purchases', purchErr)
      ;({ data: purchase, error: purchErr } = await inserirCompra(false))
    }
  }

  if (purchErr || !purchase) return { success: false, error: `Erro ao criar compra: ${purchErr?.message}` }

  // ── 6. Criar purchase_items ───────────────────────────────────────────────
  const purchaseItems = data.rows.map((row, i) => ({
    purchase_id:  purchase.id,
    product_id:   resolvedProductIds[i],
    quantity:     row.quantity,
    unit_cost:    row.costPrice,
    subtotal:     row.costPrice * row.quantity,
    label_format: row.labelFormat,
  }))

  const { error: itemsErr } = await admin.from('purchase_items').insert(purchaseItems)
  if (itemsErr) return { success: false, error: `Erro ao criar itens: ${itemsErr.message}` }

  /* Linkar purchase_id nas peças novas — um UPDATE, não um por peça.
   *
   * Só as novas: peça reusada já pertence à compra em que entrou primeiro, e
   * reescrever isso apagaria de onde ela veio. */
  const idsNovas = novas.map(({ i }) => resolvedProductIds[i]).filter(Boolean)
  for (const bloco of emBlocos(idsNovas)) {
    const { error: linkErr } = await admin.from('products')
      .update({ purchase_id: purchase.id })
      .in('id', bloco)

    if (linkErr) return { success: false, error: `Erro ao ligar as peças à compra: ${linkErr.message}` }
  }

  // ── 7. Criar purchase_payments + transactions ─────────────────────────────
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

  for (const group of gruposDePagamento) {
    const nfNum           = group.nfNumber?.trim() || null
    const groupSupplierId = resolveGroupSupplier(group.groupKey)

    for (const payment of group.payments) {
      const parcelas = PARCELAVEL.has(payment.method) ? Math.max(1, payment.installments) : 1

      // A situação declarada é respeitada. Antes, `(isCredit || !isPending)`
      // forçava 'completed': crédito sempre virava pago, e qualquer status não
      // 'pending' também — o que tornava a declaração da usuária irrelevante.
      const status = payment.status === 'pending' ? 'pending' : 'completed'
      const paidAt = status === 'completed' ? new Date().toISOString() : null

      const valores = dividirEmParcelas(payment.totalAmount, parcelas)

      for (let i = 0; i < parcelas; i++) {
        const vencimento = vencimentoDaParcela(payment.firstDueDate, i)

        const { error: ppErr } = await admin.from('purchase_payments').insert({
          purchase_id:        purchase.id,
          supplier_id:        groupSupplierId,
          payment_method:     payment.method,
          amount:             valores[i],
          // ORDINAL (1, 2, 3…), não a contagem. Antes guardava o TOTAL de
          // parcelas aqui, o que tornava a coluna inútil para saber "qual
          // parcela é esta". Conferido em 03/09: 282 pagamentos no banco, o
          // campo sempre nulo — nunca foi usado, então dá para acertar sem
          // migrar nada.
          installment_number: parcelas > 1 ? i + 1 : null,
          due_date:           vencimento,
          status,
          paid_at:            paidAt,
        })
        if (ppErr) return { success: false, error: `Erro ao criar pagamento: ${ppErr.message}` }

        const desc = descricaoDaDespesa(payment.method, i + 1, parcelas, nfNum)

        const { error: txErr } = await admin.from('transactions').insert({
          store_id:         null,
          type:             'expense',
          amount:           valores[i],
          category:         'compra_fornecedor',
          description:      desc,
          reference_type:   'purchase',
          reference_id:     purchase.id,
          user_id:          userId,
          payment_method:   payment.method,
          transaction_date: data.purchaseDate,
          due_date:         vencimento,
          status,
          paid_at:          paidAt,
        })
        if (txErr) return { success: false, error: `Erro ao criar transação: ${txErr.message}` }
      }
    }
  }

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  return { success: true, purchaseId: purchase.id }
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
  const admin = createAdminClient()

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
  const { data: rawItems, error: itemsErr } = await admin
    .from('purchase_items')
    .select('id, quantity, unit_cost, subtotal, label_format, products(name, code, category, material, sale_price, suppliers(name), stores(name))')
    .eq('purchase_id', purchaseId)

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
  }))

  return {
    data: {
      ...purchase,
      items,
      payments,
    }
  }
}

// ─── Action: deletar compra ───────────────────────────────────────────────────

export async function deletarCompra(purchaseId: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  /*
   * ORDEM DA EXCLUSÃO — pensada para o "tentar de novo" não estornar duas vezes.
   *
   * Não há transação entre as escritas (PostgREST, sem RPC para isso). Antes,
   * o estoque era estornado PRIMEIRO e os erros das exclusões seguintes eram
   * ignorados: se a exclusão da compra falhasse, ela continuava na lista, a
   * dona clicava em Excluir de novo — e o estoque era estornado outra vez,
   * sumindo com peça que estava na vitrine.
   *
   * Agora:
   *   1. Tudo que é LEITURA e CONFERÊNCIA vem antes de qualquer escrita. Se
   *      algo falha aqui, nada foi tocado.
   *   2. Financeiro, pagamentos e o vínculo das peças saem primeiro. São
   *      exclusões que podem ser repetidas sem efeito colateral.
   *   3. `purchase_items` é apagado — e é ELE a fonte do estorno. Daqui em
   *      diante, um retry não encontra mais itens e não estorna de novo.
   *   4. O estorno usa a lista lida no passo 1, já em memória.
   *   5. Por último, o cabeçalho da compra.
   *
   * O pior caso passa a ser um estorno que FALTA (dito na mensagem, peça por
   * peça, para corrigir na conferência) em vez de um estorno em dobro calado.
   */

  // ── 1. Leituras e conferências ──
  const { data: compra, error: compraErr } = await admin
    .from('purchases').select('id').eq('id', purchaseId).maybeSingle()
  if (compraErr) return { success: false, error: `Não foi possível ler a compra: ${compraErr.message}` }
  if (!compra) return { success: false, error: 'Compra não encontrada — ela pode já ter sido excluída. Atualize a lista.' }

  const { data: items, error: itemsErr } = await admin
    .from('purchase_items')
    .select('product_id, quantity')
    .eq('purchase_id', purchaseId)

  // Sem os itens não há como saber o que estornar: parar ANTES de apagar.
  if (itemsErr || !items) {
    return { success: false, error: `Não foi possível ler as peças da compra: ${itemsErr?.message ?? 'sem resposta'}. Nada foi excluído.` }
  }

  // A mesma peça pode estar em duas linhas: soma antes, estorna uma vez só.
  const estornoPorPeca = new Map<string, number>()
  for (const it of items as Array<{ product_id: string | null; quantity: number }>) {
    if (!it.product_id) continue
    estornoPorPeca.set(it.product_id, (estornoPorPeca.get(it.product_id) ?? 0) + Number(it.quantity || 0))
  }
  const idsPecas = [...estornoPorPeca.keys()]

  /*
   * Peça que já vendeu não sai por exclusão de compra.
   *
   * O estorno tiraria do estoque unidades que já saíram pela venda — o saldo
   * iria a zero "à força" (o `Math.max(0, …)`), e a venda ficaria apontando
   * para uma compra que não existe mais, sem custo de origem. Nesse caso o
   * caminho é editar a compra, que respeita o que já foi vendido.
   */
  const nomesVendidos = new Set<string>()
  for (let de = 0; de < idsPecas.length; de += 150) {
    const bloco = idsPecas.slice(de, de + 150)
    const { data: vendidos, error: vendErr } = await admin
      .from('sale_items').select('product_id, products(name)').in('product_id', bloco)
    if (vendErr) return { success: false, error: `Não foi possível conferir as vendas das peças: ${vendErr.message}. Nada foi excluído.` }
    for (const v of (vendidos ?? []) as unknown as Array<{ products: { name: string } | null }>) {
      nomesVendidos.add(v.products?.name ?? 'peça sem nome')
    }
  }
  if (nomesVendidos.size > 0) {
    const lista = [...nomesVendidos]
    const exemplos = lista.slice(0, 3).join(', ') + (lista.length > 3 ? ` e mais ${lista.length - 3}` : '')
    return {
      success: false,
      error: `Esta compra não pode ser excluída: ${lista.length} ${lista.length === 1 ? 'peça dela já tem venda' : 'peças dela já têm venda'} registrada (${exemplos}). Use "Editar compra" para corrigir o que for preciso.`,
    }
  }

  // ── 2. Financeiro, pagamentos e vínculo — repetíveis sem efeito colateral ──
  const { error: txErr } = await admin.from('transactions')
    .delete().eq('reference_id', purchaseId).eq('reference_type', 'purchase')
  if (txErr) return { success: false, error: `Erro ao apagar os lançamentos financeiros: ${txErr.message}. A compra e o estoque não foram alterados.` }

  const { error: ppErr } = await admin.from('purchase_payments').delete().eq('purchase_id', purchaseId)
  if (ppErr) return { success: false, error: `Erro ao apagar os pagamentos: ${ppErr.message}. O estoque não foi alterado; tente excluir de novo.` }

  // Nullar purchase_id nos produtos antes de deletar (FK constraint)
  const { error: linkErr } = await admin.from('products').update({ purchase_id: null }).eq('purchase_id', purchaseId)
  if (linkErr) return { success: false, error: `Erro ao desligar as peças da compra: ${linkErr.message}. O estoque não foi alterado; tente excluir de novo.` }

  // ── 3. Itens — a partir daqui um retry não estorna de novo ──
  const { error: delItemsErr } = await admin.from('purchase_items').delete().eq('purchase_id', purchaseId)
  if (delItemsErr) return { success: false, error: `Erro ao apagar as peças da compra: ${delItemsErr.message}. O estoque não foi alterado; tente excluir de novo.` }

  // ── 4. Estorno do estoque, com a lista lida no passo 1 ──
  const falhasEstorno: string[] = []
  for (let de = 0; de < idsPecas.length; de += 150) {
    const bloco = idsPecas.slice(de, de + 150)
    const { data: atuais, error: lerErr } = await admin
      .from('products').select('id, name, quantity_in_stock').in('id', bloco)
    if (lerErr || !atuais) {
      for (const id of bloco) falhasEstorno.push(`${id} (−${estornoPorPeca.get(id)})`)
      continue
    }
    const porId = new Map((atuais as Array<{ id: string; name: string; quantity_in_stock: number | null }>).map(p => [p.id, p]))
    for (const id of bloco) {
      const p = porId.get(id)
      if (!p) continue // peça apagada por outro caminho: não há o que estornar
      const qtd = estornoPorPeca.get(id) ?? 0
      const { error: updErr } = await admin.from('products')
        .update({ quantity_in_stock: Math.max(0, Number(p.quantity_in_stock ?? 0) - qtd), updated_at: new Date().toISOString() })
        .eq('id', id)
      if (updErr) falhasEstorno.push(`${p.name} (−${qtd})`)
    }
  }

  // ── 5. Cabeçalho ──
  const { error } = await admin.from('purchases').delete().eq('id', purchaseId)

  revalidatePath('/compras')
  revalidatePath('/produtos')
  revalidatePath('/estoque')
  revalidatePath('/financeiro')

  if (falhasEstorno.length) {
    return {
      success: false,
      error: `A compra foi excluída, mas o estoque destas peças não foi estornado: ${falhasEstorno.join(', ')}. Ajuste pela conferência de estoque — NÃO exclua de novo.`,
    }
  }
  if (error) {
    return { success: false, error: `Peças e estoque já foram desfeitos, mas o registro da compra não saiu: ${error.message}. Clique em excluir de novo — o estoque não será mexido outra vez.` }
  }
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
    admin.from('stores').select('id, name, city').eq('is_active', true),
    admin.from('suppliers').select('id, name, initials').eq('is_active', true).order('name'),
  ])

  const hasAnySale = productIds.some(pid => (soldCounts.get(pid) ?? 0) > 0)

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
    }
  }
}

// ─── Action: salvar edição de compra ─────────────────────────────────────────

export async function editarCompra(payload: EditCompraPayload): Promise<ActionResult> {
  const { userId, error: authErr } = await verifyAdmin()
  if (authErr || !userId) return { success: false, error: authErr ?? 'Erro de auth.' }

  const admin = createAdminClient()

  /*
   * SEM TRANSAÇÃO — ENTÃO A ORDEM É A PROTEÇÃO.
   *
   * O PostgREST não dá transação entre chamadas, e criar RPC para isso é
   * mudança de schema. O que dá para fazer, e é feito aqui:
   *
   *   1. TODAS as leituras e TODAS as conferências antes da primeira escrita.
   *      Qualquer coisa errada (leitura que falhou, estoque que ficaria
   *      negativo, peça que não é desta compra) para aqui, sem tocar em nada.
   *   2. Peças: produto e depois o item da compra, um par por vez. Se o item
   *      falhar, o estoque daquele produto volta ao que era — senão o próximo
   *      "salvar" somaria o mesmo delta de novo, porque o delta é calculado
   *      contra a quantidade gravada no item.
   *   3. Pagamentos e financeiro são atualizados NO LUGAR, não apagados e
   *      recriados: uma falha no meio deixa o lançamento antigo, não um buraco.
   *   4. Cabeçalho e totais por último — são o que menos dói se ficar para trás.
   *
   * Toda escrita confere `error` e aborta com mensagem dizendo até onde foi.
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

  const novoEstoque = new Map<string, number>()
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
    novoEstoque.set(pid, novo)
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

  // ── 4. Escritas: peças ──────────────────────────────────────────────────
  const agora = new Date().toISOString()
  for (const item of payload.items) {
    const antes = estoqueAtual.get(item.productId)!.quantity_in_stock
    const { error: prodUpdErr } = await admin.from('products').update({
      name:              item.name.trim(),
      category:          item.category.trim().toLowerCase(),
      material:          item.material.trim().toLowerCase(),
      cost_price:        item.costPrice,
      sale_price:        item.salePrice,
      promotional_price: item.promoPrice ?? null,
      label_format:      item.labelFormat,
      supplier_id:       item.supplierId,
      store_id:          item.storeId,
      quantity_in_stock: novoEstoque.get(item.productId) ?? antes,
      updated_at:        agora,
    }).eq('id', item.productId)

    if (prodUpdErr) {
      return { success: false, error: `Erro ao salvar "${item.name}": ${prodUpdErr.message}. As peças anteriores a ela já foram salvas; confira e salve de novo.` }
    }

    const { error: itemUpdErr } = await admin.from('purchase_items').update({
      quantity:     item.quantity,
      unit_cost:    item.costPrice,
      subtotal:     item.costPrice * item.quantity,
      label_format: item.labelFormat,
    }).eq('id', item.purchaseItemId)

    if (itemUpdErr) {
      // Devolve o estoque: o delta é medido contra `purchase_items.quantity`,
      // que não mudou — sem isto o próximo salvar somaria o delta de novo.
      const { error: voltaErr } = await admin.from('products')
        .update({ quantity_in_stock: antes, updated_at: new Date().toISOString() })
        .eq('id', item.productId)
      return {
        success: false,
        error: voltaErr
          ? `Erro ao salvar "${item.name}": ${itemUpdErr.message}. ATENÇÃO: o estoque dela ficou em ${novoEstoque.get(item.productId)} e deveria voltar a ${antes} — corrija na conferência antes de salvar de novo.`
          : `Erro ao salvar "${item.name}": ${itemUpdErr.message}. As peças anteriores a ela já foram salvas; salve de novo.`,
      }
    }
  }

  // ── 5. Escritas: pagamentos e financeiro (só compra própria) ────────────
  if (!ehConsignacao) {
    for (const pay of payload.payments) {
      // Só o que a tela edita. `status` e `paid_at` NÃO vêm da tela: quem quita
      // é o financeiro, e reescrever aqui zerava a data do pagamento.
      const { error: ppUpdErr } = await admin.from('purchase_payments')
        .update({
          payment_method: pay.paymentMethod,
          amount:         pay.amount,
          due_date:       pay.dueDate || null,
          supplier_id:    pay.supplierId ?? null,
        })
        .eq('id', pay.id)
      if (ppUpdErr) {
        return { success: false, error: `As peças foram salvas, mas um pagamento não: ${ppUpdErr.message}. Salve de novo.` }
      }
    }

    // NF de fallback para despesa nova: só quando a compra tem UMA nota.
    const nfUnica = payload.nfNumber?.trim() && !payload.nfNumber.includes('|') ? payload.nfNumber.trim() : null

    for (const pay of payload.payments) {
      const orig   = pagamentosOriginais.get(pay.id)!
      const antiga = despesaDoPagamento.get(pay.id)

      const status = orig.status === 'pending' ? 'pending' : 'completed'
      const paidAt = status === 'completed' ? (antiga?.paid_at ?? orig.paid_at ?? agora) : null

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

      const campos = {
        amount:           pay.amount,
        payment_method:   pay.paymentMethod,
        transaction_date: payload.purchaseDate,
        due_date:         pay.dueDate || null,
        status,
        paid_at:          paidAt,
        description:      descricao,
      }

      const { error: txErr } = antiga
        ? await admin.from('transactions').update(campos).eq('id', antiga.id)
        : await admin.from('transactions').insert({
            ...campos,
            store_id:       null,
            type:           'expense',
            category:       'compra_fornecedor',
            reference_type: 'purchase',
            reference_id:   payload.purchaseId,
            user_id:        userId,
          })

      if (txErr) {
        return { success: false, error: `Peças e pagamentos foram salvos, mas o financeiro não: ${txErr.message}. Salve de novo.` }
      }
    }

    if (despesasSobrando.length) {
      const { error: delErr } = await admin.from('transactions')
        .delete().in('id', despesasSobrando.map(t => t.id))
      if (delErr) {
        return { success: false, error: `A compra foi salva, mas sobraram lançamentos antigos no financeiro: ${delErr.message}. Salve de novo.` }
      }
    }
  }

  // ── 6. Cabeçalho e totais ───────────────────────────────────────────────
  const { error: headErr } = await admin.from('purchases').update({
    purchase_date: payload.purchaseDate,
    notes:         payload.notes || null,
    nf_number:     payload.nfNumber || null,
    updated_at:    new Date().toISOString(),
  }).eq('id', payload.purchaseId)

  if (headErr) {
    revalidatePath('/compras')
    return { success: false, error: `Peças e pagamentos foram salvos, mas data/observação/NF não: ${headErr.message}. Salve de novo.` }
  }

  /*
   * Os totais saem dos ITENS GRAVADOS, não do payload da tela.
   *
   * Antes eram somados a partir de `payload.items`, o que dá o mesmo número
   * enquanto tudo dá certo — e um número errado quando não dá: se a gravação de
   * um item falhar, o total ainda contaria com ele. Lendo do banco, o total é
   * sempre o que realmente está lá.
   */
  try {
    await recalcularTotaisDaCompra([payload.purchaseId])
  } catch (e) {
    // As peças e os pagamentos já foram gravados; só o total ficou para trás.
    // Dizer isso é melhor que deixar a tela achar que deu tudo certo.
    revalidatePath('/compras')
    return { success: false, error: `A compra foi salva, mas o total não foi atualizado: ${(e as Error).message}. Salve de novo.` }
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
  const admin = createAdminClient()
  const { data, error } = await admin
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
        category
      )
    `)
    .eq('purchase_id', purchaseId)

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
