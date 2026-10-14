import { requireProfile } from '@/lib/auth'
import { lojaDaConfiguracao } from '@/lib/lojasQueAdministra'
import { createAdminClient } from '@/lib/supabase/admin'
import ConfiguracoesNegocioClient from './ConfiguracoesNegocioClient'
import styles from './page.module.css'
import PageHeader from '@/components/ui/PageHeader'

export interface SettingRow {
  key: string
  value: number
  description: string | null
}

export default async function ConfiguracoesNegocioPage() {
  const profile = await requireProfile()
  /*
   * Regra do negócio é da LOJA desde 16/10/2026 (regra do dev: Campinas e
   * Brasília não compartilham nada). Admin de loja vê e muda só a dela; a dona
   * vê a loja escolhida no "Trocar" do menu. ?loja= na URL é ignorado.
   */
  const loja = await lojaDaConfiguracao(profile)

  const admin = createAdminClient()
  const { data, error } = await admin.from('settings').select('key, value, description')
    .eq('store_id', loja.id).not('key', 'like', 'meta_loja:%').order('key')
  if (error || !data) throw new Error('Não consegui ler as configurações da loja.')

  const settings: SettingRow[] = ((data) as { key: string; value: unknown; description: string | null }[]).map(s => ({
    key: s.key,
    value: Number(s.value),
    description: s.description,
  }))

  return (
    <div className={styles.page}>
      <PageHeader
        title="Configurações do Negócio"
        subtitle="Parâmetros que definem as regras comerciais aplicadas automaticamente no sistema."
      />
      <ConfiguracoesNegocioClient key={loja.id} settings={settings} storeId={loja.id} />
    </div>
  )
}
