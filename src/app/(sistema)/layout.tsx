import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireProfile, ehOperadora } from '@/lib/auth'
import { CABECALHO_CAMINHO } from '@/lib/auth-header'
import SistemaLayoutClient from './layout-client'

/**
 * O que a operadora alcança — por URL, não por menu.
 *
 * Esconder item da barra lateral não é controle de acesso: basta digitar
 * `/produtos` no endereço. Quatro telas (`/clientes`, `/disparos`, `/estoque`,
 * `/produtos`) não tinham trava nenhuma até 01/09.
 *
 * A trava mora AQUI, no layout, porque é o único ponto por onde toda página do
 * sistema passa. E é uma LISTA DO QUE PODE, não do que não pode: tela nova
 * nasce fora do alcance dela até alguém decidir o contrário. Uma lista de
 * proibições esqueceria a próxima.
 */
const OPERADORA_PODE = [
  '/pdv',        // atender e fechar a venda
  '/vendas',     // as vendas do dia — a query já limita a hoje
]

function operadoraPodeVer(pathname: string): boolean {
  return OPERADORA_PODE.some(p => pathname === p || pathname.startsWith(p + '/'))
}

export default async function SistemaLayout({ children }: { children: React.ReactNode }) {
  // Um único round trip: perfil + nome da loja vêm juntos pelo join, e o resultado
  // fica memoizado para todas as páginas desta mesma requisição.
  const profile = await requireProfile()

  if (ehOperadora(profile)) {
    /*
     * O proxy põe o caminho num cabeçalho interno que ele mesmo apaga antes de
     * escrever — ver src/lib/auth-header.ts.
     *
     * Cabeçalho ausente NÃO bloqueia, e isso é deliberado: `redirect('/pdv')`
     * volta a passar por este mesmo layout, que sem o cabeçalho redirecionaria
     * de novo — laço infinito, que derruba o sistema inteiro para todo mundo.
     * Por isso cada tela fechada também tem a sua própria trava; esta aqui é a
     * rede que pega as que vierem depois, não a única.
     */
    const caminho = (await headers()).get(CABECALHO_CAMINHO) ?? ''
    if (caminho && !operadoraPodeVer(caminho)) redirect('/pdv')
  }

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
