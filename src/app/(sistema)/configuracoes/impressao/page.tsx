import { requireProfile } from '@/lib/auth'
import { lojaDaSessaoParaConfig } from '@/lib/lojasQueAdministra'
import { createAdminClient } from '@/lib/supabase/admin'
import ImpressaoClient from './ImpressaoClient'
import CategoryMappingPanel from './CategoryMappingPanel'
import type { CategoryMapping } from './actions'
import styles from './page.module.css'
import PageHeader from '@/components/ui/PageHeader'

export default async function ImpressaoConfigPage() {
  const profile = await requireProfile()


  /*
   * O painel de categoria x etiqueta é da LOJA desde 16/10/2026. Admin de loja
   * mexe só na dela; a dona vê a loja escolhida no "Trocar" do menu (?loja= é ignorado). Operadora não vê o painel. O
   * agente de impressão local (acima) segue disponível: é o computador dela.
   */
  const loja = await lojaDaSessaoParaConfig(profile)

  let mappings: CategoryMapping[] = []
  if (loja) {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('category_label_mapping')
      .select('category, label_format')
      .eq('store_id', loja.id)
      .eq('is_active', true)
      .order('category')
    if (error || !data) throw new Error('Não consegui ler as etiquetas por categoria.')
    mappings = data as CategoryMapping[]
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Impressão de etiquetas"
        subtitle={<>Configure o agente local de impressão (<code>fv-print-agent</code>) que envia os jobs PPLA à impressora térmica Argox.</>}
      />
      <div className={styles.grid}>
        <ImpressaoClient />
        {loja && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <CategoryMappingPanel key={loja.id} initialMappings={mappings} storeId={loja.id} />
          </div>
        )}
      </div>
    </div>
  )
}
