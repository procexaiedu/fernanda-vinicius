'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getProfile, podeConfigurarRede, ehAdmin, lojaDoEscopo } from '@/lib/auth'
import { normalizarNomeFornecedor } from '@/lib/nomeFornecedor'
import { formatarNomeProprio } from '@/lib/nomeProprio'

export interface ActionResult {
  success: boolean
  error?: string
}

export interface SupplierPhone {
  number: string
  is_whatsapp: boolean
}

export interface SupplierFormData {
  name: string
  initials: string
  contact_name: string
  phones: SupplierPhone[]
  instagram: string
  email: string
  cnpj: string
  accepts_consignment: boolean
  address: string
  neighborhood: string
  city: string
  state: string
  zip_code: string
  notes: string
}

async function verifyAdmin(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') return { error: 'Acesso negado.' }
  return { error: null }
}

export async function createSupplier(data: SupplierFormData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers').insert({
    name:                formatarNomeProprio(data.name),
    initials:            data.initials.trim().toUpperCase(),
    contact_name:        formatarNomeProprio(data.contact_name) || null,
    phones:              data.phones.filter(p => p.number.trim()),
    instagram:           data.instagram.trim() || null,
    email:               data.email.trim() || null,
    cnpj:                data.cnpj.trim() || null,
    accepts_consignment: data.accepts_consignment,
    address:             data.address.trim() || null,
    neighborhood:        data.neighborhood.trim() || null,
    city:                data.city.trim() || null,
    state:               data.state.trim().toUpperCase() || null,
    zip_code:            data.zip_code.trim() || null,
    notes:               data.notes.trim() || null,
  })

  if (error) return { success: false, error: error.message }
  revalidatePath('/configuracoes/fornecedores')
  return { success: true }
}

export async function updateSupplier(id: string, data: SupplierFormData): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers').update({
    name:                formatarNomeProprio(data.name),
    initials:            data.initials.trim().toUpperCase(),
    contact_name:        formatarNomeProprio(data.contact_name) || null,
    phones:              data.phones.filter(p => p.number.trim()),
    instagram:           data.instagram.trim() || null,
    email:               data.email.trim() || null,
    cnpj:                data.cnpj.trim() || null,
    accepts_consignment: data.accepts_consignment,
    address:             data.address.trim() || null,
    neighborhood:        data.neighborhood.trim() || null,
    city:                data.city.trim() || null,
    state:               data.state.trim().toUpperCase() || null,
    zip_code:            data.zip_code.trim() || null,
    notes:               data.notes.trim() || null,
    updated_at:          new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/configuracoes/fornecedores')
  return { success: true }
}

export async function deletarFornecedor(id: string): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()

  /*
   * Checa ANTES de escrever qualquer coisa.
   *
   * Antes a ordem era: tirar o fornecedor de todas as peças (sem olhar o erro)
   * e só então tentar o delete — que falha pela FK quando há compra, pagamento
   * ou consignação. Resultado: o fornecedor continuava lá e as peças dele
   * ficavam sem fornecedor, com o código e o relatório por fornecedor quebrados.
   *
   * Fornecedor com histórico financeiro não se exclui: se inativa (o botão já
   * existe na lista), que é reversível e mantém as compras rastreáveis.
   */
  const vinculos = [
    ['purchases',         'compras lançadas'],
    ['purchase_payments', 'pagamentos de compra'],
    ['consignments',      'consignações'],
  ] as const
  for (const [tabela, rotulo] of vinculos) {
    const { count, error } = await admin
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('supplier_id', id)
    if (error) {
      return { success: false, error: `Não foi possível conferir ${rotulo} do fornecedor: ${error.message}. Nada foi excluído.` }
    }
    if ((count ?? 0) > 0) {
      return {
        success: false,
        error: `Este fornecedor tem ${rotulo} (${count}) — inative em vez de excluir, para não perder o histórico.`,
      }
    }
  }

  // Desvincula as peças (supplier_id é nullable). Guarda quais eram para
  // devolver o vínculo se o delete ainda assim falhar.
  const { data: desvinculadas, error: erroDesvincular } = await admin
    .from('products')
    .update({ supplier_id: null })
    .eq('supplier_id', id)
    .select('id')
  if (erroDesvincular) {
    return { success: false, error: `Não foi possível desvincular as peças: ${erroDesvincular.message}. Nada foi excluído.` }
  }

  const { error } = await admin.from('suppliers').delete().eq('id', id)
  if (error) {
    /*
     * Alguma referência que a checagem não cobre segurou o delete. Devolve o
     * fornecedor às peças em vez de deixá-las órfãs. Em blocos: `.in()` vai na
     * URL e estoura a partir de ~500 ids.
     */
    const ids = (desvinculadas ?? []).map(p => p.id as string)
    for (let de = 0; de < ids.length; de += 150) {
      const { error: erroVolta } = await admin
        .from('products')
        .update({ supplier_id: id })
        .in('id', ids.slice(de, de + 150))
      if (erroVolta) {
        return {
          success: false,
          error: `O fornecedor não pôde ser excluído (${error.message}) e parte das peças ficou sem fornecedor: `
               + `${erroVolta.message}. Avise o suporte.`,
        }
      }
    }
    return { success: false, error: `Não foi possível excluir o fornecedor: ${error.message}. Considere inativá-lo.` }
  }

  revalidatePath('/fornecedores')
  return { success: true }
}

