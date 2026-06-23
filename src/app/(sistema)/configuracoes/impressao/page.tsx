import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import ImpressaoClient from './ImpressaoClient'
import CategoryMappingPanel from './CategoryMappingPanel'
import type { CategoryMapping } from './actions'

export default async function ImpressaoConfigPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'

  let mappings: CategoryMapping[] = []
  if (isAdmin) {
    const admin = createAdminClient()
    const { data } = await admin
      .from('category_label_mapping')
      .select('category, label_format')
      .eq('is_active', true)
      .order('category')
    mappings = (data ?? []) as CategoryMapping[]
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Impressão de etiquetas</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Configure o agente local de impressão (<code>fv-print-agent</code>) que envia os jobs PPLA à impressora térmica Argox.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 480px', gap: 24, alignItems: 'start' }}>
        <ImpressaoClient />
        {isAdmin && <CategoryMappingPanel initialMappings={mappings} />}
      </div>
    </div>
  )
}
