import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import DisparosClient from './DisparosClient'

export interface DisparoRow {
  disparo_id: string
  titulo: string
  status: string
  store_id: string
  store_name: string
  template_name: string
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const [profileRes, storesRes, metricsRes, disparosRes] = await Promise.all([
    supabase.from('users').select('role, store_id').eq('id', user.id).single(),
    admin.from('stores').select('id, name').eq('is_active', true).order('name'),
    admin.from('v_disparo_metrics').select('*').order('created_at', { ascending: false }),
    admin.from('disparos').select('id, template_name'),
  ])

  const profile = profileRes.data
  const stores: StoreOption[] = storesRes.data ?? []
  const storeMap = new Map(stores.map(s => [s.id, s.name]))
  const tplMap = new Map((disparosRes.data ?? []).map(d => [d.id, d.template_name]))

  const disparos: DisparoRow[] = (metricsRes.data ?? []).map(m => ({
    disparo_id:    m.disparo_id,
    titulo:        m.titulo,
    status:        m.status,
    store_id:      m.store_id,
    store_name:    storeMap.get(m.store_id) ?? '—',
    template_name: tplMap.get(m.disparo_id) ?? '—',
    created_at:    m.created_at,
    sent_at:       m.sent_at,
    total:         Number(m.total ?? 0),
    enviados:      Number(m.enviados ?? 0),
    entregues:     Number(m.entregues ?? 0),
    lidos:         Number(m.lidos ?? 0),
    falhas:        Number(m.falhas ?? 0),
  }))

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
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
