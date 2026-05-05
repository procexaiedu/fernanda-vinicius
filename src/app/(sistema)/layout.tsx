import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SistemaLayoutClient from './layout-client'

export default async function SistemaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, full_name, role, store_id, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) redirect('/login')

  // Buscar nome da loja se for operator
  let storeName: string | undefined
  if (profile.store_id) {
    const { data: store } = await supabase
      .from('stores')
      .select('name')
      .eq('id', profile.store_id)
      .single()
    storeName = store?.name
  }

  return (
    <SistemaLayoutClient
      userName={profile.full_name}
      userRole={profile.role as 'admin' | 'operator'}
      storeName={storeName}
    >
      {children}
    </SistemaLayoutClient>
  )
}
