import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import TransferenciasClient from './TransferenciasClient'
import PageHeader from '@/components/ui/PageHeader'
import { tipoRomaneio, type TipoRomaneio } from '@/lib/consignacaoEntreLojas'

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
  /* Zerado para quem não é admin: ver o map abaixo. */
  unit_cost: number
  /* Congelado no envio. NULL nos itens enviados antes de 15/09/2026. */
  unit_sale_price: number | null
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
  /*
   * `venda_total` só existe nos romaneios enviados a partir de 15/09/2026 (ver
   * a migration 20260915_transferencia_valor_de_venda). É jsonb, então ler o
   * campo novo não exige que a coluna exista — nos antigos ele vem `undefined`,
   * e a tela mostra "—". Nunca R$ 0,00: zero é um número que ela usaria para
   * decidir quanto mandar, e seria mentira.
   */
  totals: { pecas?: number; itens?: number; custo_total?: number; venda_total?: number } | null
  /* Desde 05/10/2026 (migration 20261005_transferencia_duas_pontas). */
  kind: TipoRomaneio
  consignacao_id: string | null
  /* Acerto da consignação entre lojas. Só vem para admin. */
  acerto_at: string | null
  de: string
  para: string
  enviou: string
  recebeu: string | null
  itens: ItemRomaneio[]
}

export interface LojaOption { id: string; name: string }

/** Consignação já conferida no destino e sem acerto: pode receber devolução. */
export interface ConsignacaoAberta {
  id: string
  from_store_id: string
  to_store_id: string
  de: string
  para: string
  sent_at: string
}

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
      'kind, consignacao_id, acerto_at, ' +
      'origem:stores!from_store_id(name), destino:stores!to_store_id(name), ' +
      'quem_enviou:users!sent_by(full_name), quem_recebeu:users!received_by(full_name), ' +
      'transfer_items(id, product_id, product_code, product_name, barcode_number, ' +
      'quantity_sent, quantity_received, unit_cost, unit_sale_price, reetiquetar, divergence_type)',
      { count: 'exact' },
    )
    .order('sent_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  /*
   * Quem tem loja só vê o que ENVOLVE a loja dela — nas duas pontas.
   *
   * Era `!isAdmin && profile.store_id`, que deixava o admin de loja de fora: a
   * Eleandra via os romaneios entre lojas que não são a dela. Papel e escopo
   * são eixos diferentes.
   *
   * A LISTA DE LOJAS continua inteira de propósito: transferência sem destino
   * não existe, e o destino é, por definição, a outra loja.
   */
  const escopo = lojaDoEscopo(profile)
  /* Operadora sem loja não tem "a própria loja": sem esta trava, o filtro abaixo
     não entrava e ela via os romaneios da rede inteira. */
  if (!isAdmin && !escopo) {
    throw new Error('Seu usuário não está ligado a nenhuma loja. Peça à administração para vincular você a uma.')
  }
  if (escopo) {
    q = q.or(`from_store_id.eq.${escopo},to_store_id.eq.${escopo}`)
  }
  if (params.status) q = q.eq('status', params.status)

  /* Para a devolução: as consignações que a loja recebeu e ainda não acertou.
     Só admin monta romaneio, então só ela precisa da lista. */
  let qAbertas = supa
    .from('transfers')
    .select('id, from_store_id, to_store_id, sent_at, origem:stores!from_store_id(name), destino:stores!to_store_id(name)')
    .eq('kind', 'consignacao')
    .in('status', ['recebida', 'divergente'])
    .is('acerto_at', null)
    .order('sent_at', { ascending: false })
  if (escopo) qAbertas = qAbertas.eq('to_store_id', escopo)

  const [transfRes, storesRes, abertasRes] = await Promise.all([
    q,
    supa.from('stores').select('id, name').order('name'),
    isAdmin ? qAbertas : Promise.resolve({ data: [], error: null }),
  ])

  /* Erro de leitura é erro na tela, não lista vazia (ver CLAUDE.md). */
  if (transfRes.error) throw new Error(`Não foi possível ler as transferências: ${transfRes.error.message}`)
  if (abertasRes.error) throw new Error(`Não foi possível ler as consignações: ${abertasRes.error.message}`)

  const primeiro = (v: unknown) => (Array.isArray(v) ? v[0] : v)

  /*
   * Custo não sai do servidor para quem não é admin (pedido da Eleandra,
   * 05/10/2026: "essa informação não pode aparecer para elas"). Esconder só na
   * tela não basta, o payload vai inteiro para o navegador.
   *
   * O CÓDIGO vai junto: nas peças de fornecedor ele carrega o custo
   * (FEF09110 = custo R$ 110). Para conferir, a etiqueta e o nome bastam.
   */
  const semCusto = (i: ItemRomaneio): ItemRomaneio =>
    isAdmin ? i : { ...i, unit_cost: 0, product_code: '' }
  const totaisSemCusto = (t: Romaneio['totals']): Romaneio['totals'] => {
    if (isAdmin || !t) return t
    const resto = { ...t }
    delete resto.custo_total
    return resto
  }

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
      totals:        totaisSemCusto((r.totals ?? null) as Romaneio['totals']),
      kind:          tipoRomaneio(r.kind),
      consignacao_id:(r.consignacao_id ?? null) as string | null,
      acerto_at:     isAdmin ? (r.acerto_at ?? null) as string | null : null,
      de:     (primeiro(r.origem)  as { name: string } | null)?.name ?? '—',
      para:   (primeiro(r.destino) as { name: string } | null)?.name ?? '—',
      enviou: (primeiro(r.quem_enviou)  as { full_name: string } | null)?.full_name ?? '—',
      recebeu:(primeiro(r.quem_recebeu) as { full_name: string } | null)?.full_name ?? null,
      itens: ((r.transfer_items ?? []) as ItemRomaneio[])
        .map(i => semCusto({
          ...i,
          unit_cost: Number(i.unit_cost ?? 0),
          unit_sale_price: i.unit_sale_price == null ? null : Number(i.unit_sale_price),
        }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR')),
    } as Romaneio
  })

  const lojas = (storesRes.data ?? []) as LojaOption[]

  const consignacoesAbertas: ConsignacaoAberta[] = ((abertasRes.data ?? []) as unknown as Record<string, unknown>[])
    .map(c => ({
      id:            c.id as string,
      from_store_id: c.from_store_id as string,
      to_store_id:   c.to_store_id as string,
      sent_at:       c.sent_at as string,
      de:   (primeiro(c.origem)  as { name: string } | null)?.name ?? '—',
      para: (primeiro(c.destino) as { name: string } | null)?.name ?? '—',
    }))

  return (
    <div>
      <PageHeader
        title="Transferências de Estoque"
        subtitle="Romaneio de envio e conferência na chegada. Peça em trânsito não conta como estoque de nenhuma das lojas."
      />
      <TransferenciasClient
        romaneios={romaneios}
        total={transfRes.count ?? 0}
        page={page}
        perPage={PAGE_SIZE}
        lojas={lojas}
        consignacoesAbertas={consignacoesAbertas}
        isAdmin={isAdmin}
        /* O escopo, não o `store_id`: a admin global que escolheu Campinas no
         * login opera como Campinas enquanto estiver nela. */
        minhaLoja={escopo}
        /* Só para separar o rascunho do romaneio por pessoa (localStorage). */
        usuarioId={profile.id}
        filtroStatus={params.status ?? ''}
      />
    </div>
  )
}
