'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { formatarNomeProprio } from '@/lib/nomeProprio'
import { requireProfile, getProfile, lojaDoEscopo, ehAdmin, ehOperadora } from '@/lib/auth'
import { normalizarTelefone } from '@/lib/telefone'
import type { CustomerWithStats } from './page'

export interface ActionResult {
  success: boolean
  error?: string
  id?: string
}

export interface CustomerFormData {
  name: string
  phone: string
  cpf: string
  email: string
  birthday: string
  address: string
  city: string
  state: string
  zip_code: string
  origin_store_id: string
  notes: string
}

export interface CustomerSearchResult {
  id: string; name: string; phone: string; cpf: string | null; birthday: string | null
}

/**
 * Busca server-side (unaccent + telefone/CPF), limitada — evita carregar toda a
 * base de clientes no front. Termo vazio devolve os primeiros por nome.
 *
 * `lojaDaTela` é a loja DA VENDA, não a de quem busca. A distinção importa para
 * a Fernanda: ela é admin global, atende nas duas, e quem decide de qual base
 * ela está falando é a loja que escolheu no formulário.
 *
 * Para quem tem loja própria o parâmetro é ignorado, como em toda leitura.
 *
 * Sem isto o corte de 04/09 seria enfeite: a LISTA inicial vinha cortada, mas
 * bastava digitar três letras para a base inteira voltar.
 */
export async function searchCustomers(
  term: string,
  lojaDaTela?: string | null,
): Promise<CustomerSearchResult[]> {
  const perfil = await getProfile()
  if (!perfil) return []

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('search_customers', {
    term: term ?? '',
    lim: 20,
    p_store_id: lojaDoEscopo(perfil, lojaDaTela),
  })
  if (error) return []
  return (data ?? []).map((c: any) => ({
    id: c.id, name: c.name, phone: c.phone, cpf: c.cpf, birthday: c.birthday,
  }))
}

export async function createCustomer(data: CustomerFormData): Promise<ActionResult> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }

  /*
   * A loja de origem sai do PERFIL, não do formulário.
   *
   * Vinha como `data.origin_store_id || null`, direto do navegador: quem é de
   * Campinas cadastrava cliente em Brasília só alterando o campo. Para admin
   * global o formulário continua mandando — é ele quem escolhe.
   */
  const origem = lojaDoEscopo(perfil, data.origin_store_id)

  const admin = createAdminClient()
  const { data: created, error } = await admin.from('customers').insert({
    name:            formatarNomeProprio(data.name),
    phone:           data.phone.trim(),
    cpf:             data.cpf.trim() || null,
    email:           data.email.trim() || null,
    birthday:        data.birthday || null,
    address:         data.address.trim() || null,
    city:            data.city.trim() || null,
    state:           data.state.trim().toUpperCase() || null,
    zip_code:        data.zip_code.trim() || null,
    origin_store_id: origem,
    notes:           data.notes.trim() || null,
  }).select('id').single()

  if (error) return { success: false, error: error.message }
  revalidatePath('/clientes')
  return { success: true, id: created.id }
}

export async function updateCustomer(id: string, data: CustomerFormData): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Não autenticado.' }

  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }

  const admin = createAdminClient()

  /*
   * Editar não pode ser a porta dos fundos: sem isto, quem é de Campinas
   * abriria uma cliente de Brasília pelo id e a editaria. Mesma checagem de
   * `completarCadastroNaVenda`: quem tem escopo só alcança quem nasceu na
   * loja dele.
   */
  const escopo = lojaDoEscopo(perfil)
  const { data: cliente, error: lerErr } = await admin
    .from('customers')
    .select('id, origin_store_id')
    .eq('id', id)
    .maybeSingle()

  if (lerErr) return { success: false, error: `Não foi possível ler a cliente: ${lerErr.message}` }
  if (!cliente) return { success: false, error: 'Cliente não encontrada.' }
  if (escopo && cliente.origin_store_id !== escopo) {
    return { success: false, error: 'Esta cliente não é desta loja.' }
  }

  /*
   * A loja de origem é a história da cliente, não um campo da funcionária.
   * Antes vinha de `lojaDoEscopo(perfil, ...)`, que para a operadora é a loja
   * DELA — então editar o telefone de uma cliente MUDAVA a cliente de loja.
   * Operadora mantém a origem gravada; admin continua escolhendo pelo
   * formulário, dentro do próprio escopo.
   */
  const origem = ehOperadora(perfil)
    ? cliente.origin_store_id
    : lojaDoEscopo(perfil, data.origin_store_id)

  const { error } = await admin.from('customers').update({
    name:            formatarNomeProprio(data.name),
    phone:           data.phone.trim(),
    cpf:             data.cpf.trim() || null,
    email:           data.email.trim() || null,
    birthday:        data.birthday || null,
    address:         data.address.trim() || null,
    city:            data.city.trim() || null,
    state:           data.state.trim().toUpperCase() || null,
    zip_code:        data.zip_code.trim() || null,
    origin_store_id: origem,
    notes:           data.notes.trim() || null,
    updated_at:      new Date().toISOString(),
  }).eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/clientes')
  return { success: true }
}

