import { redirect } from 'next/navigation'
import { requireProfile, podeConfigurarRede } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { Store } from '@/types'
import LojasClient from './LojasClient'
import styles from './page.module.css'
import PageHeader from '@/components/ui/PageHeader'

export default async function LojasPage() {

  const profile = await requireProfile()

  /*
   * Configuração é da REDE, não da loja: lojas, usuários, metas e regras do
   * negócio valem para as duas. `role !== 'admin'` deixava o admin de loja
   * entrar — de onde ele criava usuário e mudava a regra de desconto da outra
   * loja. Ver podeConfigurarRede() em src/lib/auth.ts.
   */
  if (!podeConfigurarRede(profile)) redirect('/')

  const supabase = await createClient()

  const { data: stores } = await supabase
    .from('stores')
    .select('*')
    .order('name', { ascending: true })

  return (
    <div className={styles.page}>
      <PageHeader title="Lojas" subtitle="Gerencie as lojas da sua rede." />
      <LojasClient stores={(stores as Store[]) ?? []} />
    </div>
  )
}
