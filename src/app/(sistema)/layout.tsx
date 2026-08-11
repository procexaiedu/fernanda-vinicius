import { requireProfile } from '@/lib/auth'
import SistemaLayoutClient from './layout-client'

export default async function SistemaLayout({ children }: { children: React.ReactNode }) {
  // Um único round trip: perfil + nome da loja vêm juntos pelo join, e o resultado
  // fica memoizado para todas as páginas desta mesma requisição.
  const profile = await requireProfile()

  return (
    <SistemaLayoutClient
      userName={profile.full_name}
      userRole={profile.role}
      storeName={profile.store_name}
    >
      {children}
    </SistemaLayoutClient>
  )
}