/**
 * Busca uma cliente com TODOS os campos editáveis, para abrir o formulário
 * completo na hora da venda (o combobox da venda só carrega id/nome/tel/CPF/
 * aniversário). Os campos de estatística vêm zerados — o formulário não os usa.
 */
export async function buscarClienteCompleto(id: string): Promise<CustomerWithStats | null> {
  const perfil = await getProfile()
  if (!perfil || !perfil.is_active) return null

  /* Cliente é da loja (04/09). Era só "está logada?": qualquer pessoa, a
   * operadora inclusive, lia CPF e endereço de cliente da outra loja pelo id
   * (08/10/2026). */
  const escopo = lojaDoEscopo(perfil)

  const admin = createAdminClient()
  let q = admin
    .from('customers')
    .select('id, name, phone, cpf, email, birthday, address, city, state, zip_code, origin_store_id, notes, created_at, updated_at, stores:origin_store_id(name)')
    .eq('id', id)
  if (escopo) q = q.eq('origin_store_id', escopo)
  const { data, error } = await q.maybeSingle()

  if (error || !data) return null
  const d = data as Record<string, unknown> & { stores?: { name?: string } | null }
  return {
    id:                d.id as string,
    name:              d.name as string,
    phone:             (d.phone as string) ?? '',
    cpf:               (d.cpf as string | null) ?? null,
    email:             (d.email as string | null) ?? null,
    birthday:          (d.birthday as string | null) ?? null,
    address:           (d.address as string | null) ?? null,
    city:              (d.city as string | null) ?? null,
    state:             (d.state as string | null) ?? null,
    zip_code:          (d.zip_code as string | null) ?? null,
    origin_store_id:   d.origin_store_id as string,
    origin_store_name: d.stores?.name ?? '',
    notes:             (d.notes as string | null) ?? null,
    created_at:        d.created_at as string,
    updated_at:        d.updated_at as string,
    total_sales:       0,
    last_sale_date:    null,
    total_spent:       0,
  }
}

/**
 * Completa o cadastro da cliente SEM sair da venda.
 *
 * Nasceu do pedido dela em 15/09: "eu estou fazendo a venda e eu vejo que o
 * cadastro dela está incompleto, não tem data de nascimento e CPF. Não dá para
 * eu ter um botãozinho e eu clicar e já editar isso?"
 *
 * NÃO é `updateCustomer` com menos campos. `updateCustomer` recebe o formulário
 * inteiro e sobrescreve tudo — usá-lo aqui, com só dois campos preenchidos,
 * apagaria endereço, e-mail, observação e loja de origem de quem já os tinha.
 * Uma escrita estreita não tem como causar esse estrago.
 *
 * Campo vazio NÃO apaga o que existe: no balcão ela preenche o que falta, e
 * deixar em branco significa "não sei", não "apague".
 */
