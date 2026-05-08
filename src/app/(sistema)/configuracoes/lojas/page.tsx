import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Store } from '@/types'
import LojasClient from './LojasClient'
import styles from './page.module.css'

export default async function LojasPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/')

  const { data: stores } = await supabase
    .from('stores')
    .select('*')
    .order('name', { ascending: true })

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Lojas</h1>
        <p className={styles.subtitle}>Gerencie as lojas da sua rede.</p>
      </div>
      <LojasClient stores={(stores as Store[]) ?? []} />
    </div>
  )
}
