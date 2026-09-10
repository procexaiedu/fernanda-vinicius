import { redirect } from 'next/navigation'
import { requireProfile, podeConfigurarRede } from '@/lib/auth'

/**
 * Cada admin cai na primeira aba que ele pode ver.
 *
 * Mandava todo mundo para `/configuracoes/lojas`, que é da rede — o admin de
 * loja chegava lá e era devolvido para a home, então o menu "Configurações"
 * parecia quebrado para ele.
 */
export default async function ConfiguracoesPage() {
  const profile = await requireProfile()
  redirect(podeConfigurarRede(profile) ? '/configuracoes/lojas' : '/configuracoes/usuarios')
}