export async function toggleSupplierStatus(id: string, isActive: boolean): Promise<ActionResult> {
  const { error: authErr } = await verifyAdmin()
  if (authErr) return { success: false, error: authErr }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/configuracoes/fornecedores')
  return { success: true }
}

// ─── Mesclagem de fornecedores duplicados ────────────────────────────────────

export interface FornecedorDuplicado {
  nomeNormalizado: string
  cadastros: Array<{
    id: string
    name: string
    initials: string
    is_active: boolean
    created_at: string
    produtos: number
    compras: number
    consignacoes: number
  }>
}

/**
 * Acha o MESMO fornecedor cadastrado mais de uma vez.
 *
 * Compara por nome normalizado (sem acento, sem caixa, sem pontuação e sem espaço
 * duplicado). Não compara por iniciais de propósito: duas empresas diferentes
 * podem legitimamente ter as mesmas iniciais, e a Fernanda já disse que isso não
 * atrapalha o trabalho dela.
 */
export async function buscarFornecedoresDuplicados(): Promise<FornecedorDuplicado[]> {
  /*
   * Só admin global.
   *
   * As contagens aqui são propositalmente da REDE INTEIRA — é assim que se
   * decide qual cadastro duplicado fica (o que tem mais peça e mais compra
   * atrás). Filtrar por loja daria a resposta errada e mesclaria o fornecedor
   * errado; não filtrar mostraria os números de Campinas à admin de Brasília.
   *
   * Mesclar fornecedor é manutenção da rede, então a saída é fechar a porta em
   * vez de escolher entre duas respostas ruins.
   */
  const perfil = await getProfile()
  if (!perfil || !podeConfigurarRede(perfil)) return []

  const admin = createAdminClient()

  /*
   * Lê TUDO, em blocos de 1000. Sem paginar, `products` passa do teto do
   * PostgREST (5.000 no self-hosted) e o lote volta curto SEM erro — a contagem
   * de peças sai menor e a tela sugere manter o cadastro errado. Erro lança:
   * uma contagem zerada por falha de rede é pior que nenhuma contagem.
   */
  const BLOCO = 1000
  async function lerTudo<T>(
    rotulo: string,
    pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<T[]> {
    const tudo: T[] = []
    for (let de = 0; ; de += BLOCO) {
      const { data, error } = await pagina(de, de + BLOCO - 1)
      if (error) throw new Error(`Não foi possível ler ${rotulo}: ${error.message}`)
      const lote = data ?? []
      tudo.push(...lote)
      if (lote.length < BLOCO) return tudo
    }
  }

  type Ref = { supplier_id: string | null }
  // `order('id')` dá ordem estável entre as páginas; sem ela o range pode repetir ou pular linha.
  const [fornecedores, produtos, compras, consignacoes] = await Promise.all([
    lerTudo<{ id: string; name: string; initials: string; is_active: boolean; created_at: string }>(
      'os fornecedores',
      (de, ate) => admin.from('suppliers').select('id, name, initials, is_active, created_at')
        .order('created_at').order('id').range(de, ate),
    ),
    lerTudo<Ref>('as peças', (de, ate) => admin.from('products').select('supplier_id').order('id').range(de, ate)),
    lerTudo<Ref>('as compras', (de, ate) => admin.from('purchases').select('supplier_id').order('id').range(de, ate)),
    lerTudo<Ref>('as consignações', (de, ate) => admin.from('consignments').select('supplier_id').order('id').range(de, ate)),
  ])

  const conta = (linhas: Ref[]) => {
    const m = new Map<string, number>()
    for (const l of linhas) {
      if (l.supplier_id) m.set(l.supplier_id, (m.get(l.supplier_id) ?? 0) + 1)
    }
    return m
  }
  const nProd = conta(produtos), nComp = conta(compras), nCons = conta(consignacoes)

  const grupos = new Map<string, FornecedorDuplicado['cadastros']>()
  for (const f of fornecedores) {
    const chave = normalizarNomeFornecedor(f.name)
    if (!chave) continue
    const lista = grupos.get(chave) ?? []
    lista.push({
      id: f.id,
      name: f.name,
      initials: f.initials,
      is_active: f.is_active,
      created_at: f.created_at,
      produtos: nProd.get(f.id) ?? 0,
      compras: nComp.get(f.id) ?? 0,
      consignacoes: nCons.get(f.id) ?? 0,
    })
    grupos.set(chave, lista)
  }

  return [...grupos.entries()]
    .filter(([, lista]) => lista.length > 1)
    // O que tem mais coisa presa aparece primeiro — é o que mais distorce os totais.
    .map(([nomeNormalizado, cadastros]) => ({ nomeNormalizado, cadastros }))
    .sort((a, b) => {
      const peso = (d: FornecedorDuplicado) => d.cadastros.reduce((s, c) => s + c.produtos + c.compras, 0)
      return peso(b) - peso(a)
    })
}


/**
 * Move tudo de `idsAbsorvidos` para `idPrincipal` e inativa os absorvidos.
 *
 * São QUATRO tabelas apontando para fornecedor — products, purchases,
 * purchase_payments e consignments. Esquecer uma deixa registro órfão apontando
 * para um cadastro inativo, que é pior que o duplicado original.
 *
 * Os cadastros absorvidos são INATIVADOS, não apagados: `products.supplier_id` é
 * NOT NULL e o histórico de compra precisa continuar rastreável. Inativar também
 * é reversível, apagar não.
 *
 * Não é transacional — o PostgREST não expõe transação. A ordem é deliberada: as
 * referências mudam ANTES da inativação, então uma falha no meio deixa o cadastro
 * antigo ativo e ainda visível, em vez de sumir com dado pendurado nele.
 */
export async function mesclarFornecedores(
  idPrincipal: string,
  idsAbsorvidos: string[],
): Promise<ActionResult & { movidos?: { produtos: number; compras: number; pagamentos: number; consignacoes: number } }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()

  /*
   * MESCLAR FORNECEDOR É DA REDE, como a busca de duplicados já era desde
   * 04/09 — os dois lados da mesma operação precisam da mesma trava.
   *
   * `suppliers` não tem loja: as duas compram dos mesmos de São Paulo. Mesclar
   * dois cadastros reescreve peças e compras das DUAS lojas de uma vez, então
   * a admin de Brasília estaria mexendo no histórico de Campinas.
   */
  const perfil = await getProfile()
  if (!perfil || !podeConfigurarRede(perfil)) {
    return { success: false, error: 'Só a administradora geral mescla fornecedores.' }
  }

  const absorvidos = idsAbsorvidos.filter(id => id && id !== idPrincipal)
  if (!absorvidos.length) return { success: false, error: 'Nenhum cadastro para mesclar.' }

  const { data: principal } = await admin.from('suppliers').select('id').eq('id', idPrincipal).single()
  if (!principal) return { success: false, error: 'Fornecedor principal não encontrado.' }

  const movidos = { produtos: 0, compras: 0, pagamentos: 0, consignacoes: 0 }

  for (const [tabela, chave] of [
    ['products', 'produtos'],
    ['purchases', 'compras'],
    ['purchase_payments', 'pagamentos'],
    ['consignments', 'consignacoes'],
  ] as const) {
    const { data, error } = await admin
      .from(tabela)
      .update({ supplier_id: idPrincipal })
      .in('supplier_id', absorvidos)
      .select('id')
    if (error) return { success: false, error: `Falha ao mover ${chave}: ${error.message}` }
    movidos[chave] = data?.length ?? 0
  }

  const { error: erroInativar } = await admin
    .from('suppliers')
    .update({ is_active: false })
    .in('id', absorvidos)
  if (erroInativar) {
    return { success: false, error: `Dados movidos, mas falhou ao inativar os cadastros antigos: ${erroInativar.message}` }
  }

  revalidatePath('/fornecedores')
  revalidatePath('/produtos')
  revalidatePath('/compras')
  return { success: true, movidos }
}

