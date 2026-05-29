import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ImpressaoClient from './ImpressaoClient'

export default async function ImpressaoConfigPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Impressão de etiquetas</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Configure o agente local de impressão (<code>fv-print-agent</code>) que envia os jobs PPLA à impressora térmica Argox.
        </p>
      </div>
      <ImpressaoClient />
    </div>
  )
}
