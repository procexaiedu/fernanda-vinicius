import { redirect } from 'next/navigation'
import { requireProfile, podeConfigurarRede } from '@/lib/auth'
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
  /*
   * Configuração é da REDE, não da loja: lojas, usuários, metas e regras do
   * negócio valem para as duas. `role !== 'admin'` deixava o admin de loja
   * entrar — de onde ele criava usuário e mudava a regra de desconto da outra
   * loja. Ver podeConfigurarRede() em src/lib/auth.ts.
   */
  if (!podeConfigurarRede(profile)) redirect('/')

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