// ─── Detalhe do fornecedor, com os números da loja da sessão ─────────────────

export interface FornecedorProduto {
  id: string; code: string; name: string; category: string
  store_id: string; store_name: string; sale_price: number
  quantity_in_stock: number; ownership_type: string; is_active: boolean
}
export interface FornecedorCompra {
  id: string; purchase_date: string; total_cost: number; total_items: number
  payment_summary: string | null; nf_number: string | null
  notes: string | null; store_name: string
}
export interface FornecedorPendencia {
  id: string; purchase_id: string; amount: number
  due_date: string | null; installment_number: number | null; payment_method: string
}
export interface DadosDoFornecedor {
  products:        FornecedorProduto[]
  totalProducts:   number
  consignedCount:  number
  totalInvested:   number
  pendingAmount:   number
  purchases:       FornecedorCompra[]
  pendingPayments: FornecedorPendencia[]
}

/**
 * Peças, compras e pendências do fornecedor — da LOJA DA SESSÃO.
 *
 * O fornecedor é da rede; os números dele, não (mesma regra de
 * fornecedores/page.tsx). Era uma consulta do NAVEGADOR filtrando só por
 * fornecedor: a lista já vinha cortada e o detalhe mostrava o total investido
 * e o pendente das duas lojas (08/10/2026).
 *
 * A compra entra pela loja das PEÇAS (`compra_rateio_loja`); numa compra que
 * leva peça para as duas, valor e pendência entram pela fatia desta loja.
 */
