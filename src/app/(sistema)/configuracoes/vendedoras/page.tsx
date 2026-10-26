import { redirect } from 'next/navigation'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PageHeader from '@/components/ui/PageHeader'
import VendedorasClient from './VendedorasClient'

export default async function VendedorasPage() {
  const perfil = await requireProfile()
  if (perfil.role !== 'admin') redirect('/pdv')
  const loja = lojaDoEscopo(perfil)
  const admin = createAdminClient()
  let pessoas = admin.from('sellers').select('id, full_name, store_id, is_active').order('full_name')
  let lojas = admin.from('stores').select('id, name').eq('is_active', true).order('name')
  if (loja) { pessoas = pessoas.eq('store_id', loja); lojas = lojas.eq('id', loja) }
  const [p, l] = await Promise.all([pessoas, lojas])
  if (p.error || l.error) throw new Error('Não foi possível carregar o cadastro de vendedoras. Tente novamente.')
  return <div><PageHeader title="Vendedoras" subtitle="Cadastre quem vende em cada loja. O acesso ao sistema continua em Usuários." /><VendedorasClient pessoas={p.data ?? []} lojas={l.data ?? []} /></div>
}
