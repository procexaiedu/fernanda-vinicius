import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireProfile, ehOperadora, podeConfigurarRede, precisaEscolherLoja } from '@/lib/auth'
import { CABECALHO_CAMINHO } from '@/lib/auth-header'
import { operadoraPodeVer } from '@/lib/acessoOperadora'
import SistemaLayoutClient from './layout-client'

/*
 * O que a operadora alcança (lista do que PODE) mora em src/lib/acessoOperadora.ts.
 * A trava mora AQUI, no layout, porque é o único ponto por onde toda página do
 * sistema passa.
 */

export default async function SistemaLayout({ children }: { children: React.ReactNode }) {
  // Um único round trip: perfil + nome da loja vêm juntos pelo join, e o resultado
  // fica memoizado para todas as páginas desta mesma requisição.
  const profile = await requireProfile()

  /*
   * ADMIN GLOBAL ESCOLHE A LOJA ANTES DE QUALQUER TELA.
   *
   * Enquanto não escolhe, nenhuma página do sistema abre — senão ele veria a
   * rede inteira por um instante, que é justamente a mistura que a dona pediu
   * para acabar em 09/09.
   *
   * `/escolher-loja` vive FORA deste layout, de propósito: dentro dele a tela
   * apareceria com a barra lateral inteira, e clicar em qualquer menu cairia
   * neste mesmo redirect — um beco que parece o sistema travado. Fora, ela é o
   * que é: uma pergunta antes de entrar.
   *
   * Quem tem loja fixa nunca passa por aqui — `precisaEscolherLoja` só é
   * verdade para admin global.
   */
  if (precisaEscolherLoja(profile)) redirect('/escolher-loja')

  const caminhoAtual = (await headers()).get(CABECALHO_CAMINHO) ?? ''

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
    if (caminhoAtual && !operadoraPodeVer(caminhoAtual)) redirect('/pdv')
  }

  return (
    <SistemaLayoutClient
      userName={profile.full_name}
      userRole={profile.role}
      podeConfigurarRede={podeConfigurarRede(profile)}
      /* A loja que aparece na barra lateral é a do escopo: a fixa de quem tem
         uma, ou a escolhida na entrada pelo admin global. */
      storeName={profile.store_name ?? profile.lojaSelecionadaNome}
      podeTrocarDeLoja={!!profile.lojaSelecionada}
    >
      {children}
    </SistemaLayoutClient>
  )
}