export async function completarCadastroNaVenda(
  id: string,
  dados: { cpf: string; birthday: string },
): Promise<ActionResult> {
  const perfil = await requireProfile()

  const admin = createAdminClient()

  /*
   * Mesma regra de escopo da edição em /clientes: a venda não pode ser a porta
   * dos fundos para mexer na cliente da outra loja. Quem tem escopo só alcança
   * quem nasceu na loja dele.
   */
  const escopo = lojaDoEscopo(perfil)
  const { data: cliente } = await admin
    .from('customers')
    .select('id, origin_store_id')
    .eq('id', id)
    .maybeSingle()

  if (!cliente) return { success: false, error: 'Cliente não encontrada.' }
  if (escopo && cliente.origin_store_id !== escopo) {
    return { success: false, error: 'Esta cliente não é desta loja.' }
  }

  const patch: Record<string, string> = { updated_at: new Date().toISOString() }
  if (dados.cpf.trim())      patch.cpf      = dados.cpf.trim()
  if (dados.birthday.trim()) patch.birthday = dados.birthday.trim()

  // Só CPF e aniversário vazios: não há o que gravar, e um UPDATE que só mexe
  // em `updated_at` mentiria dizendo que algo mudou.
  if (Object.keys(patch).length === 1) return { success: true }

  const { error } = await admin.from('customers').update(patch).eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/clientes')
  return { success: true }
}

export async function deleteCustomer(id: string): Promise<ActionResult> {
  const perfil = await getProfile()
  if (!perfil) return { success: false, error: 'Não autenticado.' }
  /*
   * Excluir cliente apaga histórico de relacionamento — decisão de gestão.
   * Antes bastava estar logada: a operadora chamava a action direto, mesmo
   * sem o botão na tela.
   */
  if (!ehAdmin(perfil)) {
    return { success: false, error: 'Apenas administradores podem excluir clientes.' }
  }

  const admin = createAdminClient()

  // Admin de loja só alcança as clientes da loja dele — a mesma régua da edição.
  const escopo = lojaDoEscopo(perfil)
  if (escopo) {
    const { data: cliente, error: lerErr } = await admin
      .from('customers')
      .select('origin_store_id')
      .eq('id', id)
      .maybeSingle()
    if (lerErr) return { success: false, error: `Não foi possível ler a cliente: ${lerErr.message}` }
    if (!cliente) return { success: false, error: 'Cliente não encontrada.' }
    if (cliente.origin_store_id !== escopo) {
      return { success: false, error: 'Esta cliente não é desta loja.' }
    }
  }

  const { error } = await admin.from('customers').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/clientes')
  return { success: true }
}

// ─── Duplicata por telefone ───────────────────────────────────────────────────

export interface ClienteComMesmoTelefone {
  id: string
  name: string
  vendas: number
}

/**
 * Quem mais já usa este telefone.
 *
 * AVISA, não bloqueia — e isso é decisão, não preguiça.
 *
 * No treinamento de 31/08 a ideia levantada foi impedir cadastro com telefone
 * repetido. Medido na base: há 8 telefones repetidos, e eles são DUAS coisas
 * diferentes.
 *
 * Quatro são a mesma pessoa cadastrada duas vezes com sobrenome diferente
 * (Lucia Campos / Lucia Avary). Os outros quatro são pessoas diferentes
 * mesmo — Maria de Lourdes e Shanti Janveja, Isabela Fernandes e Daniele
 * Fonteles. Mãe e filha dividindo telefone é comum no varejo, e um número
 * digitado errado no cadastro de outra cliente também.
 *
 * Um índice único derrubaria os dois casos legítimos junto com os errados.
 * Quem consegue distinguir é quem está atendendo — então o sistema mostra o
 * que sabe e deixa a decisão com ela.
 */
