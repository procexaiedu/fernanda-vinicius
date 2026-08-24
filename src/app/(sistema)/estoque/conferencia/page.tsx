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

export default async function ConferenciaPage() {
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

  // Escopos possíveis: categoria e quantas peças ativas ela tem hoje.
  // Só uma coluna de ~1.200 linhas — mais barato que uma RPC de agregação.
  const lojaDoEscopo = profile.store_id ?? stores[0]?.id ?? null
  let escopos: EscopoDisponivel[] = []
  let totalLoja = 0

  if (lojaDoEscopo) {
    const { data } = await admin
      .from('products')
      .select('category')
      .eq('is_active', true)
      .eq('store_id', lojaDoEscopo)
      .limit(5000)

    const contagem = new Map<string, number>()
    for (const p of (data ?? []) as { category: string }[]) {
      const c = (p.category ?? '').trim()
      if (!c) continue
      contagem.set(c, (contagem.get(c) ?? 0) + 1)
    }
    totalLoja = (data ?? []).length
    escopos = [...contagem.entries()]
      .map(([categoria, pecas]) => ({ categoria, pecas }))
      .sort((a, b) => b.pecas - a.pecas)
  }

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
        stores={stores}
        isAdmin={isAdmin}
        abertaId={abertaId}
      />
    </div>
  )
}
