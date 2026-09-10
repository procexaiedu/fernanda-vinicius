import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile, ehAdminGlobal } from '@/lib/auth'
import EscolherLojaClient from './EscolherLojaClient'

/**
 * A porta de entrada do admin global.
 *
 * Pedido da dona em 09/09, repetido de várias formas até ficar claro: *"eu
 * quero abrir o sistema e ver só Campinas. Aí fecha o sistema, abre o sistema e
 * vejo como se fosse dois clientes"*. Ela chegou a pedir dois domínios; o
 * acordo foi este — escolhe ao entrar e fica naquela loja até trocar de
 * propósito.
 *
 * Quem tem loja própria (Eleandra, operadoras) NUNCA vê esta tela. Nas palavras
 * do Lucas na reunião: *"a Leandra, como a conta dela é só Brasília, não tem
 * botão"*.
 */
export default async function EscolherLojaPage() {
  const profile = await requireProfile()

  // Quem tem loja fixa não escolhe — e quem já escolheu não precisa voltar aqui.
  if (!ehAdminGlobal(profile)) redirect('/')
  if (profile.lojaSelecionada) redirect('/')

  const admin = createAdminClient()
  const { data: lojas } = await admin
    .from('stores')
    .select('id, name, city')
    .eq('is_active', true)
    .order('name')

  return (
    <EscolherLojaClient
      nome={profile.full_name}
      lojas={(lojas ?? []) as { id: string; name: string; city: string | null }[]}
    />
  )
}
