import { redirect } from 'next/navigation'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import ComprasClient from './ComprasClient'
import PageHeader from '@/components/ui/PageHeader'

export default async function ComprasPage() {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/')

  const admin = createAdminClient()

  const escopo = lojaDoEscopo(profile)

  /*
   * A compra pertence à loja pelas PEÇAS, não pelo cabeçalho.
   *
   * `purchases.store_id` é nulo em todas as 16 compras do banco, de propósito:
   * a ida a São Paulo abastece as duas lojas de uma vez. Filtrar por ele
   * esconderia TODAS as compras da Eleandra em vez de mostrar as dela.
   *
   * `fv.compra_rateio_loja` responde quais compras têm peça daquela loja — a
   * mesma view que faz a despesa aparecer por loja no painel.
   */
  let rateioDaLoja: Array<{ purchase_id: string; proporcao: number | null }> | null = null
  if (escopo) {
    const { data, error } = await admin.from('compra_rateio_loja').select('purchase_id, proporcao').eq('store_id', escopo)
    if (error || !data) throw new Error(`Não foi possível carregar as compras da loja: ${error?.message ?? 'sem resposta'}`)
    rateioDaLoja = data as Array<{ purchase_id: string; proporcao: number | null }>
  }
  const idsDaLoja = rateioDaLoja ? rateioDaLoja.map(r => r.purchase_id) : null
  /* Fatia da loja em cada compra: 1 na compra só dela, menos de 1 na que leva
   * peça para as duas. O total da lista é o desta loja, não o da compra inteira
   * (08/10/2026). */
  const fatiaDaLoja = new Map((rateioDaLoja ?? []).map(r => [r.purchase_id, r.proporcao == null ? 1 : Number(r.proporcao)]))

  const carregarCompras = () => {
    let q = admin.from('purchases')
      .select('id, purchase_date, total_cost, total_items, nf_number, nf_url, notes, created_at, consignment_id')
    if (idsDaLoja) q = q.in('id', idsDaLoja)
    return q.order('purchase_date', { ascending: false })
  }

  const carregarLojas = () => {
    let q = admin.from('stores').select('id, name, city')
    if (escopo) q = q.eq('id', escopo)
    return q
  }

  const [purchasesRes, paymentsRes, consignmentsRes, storesRes] = await Promise.all([
    carregarCompras(),
    (() => {
      let q = admin.from('purchase_payments').select('purchase_id, status, amount')
      if (idsDaLoja) q = q.in('purchase_id', idsDaLoja)
      return q
    })(),
    /*
     * Todos os lotes, sem o filtro de loja: o status do lote (ativo/acertado)
     * é o que diz se a COMPRA ligada a ele é uma "consignação ativa", e a
     * compra entra na loja pelas peças (rateio), não pela loja do lote. O
     * escopo da loja é aplicado abaixo, só nos lotes antigos sem compra.
     */
    admin.from('consignments')
      .select('id, received_date, return_deadline, total_pieces, total_cost_value, status, supplier_id, store_id')
      .order('received_date', { ascending: false }),
    carregarLojas(),
  ])

  const purchases    = purchasesRes.data ?? []
  const payments     = paymentsRes.data ?? []
  const consignments = consignmentsRes.data ?? []
  const stores       = storesRes.data ?? []

  // Fornecedores e lojas via products.purchase_id (FK direta, sem join aninhado)
  const productsForPurchases = purchases.length > 0
    ? (await admin
        .from('products')
        .select('purchase_id, suppliers!supplier_id(name, initials), stores!store_id(name)')
        .in('purchase_id', purchases.map(p => p.id))
        .not('purchase_id', 'is', null)
        .match(escopo ? { store_id: escopo } : {})).data ?? []
    : []

  /* Peças desta loja nas compras que levam peça para as duas. */
  const mistas = escopo ? purchases.filter(p => (fatiaDaLoja.get(p.id) ?? 1) < 0.9999).map(p => p.id) : []
  const pecasDaLoja = new Map<string, number>()
  if (escopo && mistas.length > 0) {
    const { data, error } = await admin.from('purchase_items')
      .select('purchase_id, quantity, products!inner(store_id)')
      .in('purchase_id', mistas)
      .eq('products.store_id', escopo)
    if (error || !data) throw new Error(`Não foi possível contar as peças da loja: ${error?.message ?? 'sem resposta'}`)
    for (const it of data as Array<{ purchase_id: string; quantity: number }>) {
      pecasDaLoja.set(it.purchase_id, (pecasDaLoja.get(it.purchase_id) ?? 0) + Number(it.quantity))
    }
  }

  type ProductRow = {
    purchase_id: string
    suppliers: { name: string; initials: string } | null
    stores: { name: string } | null
  }

  const suppliersByPurchase   = new Map<string, Set<string>>()
  const initialssByPurchase   = new Map<string, Set<string>>()
  const storesByPurchase      = new Map<string, Set<string>>()

  for (const row of productsForPurchases as unknown as ProductRow[]) {
    const pid = row.purchase_id
    if (!suppliersByPurchase.has(pid))  suppliersByPurchase.set(pid, new Set())
    if (!initialssByPurchase.has(pid))  initialssByPurchase.set(pid, new Set())
    if (!storesByPurchase.has(pid))     storesByPurchase.set(pid, new Set())
    if (row.suppliers?.name)     suppliersByPurchase.get(pid)!.add(row.suppliers.name)
    if (row.suppliers?.initials) initialssByPurchase.get(pid)!.add(row.suppliers.initials)
    if (row.stores?.name)        storesByPurchase.get(pid)!.add(row.stores.name)
  }

  const paymentsByPurchase = new Map<string, typeof payments>()
  for (const pay of payments) {
    if (!paymentsByPurchase.has(pay.purchase_id)) paymentsByPurchase.set(pay.purchase_id, [])
    paymentsByPurchase.get(pay.purchase_id)!.push(pay)
  }

  const statusDoLote = new Map(consignments.map(c => [c.id as string, c.status as string]))

  const purchasesWithMeta = purchases.map(p => ({
    ...p,
    ...(escopo && (fatiaDaLoja.get(p.id) ?? 1) < 0.9999 ? {
      total_cost:  Math.round(Number(p.total_cost) * (fatiaDaLoja.get(p.id) ?? 1) * 100) / 100,
      total_items: pecasDaLoja.get(p.id) ?? 0,
    } : {}),
    /* Status do lote quando a compra é uma consignação (desde 07/09 todo lote
       vira compra); é ele que alimenta o filtro e o card de consignações. */
    consignmentStatus: (p.consignment_id ? statusDoLote.get(p.consignment_id) ?? null : null) as
      'active' | 'settled' | 'returned' | null,
    suppliers:         [...(suppliersByPurchase.get(p.id) ?? [])],
    supplierInitials:  [...(initialssByPurchase.get(p.id) ?? [])],
    storeNames:        [...(storesByPurchase.get(p.id) ?? [])],
    paymentStatus: (paymentsByPurchase.has(p.id)
      ? paymentsByPurchase.get(p.id)!.every(x => x.status === 'completed') ? 'paid' : 'pending'
      : 'pending') as 'paid' | 'pending',
    type: 'purchase' as const,
  }))

  const storeMap = new Map(stores.map(s => [s.id, s.name]))

  /*
   * Lote que já virou compra sai daqui — senão aparece duas vezes na lista.
   *
   * A partir de 07/09 a consignação cria uma `purchase` junto, e é ela que
   * carrega detalhe, edição e etiqueta. Sobram nesta lista só os lotes antigos,
   * criados antes da mudança, que não têm compra atrás.
   */
  const lotesJaNaLista = new Set(
    purchases.map((p: any) => p.consignment_id).filter(Boolean) as string[]
  )

  const consignmentsWithMeta = consignments
    .filter(c => !lotesJaNaLista.has(c.id))
    .filter(c => !escopo || c.store_id === escopo)
    .map(c => ({
      ...c,
      storeName: storeMap.get(c.store_id ?? '') ?? '—',
      type: 'consignment' as const,
    }))

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Registro de entradas de estoque — compras próprias e consignações."
      />
      <ComprasClient purchases={purchasesWithMeta} consignments={consignmentsWithMeta} />
    </div>
  )
}
