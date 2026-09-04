'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getProfile, podeConfigurarRede } from '@/lib/auth'
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

  // Desvincula produtos (nulla supplier_id) antes de deletar
  await admin.from('products').update({ supplier_id: null }).eq('supplier_id', id)

  const { error } = await admin.from('suppliers').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

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

  const [fornRes, prodRes, compRes, consRes] = await Promise.all([
    admin.from('suppliers').select('id, name, initials, is_active, created_at').order('created_at'),
    admin.from('products').select('supplier_id'),
    admin.from('purchases').select('supplier_id'),
    admin.from('consignments').select('supplier_id'),
  ])

  const conta = (linhas: Array<{ supplier_id: string | null }> | null) => {
    const m = new Map<string, number>()
    for (const l of linhas ?? []) {
      if (l.supplier_id) m.set(l.supplier_id, (m.get(l.supplier_id) ?? 0) + 1)
    }
    return m
  }
  const nProd = conta(prodRes.data), nComp = conta(compRes.data), nCons = conta(consRes.data)

  const grupos = new Map<string, FornecedorDuplicado['cadastros']>()
  for (const f of fornRes.data ?? []) {
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

  const { data: perfil } = await admin.from('users').select('role').eq('id', user.id).single()
  if (perfil?.role !== 'admin') return { success: false, error: 'Apenas administrador pode mesclar fornecedores.' }

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
