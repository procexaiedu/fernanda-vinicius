import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import TransferenciasClient from './TransferenciasClient'

/* 10 por página, como todas as listas do sistema — é o que o componente
 * Paginacao assume no rótulo "Mostrando 1-10 de N". */
const PAGE_SIZE = 10

export interface ItemRomaneio {
  id: string
  product_id: string
  product_code: string
  product_name: string
  barcode_number: string
  quantity_sent: number
  quantity_received: number | null
  unit_cost: number
  reetiquetar: boolean
  divergence_type: 'falta' | 'sobra' | null
}

export interface Romaneio {
  id: string
  from_store_id: string
  to_store_id: string
  status: 'enviada' | 'recebida' | 'divergente' | 'cancelada'
  sent_at: string
  received_at: string | null
  notes: string | null
  receipt_notes: string | null
  totals: { pecas?: number; itens?: number; custo_total?: number } | null
  de: string
  para: string
  enviou: string
  recebeu: string | null
  itens: ItemRomaneio[]
}

export interface LojaOption { id: string; name: string }

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string }>
}

export default async function TransferenciasPage({ searchParams }: PageProps) {
  const params  = await searchParams
  const profile = await requireProfile()
  const isAdmin = profile.role === 'admin'

  const page   = Math.max(1, Number(params.page ?? 1))
  const offset = (page - 1) * PAGE_SIZE
  const supa   = createAdminClient()

  /*
   * Os itens vêm junto, no mesmo select.
   *
   * A conferência do recebimento precisa da lista completa de peças com o
   * código de barras de cada uma — é contra ela que o bipe é conferido, sem ida
   * ao servidor a cada peça. E a lista já mostra "3 de 12 conferidas".
   */
  let q = supa
    .from('transfers')
    .select(
      'id, from_store_id, to_store_id, status, sent_at, received_at, notes, receipt_notes, totals, ' +
      'origem:stores!from_store_id(name), destino:stores!to_store_id(name), ' +
      'quem_enviou:users!sent_by(full_name), quem_recebeu:users!received_by(full_name), ' +
      'transfer_items(id, product_id, product_code, product_name, barcode_number, ' +
      'quantity_sent, quantity_received, unit_cost, reetiquetar, divergence_type)',
      { count: 'exact' },
    )
    .order('sent_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  // Operadora só vê o que envolve a loja dela — nas duas pontas.
  if (!isAdmin && profile.store_id) {
    q = q.or(`from_store_id.eq.${profile.store_id},to_store_id.eq.${profile.store_id}`)
  }
  if (params.status) q = q.eq('status', params.status)

  const [transfRes, storesRes] = await Promise.all([
    q,
    supa.from('stores').select('id, name').order('name'),
  ])

  const primeiro = (v: unknown) => (Array.isArray(v) ? v[0] : v)

  const romaneios = (transfRes.data ?? []).map(t => {
    const r = t as unknown as Record<string, unknown>
    return {
      id:            r.id as string,
      from_store_id: r.from_store_id as string,
      to_store_id:   r.to_store_id as string,
      status:        r.status as Romaneio['status'],
      sent_at:       r.sent_at as string,
      received_at:   r.received_at as string | null,
      notes:         r.notes as string | null,
      receipt_notes: r.receipt_notes as string | null,
      totals:        (r.totals ?? null) as Romaneio['totals'],
      de:     (primeiro(r.origem)  as { name: string } | null)?.name ?? '—',
      para:   (primeiro(r.destino) as { name: string } | null)?.name ?? '—',
      enviou: (primeiro(r.quem_enviou)  as { full_name: string } | null)?.full_name ?? '—',
      recebeu:(primeiro(r.quem_recebeu) as { full_name: string } | null)?.full_name ?? null,
      itens: ((r.transfer_items ?? []) as ItemRomaneio[])
        .map(i => ({ ...i, unit_cost: Number(i.unit_cost ?? 0) }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR')),
    } as Romaneio
  })

  const lojas = (storesRes.data ?? []) as LojaOption[]

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 'var(--fs-page-title)', letterSpacing: 'var(--tracking-title)', lineHeight: 1.15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Transferências de Estoque
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Romaneio de envio e conferência na chegada. Peça em trânsito não conta como estoque de nenhuma das lojas.
        </p>
      </div>
      <TransferenciasClient
        romaneios={romaneios}
        total={transfRes.count ?? 0}
        page={page}
        perPage={PAGE_SIZE}
        lojas={lojas}
        isAdmin={isAdmin}
        minhaLoja={profile.store_id}
        filtroStatus={params.status ?? ''}
      />
    </div>
  )
}