export async function buscarDadosDoFornecedor(supplierId: string): Promise<DadosDoFornecedor> {
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active || !ehAdmin(perfil)) throw new Error('Sem permissão para esta informação.')
  const loja = lojaDoEscopo(perfil)
  const admin = createAdminClient()

  const produtos = () => {
    let q = admin.from('products')
      .select('id, code, name, category, store_id, sale_price, quantity_in_stock, ownership_type, is_active, stores(name)')
      .eq('supplier_id', supplierId).eq('is_active', true)
    if (loja) q = q.eq('store_id', loja)
    return q.order('created_at', { ascending: false }).limit(20)
  }
  const contar = (soConsignado: boolean) => {
    let q = admin.from('products').select('id', { count: 'exact', head: true })
      .eq('supplier_id', supplierId).eq('is_active', true)
    if (soConsignado) q = q.eq('ownership_type', 'consignment')
    if (loja) q = q.eq('store_id', loja)
    return q
  }

  const [productsRes, totalRes, consignedRes, purchasesRes] = await Promise.all([
    produtos(), contar(false), contar(true),
    admin.from('purchases')
      .select('id, purchase_date, total_cost, total_items, payment_summary, nf_number, notes, stores(name)')
      .eq('supplier_id', supplierId)
      .order('purchase_date', { ascending: false }),
  ])
  for (const [rotulo, r] of [['as peças', productsRes], ['a contagem', totalRes], ['a contagem', consignedRes], ['as compras', purchasesRes]] as const) {
    if (r.error) throw new Error(`Não foi possível carregar ${rotulo} do fornecedor: ${r.error.message}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let compras = (purchasesRes.data ?? []) as any[]
  const fatia = new Map<string, number>()
  const pecasDaLoja = new Map<string, number>()
  if (loja && compras.length > 0) {
    const ids = compras.map(c => c.id as string)
    const { data: rateio, error } = await admin.from('compra_rateio_loja')
      .select('purchase_id, proporcao').eq('store_id', loja).in('purchase_id', ids)
    if (error || !rateio) throw new Error(`Não foi possível conferir a loja das compras: ${error?.message ?? 'sem resposta'}`)
    for (const r of rateio) fatia.set(r.purchase_id as string, r.proporcao == null ? 1 : Number(r.proporcao))
    compras = compras.filter(c => fatia.has(c.id))

    const mistas = compras.filter(c => (fatia.get(c.id) ?? 1) < 0.9999).map(c => c.id as string)
    if (mistas.length > 0) {
      const { data: itens, error: itErr } = await admin.from('purchase_items')
        .select('purchase_id, quantity, products!inner(store_id)')
        .in('purchase_id', mistas).eq('products.store_id', loja)
      if (itErr || !itens) throw new Error(`Não foi possível contar as peças da loja: ${itErr?.message ?? 'sem resposta'}`)
      for (const it of itens as Array<{ purchase_id: string; quantity: number }>) {
        pecasDaLoja.set(it.purchase_id, (pecasDaLoja.get(it.purchase_id) ?? 0) + Number(it.quantity))
      }
    }
  }
  const fatiaDe = (id: string) => fatia.get(id) ?? 1
  const mista = (id: string) => loja != null && fatiaDe(id) < 0.9999

  const purchases: FornecedorCompra[] = compras.map(c => ({
    id: c.id, purchase_date: c.purchase_date,
    total_cost: mista(c.id) ? Math.round(Number(c.total_cost) * fatiaDe(c.id) * 100) / 100 : Number(c.total_cost),
    total_items: mista(c.id) ? (pecasDaLoja.get(c.id) ?? 0) : Number(c.total_items),
    payment_summary: c.payment_summary ?? null,
    nf_number: c.nf_number ?? null, notes: c.notes ?? null,
    store_name: c.stores?.name ?? '—',
  }))

  let pendingPayments: FornecedorPendencia[] = []
  if (purchases.length > 0) {
    const { data: pp, error } = await admin.from('purchase_payments')
      .select('id, purchase_id, amount, due_date, installment_number, payment_method')
      .eq('status', 'pending').in('purchase_id', purchases.map(p => p.id))
      .order('due_date', { ascending: true })
    if (error || !pp) throw new Error(`Não foi possível carregar as pendências: ${error?.message ?? 'sem resposta'}`)
    pendingPayments = pp.map(x => ({
      id: x.id as string, purchase_id: x.purchase_id as string,
      amount: mista(x.purchase_id as string)
        ? Math.round(Number(x.amount) * fatiaDe(x.purchase_id as string) * 100) / 100
        : Number(x.amount),
      due_date: (x.due_date as string | null) ?? null,
      installment_number: (x.installment_number as number | null) ?? null,
      payment_method: x.payment_method as string,
    }))
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: (productsRes.data ?? []).map((p: any) => ({
      id: p.id, code: p.code, name: p.name, category: p.category, store_id: p.store_id,
      store_name: p.stores?.name ?? '—',
      sale_price: Number(p.sale_price), quantity_in_stock: Number(p.quantity_in_stock),
      ownership_type: p.ownership_type, is_active: p.is_active,
    })),
    totalProducts:  totalRes.count ?? 0,
    consignedCount: consignedRes.count ?? 0,
    totalInvested:  purchases.reduce((s, p) => s + p.total_cost, 0),
    pendingAmount:  pendingPayments.reduce((s, p) => s + p.amount, 0),
    purchases,
    pendingPayments,
  }
}
