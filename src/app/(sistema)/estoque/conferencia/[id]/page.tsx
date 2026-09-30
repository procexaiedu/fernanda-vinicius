import { notFound, redirect } from 'next/navigation'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
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

  const { data: sessao, error: erroSessao } = await admin
    .from('inventory_sessions')
    .select('id, store_id, scope_type, scope_value, status, started_at, closed_at, totals, scope_product_ids, users!user_id(full_name), stores!store_id(name)')
    .eq('id', id)
    .maybeSingle()

  // Falha de leitura não é 404: "não encontrada" mandaria abrir outra sessão.
  if (erroSessao) throw new Error(`Não foi possível carregar a conferência: ${erroSessao.message}`)
  if (!sessao) notFound()
  /*
   * Era `role !== 'admin' && ...`: qualquer admin abria sessão de qualquer loja
   * — a Eleandra (admin de Brasília) via e bipava na contagem de Campinas.
   * Mesma regra das ações: quem está numa loja só abre sessão dela.
   */
  const loja = lojaDoEscopo(profile)
  if (loja && sessao.store_id !== loja) redirect('/estoque/conferencia')

  /*
   * Só os bipes. A quantidade esperada de cada peça NÃO vai para o navegador
   * enquanto a contagem está aberta — ver `carregarReconciliacao` em actions.ts.
   */
  const { data: scans, error: erroBipes } = await admin
    .from('inventory_scans')
    .select('id, barcode_number, product_id, scanned_at, produto:products!product_id(name, code)')
    .eq('session_id', id)
    .order('scanned_at', { ascending: false })
    .limit(500)

  /* A tela manda conferir a lista depois de um bipe incerto (F5). Lista vazia
     por falha de leitura diria "não entrou" e o rebipe viraria sobra falsa. */
  if (erroBipes) throw new Error(`Não foi possível carregar os bipes: ${erroBipes.message}`)

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

  const { count: totalBipes, error: erroTotal } = await admin
    .from('inventory_scans')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', id)
  if (erroTotal) throw new Error(`Não foi possível contar os bipes: ${erroTotal.message}`)

  const escopo = (sessao.scope_product_ids ?? []) as string[]
  const stores = sessao.stores as unknown
  const users  = sessao.users as unknown

  return (
    /*
     * `key` no status: quando a sessão é reaberta, o servidor manda status novo
     * mas o React reaproveita o componente — e a fase, que nasce de um useState
     * com valor inicial, ficaria congelada em 'fechada'. Reabrir funcionava no
     * banco e a tela não mudava: para quem clicou, "não aconteceu nada".
     *
     * Com a key, mudança de status remonta, que é o certo: é uma transição real
     * da sessão, não uma atualização incremental.
     */
    <SessaoClient
      key={sessao.status as string}
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
