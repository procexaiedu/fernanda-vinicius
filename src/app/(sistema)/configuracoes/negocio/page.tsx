import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { lojaDaConfiguracao } from '@/lib/lojasQueAdministra'
import SeletorLojaConfig from '@/components/ui/SeletorLojaConfig'
import { createAdminClient } from '@/lib/supabase/admin'
import ConfiguracoesNegocioClient from './ConfiguracoesNegocioClient'
import styles from './page.module.css'
import PageHeader from '@/components/ui/PageHeader'

export interface SettingRow {
  key: string
  value: number
  description: string | null
}

export default async function ConfiguracoesNegocioPage({ searchParams }: { searchParams: Promise<{ loja?: string }> }) {
  const profile = await requireProfile()
  /*
   * Regra do negócio é da LOJA desde 16/10/2026 (regra do dev: Campinas e
   * Brasília não compartilham nada). Admin de loja vê e muda só a dela; a dona
   * escolhe a loja. Quem decide é o servidor (lojaDaConfiguracao).
   */
  const cfg = await lojaDaConfiguracao(profile, (await searchParams).loja)
  if (!cfg) redirect('/')

  const admin = createAdminClient()
  const { data, error } = await admin.from('settings').select('key, value, description')
    .eq('store_id', cfg.loja.id).not('key', 'like', 'meta_loja:%').order('key')
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
      <SeletorLojaConfig lojas={cfg.lojas} lojaId={cfg.loja.id} href="/configuracoes/negocio" />
      <ConfiguracoesNegocioClient key={cfg.loja.id} settings={settings} storeId={cfg.loja.id} />
    </div>
  )
}
