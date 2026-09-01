import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import ImpressaoClient from './ImpressaoClient'
import CategoryMappingPanel from './CategoryMappingPanel'
import type { CategoryMapping } from './actions'
import styles from './page.module.css'
import PageHeader from '@/components/ui/PageHeader'

export default async function ImpressaoConfigPage() {
  const profile = await requireProfile()


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
    <div className={styles.page}>
      <PageHeader
        title="Impressão de etiquetas"
        subtitle={<>Configure o agente local de impressão (<code>fv-print-agent</code>) que envia os jobs PPLA à impressora térmica Argox.</>}
      />
      <div className={styles.grid}>
        <ImpressaoClient />
        {isAdmin && <CategoryMappingPanel initialMappings={mappings} />}
      </div>
    </div>
  )
}
