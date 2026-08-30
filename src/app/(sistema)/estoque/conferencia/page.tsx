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

/**
 * O tamanho de um escopo, em três números que NÃO são a mesma coisa.
 *
 * A tela mostrava só `cadastros` chamando de "peças", e era mentira: em
 * 30/08/2026 Campinas tinha 1.243 cadastros ativos, dos quais **703 com saldo
 * zero** — fichas vazias, quase todas restos da conferência de 26/08. A tela
 * anunciava "Loja Inteira — 1243 peças" para uma gaveta com 622 unidades.
 *
 * `unidades` é o número que a operadora precisa: cada unidade é um bipe.
 */
export interface EscopoDisponivel {
  categoria: string
  /** Cadastros ativos com saldo > 0 — quantas peças distintas procurar. */
  pecas: number
  /** Soma do saldo — quantos bipes a contagem completa tem. */
  unidades: number
  /** Cadastros ativos no total, com saldo ou sem. É o que entra no escopo congelado. */
  cadastros: number
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
  const linhas: { store_id: string; category: string; quantity_in_stock: number }[] = []
  for (let inicio = 0; ; inicio += 1000) {
    const { data: pagina } = await admin
      .from('products')
      .select('store_id, category, quantity_in_stock')
      .eq('is_active', true)
      .order('id')
      .range(inicio, inicio + 999)

    const lote = (pagina ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < 1000) break
  }

  /* Por loja: unidades (bipes esperados), peças com saldo e cadastros ativos. */
  const porLoja = new Map<string, { unidades: number; pecas: number; cadastros: number }>()
  for (const p of linhas) {
    const a = porLoja.get(p.store_id) ?? { unidades: 0, pecas: 0, cadastros: 0 }
    a.cadastros += 1
    if (p.quantity_in_stock > 0) { a.pecas += 1; a.unidades += p.quantity_in_stock }
    porLoja.set(p.store_id, a)
  }

  /*
   * Admin não tem store_id, e antes o padrão era stores[0] — a primeira em
   * ordem alfabética. Na prática isso abria em Brasília, que tem 1 peça, com
   * Campinas (1.185) escondida atrás do seletor: a tela parecia vazia e o
   * sistema, quebrado. O padrão agora é a loja com mais estoque.
   */
  const lojaPadrao = [...porLoja.entries()].sort((a, b) => b[1].unidades - a[1].unidades)[0]?.[0]
  const lojaDoEscopo = profile.store_id ?? params.store_id ?? lojaPadrao ?? stores[0]?.id ?? null

  const contagem = new Map<string, { pecas: number; unidades: number; cadastros: number }>()
  const totalLoja = { pecas: 0, unidades: 0, cadastros: 0 }
  for (const p of linhas) {
    if (p.store_id !== lojaDoEscopo) continue

    totalLoja.cadastros += 1
    if (p.quantity_in_stock > 0) {
      totalLoja.pecas += 1
      totalLoja.unidades += p.quantity_in_stock
    }

    const c = (p.category ?? '').trim()
    if (!c) continue
    const a = contagem.get(c) ?? { pecas: 0, unidades: 0, cadastros: 0 }
    a.cadastros += 1
    if (p.quantity_in_stock > 0) { a.pecas += 1; a.unidades += p.quantity_in_stock }
    contagem.set(c, a)
  }

  /*
   * Ordena por UNIDADES, que é o esforço real da contagem. Por cadastro,
   * categoria cheia de ficha vazia subiria na lista sem ter nada para bipar.
   */
  const escopos: EscopoDisponivel[] = [...contagem.entries()]
    .map(([categoria, n]) => ({ categoria, ...n }))
    .sort((a, b) => b.unidades - a.unidades)

  // O seletor mostra o tamanho de cada loja — assim a escolha é informada.
  const lojasComContagem = stores.map(s => ({
    ...s,
    ...(porLoja.get(s.id) ?? { unidades: 0, pecas: 0, cadastros: 0 }),
  }))

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