export async function clientesComMesmoTelefone(
  telefone: string,
  ignorarId?: string,
): Promise<ClienteComMesmoTelefone[]> {
  const perfil = await requireProfile()
  /* Cliente é da loja: o aviso de "telefone já cadastrado" não pode mostrar o
   * nome de quem é da outra loja (08/10/2026). */
  const escopo = lojaDoEscopo(perfil)

  const canonico = normalizarTelefone(telefone)
  // Menos que isso não é telefone ainda — evita consultar a cada tecla.
  if (canonico.replace(/\D/g, '').length < 12) return []

  const admin = createAdminClient()
  /*
   * Erro não LANÇA de propósito: é só um aviso, e a tela de venda chama isto
   * sem `.catch` — lançar viraria promise rejeitada solta no meio do PDV. Mas
   * também não passa calado: lista vazia aqui quer dizer "não deu para
   * conferir", e o log do servidor é quem registra isso.
   */
  let qClientes = admin
    .from('customers')
    .select('id, name')
    .eq('phone', canonico)
  if (escopo) qClientes = qClientes.eq('origin_store_id', escopo)
  const { data, error } = await qClientes
  if (error) {
    console.error('clientesComMesmoTelefone: falha ao ler clientes:', error.message)
    return []
  }

  const achados = (data ?? []).filter(c => c.id !== ignorarId)
  if (achados.length === 0) return []

  /*
   * A contagem de vendas é o que ajuda a decidir: entre dois cadastros do
   * mesmo telefone, o que tem histórico é o que deve sobreviver.
   */
  const { data: vendas, error: vendasErr } = await admin
    .from('sales')
    .select('customer_id')
    .in('customer_id', achados.map(c => c.id))
  // Sem a contagem o aviso ainda vale (o telefone repetido é o que importa);
  // só não dá para dizer quantas vendas cada um tem.
  if (vendasErr) console.error('clientesComMesmoTelefone: falha ao contar vendas:', vendasErr.message)

  const porCliente = new Map<string, number>()
  for (const v of vendas ?? []) {
    const k = v.customer_id as string
    porCliente.set(k, (porCliente.get(k) ?? 0) + 1)
  }

  return achados.map(c => ({
    id: c.id as string,
    name: c.name as string,
    vendas: porCliente.get(c.id as string) ?? 0,
  }))
}

/** Uma compra da cliente, como o detalhe em /clientes mostra. */
export interface CompraDaCliente {
  id: string
  sale_date: string
  total: number
  subtotal: number
  total_cost: number
  discount_type: string | null
  discount_amount: number
  discount_pct: number | null
  payment_summary: string | null
  status: string
  store_name: string
  items: Array<{
    id: string
    quantity: number
    unit_price: number
    unit_cost: number
    subtotal: number
    product_name: string
    product_code: string
    product_category: string
  }>
}

/**
 * As últimas compras da cliente, só da loja da sessão.
 *
 * Era uma consulta do NAVEGADOR (RLS com `fv.is_admin()`, que deixa todo admin
 * ver tudo) filtrando só por `customer_id`: a Eleandra e a Fernanda "em
 * Brasília" viam as compras de Campinas, com custo (08/10/2026). Aqui o corte é
 * `lojaDoEscopo`, e custo só sai para admin.
 */
export async function buscarComprasDaCliente(customerId: string): Promise<CompraDaCliente[]> {
  const perfil = await requireProfile()
  if (!ehAdmin(perfil)) throw new Error('Sem permissão para esta informação.')
  const escopo = lojaDoEscopo(perfil)

  const admin = createAdminClient()
  let q = admin
    .from('sales')
    .select(`
      id, sale_date, total, subtotal, total_cost, discount_type, discount_amount, discount_pct,
      payment_summary, status,
      stores(name),
      sale_items(
        id, quantity, unit_price, unit_cost, subtotal,
        products(name, code, category)
      )
    `)
    .eq('customer_id', customerId)
  if (escopo) q = q.eq('store_id', escopo)
  const { data, error } = await q.order('sale_date', { ascending: false }).limit(15)
  if (error) throw new Error(`Não foi possível carregar as compras: ${error.message}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((s: any) => ({
    id:              s.id,
    sale_date:       s.sale_date,
    total:           Number(s.total),
    subtotal:        Number(s.subtotal),
    total_cost:      Number(s.total_cost ?? 0),
    discount_type:   s.discount_type,
    discount_amount: Number(s.discount_amount ?? 0),
    discount_pct:    s.discount_pct ? Number(s.discount_pct) : null,
    payment_summary: s.payment_summary,
    status:          s.status,
    store_name:      s.stores?.name ?? '—',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (s.sale_items ?? []).map((item: any) => ({
      id:               item.id,
      quantity:         item.quantity,
      unit_price:       Number(item.unit_price),
      unit_cost:        Number(item.unit_cost ?? 0),
      subtotal:         Number(item.subtotal),
      product_name:     item.products?.name ?? '—',
      product_code:     item.products?.code ?? '—',
      product_category: item.products?.category ?? '—',
    })),
  }))
}
