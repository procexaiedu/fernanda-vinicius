import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import ConfiguracoesNegocioClient from './ConfiguracoesNegocioClient'
import styles from './page.module.css'

export interface SettingRow {
  key: string
  value: number
  description: string | null
}

export default async function ConfiguracoesNegocioPage() {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/')

  const admin = createAdminClient()
  const { data } = await admin.from('settings').select('key, value, description').order('key')

  const settings: SettingRow[] = ((data ?? []) as { key: string; value: unknown; description: string | null }[]).map(s => ({
    key: s.key,
    value: Number(s.value),
    description: s.description,
  }))

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Configurações do Negócio</h1>
        <p className={styles.subtitle}>Parâmetros que definem as regras comerciais aplicadas automaticamente no sistema.</p>
      </div>
      <ConfiguracoesNegocioClient settings={settings} />
    </div>
  )
}
