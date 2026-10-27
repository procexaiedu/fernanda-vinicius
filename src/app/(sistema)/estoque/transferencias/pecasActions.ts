'use server'

import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { EtiquetasPrinterItem } from '@/components/etiquetas/EtiquetasPrinter'

export interface PecaRomaneio {
  id: string
  nome: string
  nomeHistorico: string
  productId: string | null
  storeId: string | null
  bloqueioNome: string | null
  etiqueta: string
  foto: string | null
  precoRomaneio: number | null
  precoVenda: number
  precoPromocional: number | null
  promocaoAtiva: boolean
  precoEtiqueta: number | null
  bloqueio: string | null
  versao: Record<string, unknown> | null
}

const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** Toda consulta confere perfil/loja novamente, inclusive reimpressão. */
async function ler(transferId: string) {
  const perfil = await requireProfile()
  if (!uuid(transferId)) throw new Error('Romaneio inválido.')
  const db = createAdminClient()
  const { data: t, error } = await db.from('transfers')
    .select('id, from_store_id, to_store_id, status, kind, purchase_id, updated_at, transfer_items(id, product_id, dest_product_id, product_name, barcode_number, quantity_sent, unit_sale_price)')
    .eq('id', transferId).single()
  if (error || !t) throw new Error('Não foi possível consultar o romaneio. Tente novamente.')
  const loja = lojaDoEscopo(perfil)
  if ((!loja && perfil.role !== 'admin') || (loja && loja !== t.to_store_id && loja !== t.from_store_id)) {
    throw new Error('Romaneio fora da sua loja.')
  }
  const ids = [...new Set(t.transfer_items.flatMap(i => [i.dest_product_id ?? i.product_id]).filter(Boolean))]
  const { data: produtos, error: erroProdutos } = await db.from('products')
    .select('id, store_id, name, photo_url, code, barcode_number, sale_price, promotional_price, promotional_active, updated_at, category, label_format')
    .in('id', ids)
  if (erroProdutos) throw new Error('Não foi possível consultar as peças. Tente novamente.')
  return { perfil, loja, t, db, produtos: produtos ?? [] }
}

export async function consultarPecasRomaneio(transferId: string): Promise<PecaRomaneio[]> {
  const { perfil, loja, t, produtos } = await ler(transferId)
  return t.transfer_items.filter(i => i.quantity_sent > 0).map(i => {
    const p = produtos.find(p => p.id === (i.dest_product_id ?? i.product_id))
    const promo = !!p?.promotional_active && Number(p.promotional_price) > 0
    const bloqueio = perfil.role !== 'admin' ? 'Somente administradores podem corrigir preços.'
      : t.kind !== 'lote_fornecedor' || t.status !== 'enviada' || !t.purchase_id
        ? 'Correção permitida somente em lote do fornecedor aguardando recebimento.'
        : loja && loja !== t.to_store_id ? 'Somente a administração da loja de destino pode corrigir este lote.'
          : !p || p.store_id !== t.to_store_id ? 'Cadastro da peça indisponível nesta loja.' : null
    return {
      id: i.id, nome: p?.name ?? i.product_name, nomeHistorico: i.product_name,
      productId: p?.id ?? null, storeId: p?.store_id ?? null,
      bloqueioNome: bloqueio?.replace('corrigir preços', 'corrigir o nome') ?? null,
      etiqueta: i.barcode_number, foto: p?.photo_url ?? null,
      precoRomaneio: i.unit_sale_price == null ? null : Number(i.unit_sale_price),
      precoVenda: Number(p?.sale_price ?? 0), precoPromocional: p?.promotional_price == null ? null : Number(p.promotional_price),
      promocaoAtiva: promo, precoEtiqueta: p ? Number(promo ? p.promotional_price : p.sale_price) : null, bloqueio,
      versao: bloqueio || !p ? null : {
        transfer_updated_at: t.updated_at, product_updated_at: p.updated_at,
        sale_price: p.sale_price, promotional_price: p.promotional_price,
        promotional_active: p.promotional_active, unit_sale_price: i.unit_sale_price,
      },
    }
  })
}

export async function corrigirPrecoPeca(transferId: string, itemId: string, preco: number, versao: Record<string, unknown>) {
  const perfil = await requireProfile()
  if (perfil.role !== 'admin') return { success: false, error: 'Somente administradores podem corrigir preços.' }
  if (!uuid(transferId) || !uuid(itemId) || !Number.isFinite(preco) || preco <= 0 || preco > 9999999999.99
    || Math.abs(preco * 100 - Math.round(preco * 100)) > 0.0001) {
    return { success: false, error: 'Informe um preço positivo com até duas casas decimais.' }
  }
  const { data, error } = await createAdminClient().rpc('corrigir_preco_romaneio', {
    p_transfer_id: transferId, p_item_id: itemId, p_sale_price: preco, p_expected: versao,
    p_user_id: perfil.id, p_store_scope: lojaDoEscopo(perfil),
  })
  if (error) return { success: false, error: 'Não foi possível salvar o preço. Reabra os itens e tente novamente.' }
  if (data?.success) {
    for (const path of ['/estoque/transferencias', '/produtos', '/estoque', '/compras']) revalidatePath(path)
  }
  return data as { success: boolean; error?: string; effective_price?: number }
}

export async function etiquetaPersistidaRomaneio(transferId: string, itemId: string): Promise<EtiquetasPrinterItem> {
  const { perfil, t, produtos, db } = await ler(transferId)
  if (perfil.role !== 'admin') throw new Error('Somente administradores podem reimprimir etiquetas.')
  if (t.status === 'cancelada') throw new Error('Romaneio cancelado: reimpressão indisponível.')
  const i = t.transfer_items.find(i => i.id === itemId && i.quantity_sent > 0)
  const p = i && produtos.find(p => p.id === (i.dest_product_id ?? i.product_id))
  if (!i || !p || p.store_id !== t.to_store_id) throw new Error('Cadastro da peça indisponível no destino. Solicite revisão.')
  let formato = p.label_format
  if (t.purchase_id) {
    const { data, error } = await db.from('purchase_items').select('label_format')
      .eq('purchase_id', t.purchase_id).eq('product_id', i.product_id)
    if (error) throw new Error('Não foi possível consultar o formato da etiqueta.')
    const formatos = [...new Set((data ?? []).map(i => i.label_format).filter(Boolean))]
    if (formatos.length > 1) throw new Error('A compra tem formatos diferentes para esta peça. Solicite revisão.')
    formato = formatos[0] ?? formato
  }
  if (formato !== 'A' && formato !== 'B') throw new Error('Formato da etiqueta não definido para esta peça.')
  return { id: p.id, name: p.name, supplier_reference: p.code, barcode_number: p.barcode_number,
    sale_price: Number(p.promotional_active && Number(p.promotional_price) > 0 ? p.promotional_price : p.sale_price),
    label_format: formato, quantity: 1, category: p.category ?? '' }
}
