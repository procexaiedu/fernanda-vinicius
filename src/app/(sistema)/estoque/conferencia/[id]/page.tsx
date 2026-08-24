import { notFound, redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import SessaoClient from './SessaoClient'

export interface BipeRegistrado {
  id: string
  barcode_number: string
  product_id: string | null
  scanned_at: string
  produto: { name: string; code: string } | null
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SessaoPage({ params }: PageProps) {
  const { id } = await params
  const profile = await requireProfile()
  const admin = createAdminClient()

  const { data: sessao } = await admin
    .from('inventory_sessions')
    .select('id, store_id, scope_type, scope_value, status, started_at, closed_at, totals, scope_product_ids, users!user_id(full_name), stores!store_id(name)')
    .eq('id', id)
    .maybeSingle()

  if (!sessao) notFound()
  if (profile.role !== 'admin' && sessao.store_id !== profile.store_id) redirect('/estoque/conferencia')

  /*
   * Só os bipes. A quantidade esperada de cada peça NÃO vai para o navegador
   * enquanto a contagem está aberta — ver `carregarReconciliacao` em actions.ts.
   */
  const { data: scans } = await admin
    .from('inventory_scans')
    .select('id, barcode_number, product_id, scanned_at, produto:products!product_id(name, code)')
    .eq('session_id', id)
    .order('scanned_at', { ascending: false })
    .limit(500)

  const bipes = (scans ?? []).map(s => {
    const p = (s as { produto: unknown }).produto
    return {
      id:             s.id as string,
      barcode_number: s.barcode_number as string,
      product_id:     s.product_id as string | null,
      scanned_at:     s.scanned_at as string,
      produto:        (Array.isArray(p) ? p[0] : p) as { name: string; code: string } | null,
    }
  }) as BipeRegistrado[]

  const { count: totalBipes } = await admin
    .from('inventory_scans')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', id)

  const escopo = (sessao.scope_product_ids ?? []) as string[]
  const stores = sessao.stores as unknown
  const users  = sessao.users as unknown

  return (
    <SessaoClient
      sessao={{
        id:          sessao.id as string,
        scope_type:  sessao.scope_type as 'categoria' | 'loja',
        scope_value: sessao.scope_value as string | null,
        status:      sessao.status as 'contando' | 'fechada' | 'cancelada',
        started_at:  sessao.started_at as string,
        closed_at:   sessao.closed_at as string | null,
        totals:      (sessao.totals ?? null) as Record<string, number> | null,
        em_escopo:   escopo.length,
        loja:        ((Array.isArray(stores) ? stores[0] : stores) as { name: string } | null)?.name ?? '',
        quem:        ((Array.isArray(users) ? users[0] : users) as { full_name: string } | null)?.full_name ?? '',
      }}
      bipesIniciais={bipes}
      totalBipesInicial={totalBipes ?? 0}
    />
  )
}
