import { redirect } from 'next/navigation'
import { requireProfile, ehOperadora } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import DisparosClient from './DisparosClient'

export interface DisparoRow {
  disparo_id: string
  titulo: string
  status: string
  store_id: string
  store_name: string
  template_name: string
  template_language: string
  param2: string | null
  param3: string | null
  image_url: string | null
  created_at: string
  sent_at: string | null
  total: number
  enviados: number
  entregues: number
  lidos: number
  falhas: number
}

export interface StoreOption {
  id: string
  name: string
}

export default async function DisparosPage() {
  const profile = await requireProfile()
  /* Trava própria: o layout é a rede geral, mas ela depende de um cabeçalho.
   * Aqui não depende de nada. Ver src/app/(sistema)/layout.tsx. */
  if (ehOperadora(profile)) redirect('/pdv')

  const admin = createAdminClient()

  const [storesRes, metricsRes, disparosRes] = await Promise.all([
    admin.from('stores').select('id, name').eq('is_active', true).order('name'),
    admin.from('v_disparo_metrics').select('*').order('created_at', { ascending: false }),
    admin.from('disparos').select('id, template_name, template_language, param2_default, param3_default, image_url'),
  ])

  const stores: StoreOption[] = storesRes.data ?? []
  const storeMap = new Map(stores.map(s => [s.id, s.name]))
  const dispMap = new Map((disparosRes.data ?? []).map(d => [d.id, d]))

  const disparos: DisparoRow[] = (metricsRes.data ?? []).map(m => {
    const meta = dispMap.get(m.disparo_id)
    return {
    disparo_id:        m.disparo_id,
    titulo:            m.titulo,
    status:            m.status,
    store_id:          m.store_id,
    store_name:        storeMap.get(m.store_id) ?? '—',
    template_name:     meta?.template_name ?? '—',
    template_language: meta?.template_language ?? 'pt_BR',
    param2:            meta?.param2_default ?? null,
    param3:            meta?.param3_default ?? null,
    image_url:         meta?.image_url ?? null,
    created_at:        m.created_at,
    sent_at:           m.sent_at,
    total:         Number(m.total ?? 0),
    enviados:      Number(m.enviados ?? 0),
    entregues:     Number(m.entregues ?? 0),
    lidos:         Number(m.lidos ?? 0),
    falhas:        Number(m.falhas ?? 0),
    }
  })

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 'var(--fs-page-title)', letterSpacing: 'var(--tracking-title)', lineHeight: 1.15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Disparos
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Envie avisos por WhatsApp para os clientes de cada loja e acompanhe a entrega.
        </p>
      </div>
      <DisparosClient
        disparos={disparos}
        stores={stores}
        currentUserRole={profile?.role ?? 'operator'}
        currentUserStoreId={profile?.store_id ?? null}
      />
    </div>
  )
}
