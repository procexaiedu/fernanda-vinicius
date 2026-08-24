import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import ConferenciaClient from './ConferenciaClient'

export interface SessaoResumo {
  id: string
  scope_type: 'categoria' | 'loja'
  scope_value: string | null
  status: 'contando' | 'fechada' | 'cancelada'
  started_at: string
  closed_at: string | null
  totals: Record<string, number> | null
  em_escopo: number
  users: { full_name: string } | null
  stores: { name: string } | null
}

export interface EscopoDisponivel {
  categoria: string
  pecas: number
}

interface PageProps {
  searchParams: Promise<{ store_id?: string }>
}

export default async function ConferenciaPage({ searchParams }: PageProps) {
  const params = await searchParams
  const profile = await requireProfile()
  const isAdmin = profile.role === 'admin'
  const admin = createAdminClient()

  const [sessoesRes, storesRes] = await Promise.all([
    admin
      .from('inventory_sessions')
      .select('id, scope_type, scope_value, status, started_at, closed_at, totals, scope_product_ids, store_id, users!user_id(full_name), stores!store_id(name)')
      .order('started_at', { ascending: false })
      .limit(50),
    isAdmin
      ? admin.from('stores').select('id, name').eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
  ])

  const stores = (storesRes.data ?? []) as { id: string; name: string }[]

  // Operadora só enxerga a própria loja; admin vê tudo.
  const brutas = (sessoesRes.data ?? []) as unknown as (SessaoResumo & {
    scope_product_ids: string[] | null
    store_id: string
  })[]
  const sessoes: SessaoResumo[] = brutas
    .filter(s => isAdmin || s.store_id === profile.store_id)
    .map(({ scope_product_ids, ...s }) => ({
      ...s,
      em_escopo: scope_product_ids?.length ?? 0,
    }))

  /*
   * Duas colunas de ~1.200 linhas dão as peças por loja E por categoria.
   *
   * Paginado, e não `.limit(N)`, porque o PostgREST corta em silêncio no
   * `PGRST_DB_MAX_ROWS` — 1.000 no Supabase Cloud, 5.000 no self-hosted. Com
   * limit, a tela mostrava "999 peças" onde havia 1.185, sem nenhum aviso: o
   * número simplesmente vinha errado, numa tela cujo trabalho é medir
   * divergência. Aqui a gente lê até a página vir curta.
   */
  const linhas: { store_id: string; category: string }[] = []
  for (let inicio = 0; ; inicio += 1000) {
    const { data: pagina } = await admin
      .from('products')
      .select('store_id, category')
      .eq('is_active', true)
      .order('id')
      .range(inicio, inicio + 999)

    const lote = (pagina ?? []) as { store_id: string; category: string }[]
    linhas.push(...lote)
    if (lote.length < 1000) break
  }

  const porLoja = new Map<string, number>()
  for (const p of linhas) {
    porLoja.set(p.store_id, (porLoja.get(p.store_id) ?? 0) + 1)
  }

  /*
   * Admin não tem store_id, e antes o padrão era stores[0] — a primeira em
   * ordem alfabética. Na prática isso abria em Brasília, que tem 1 peça, com
   * Campinas (1.185) escondida atrás do seletor: a tela parecia vazia e o
   * sistema, quebrado. O padrão agora é a loja com mais estoque.
   */
  const lojaPadrao = [...porLoja.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const lojaDoEscopo = profile.store_id ?? params.store_id ?? lojaPadrao ?? stores[0]?.id ?? null

  const contagem = new Map<string, number>()
  let totalLoja = 0
  for (const p of linhas) {
    if (p.store_id !== lojaDoEscopo) continue
    totalLoja++
    const c = (p.category ?? '').trim()
    if (!c) continue
    contagem.set(c, (contagem.get(c) ?? 0) + 1)
  }

  const escopos: EscopoDisponivel[] = [...contagem.entries()]
    .map(([categoria, pecas]) => ({ categoria, pecas }))
    .sort((a, b) => b.pecas - a.pecas)

  // O seletor mostra o tamanho de cada loja — assim a escolha é informada.
  const lojasComContagem = stores.map(s => ({ ...s, pecas: porLoja.get(s.id) ?? 0 }))

  const abertaId = sessoes.find(s => s.status === 'contando')?.id ?? null

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 'var(--fs-page-title)', letterSpacing: 'var(--tracking-title)', lineHeight: 1.15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Conferência de estoque
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Bipe a gaveta e compare com o sistema. Cada ajuste fica registrado com motivo.
        </p>
      </div>
      <ConferenciaClient
        sessoes={sessoes}
        escopos={escopos}
        totalLoja={totalLoja}
        stores={lojasComContagem}
        lojaAtual={lojaDoEscopo}
        isAdmin={isAdmin}
        abertaId={abertaId}
      />
    </div>
  )
}
