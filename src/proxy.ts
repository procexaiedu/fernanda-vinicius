import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicUrl } from '@/lib/request-url'
import { CABECALHO_USUARIO, CABECALHO_CAMINHO } from '@/lib/auth-header'
import { MSG_AUTH_INSTAVEL, MSG_SESSAO_EXPIRADA } from '@/lib/erroDeSalvar'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // A sessão é renovada durante o getUser() abaixo, e os cookies novos precisam
  // ir na response — que só pode ser criada DEPOIS, porque os cabeçalhos da
  // requisição dependem de quem o usuário é. Daí guardar e aplicar no fim.
  const cookiesParaGravar: Array<{ name: string; value: string; options?: object }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        /*
         * Os cookies renovados vão para a response (navegador) E para a própria
         * requisição (página/server action que roda depois deste proxy).
         *
         * Antes só iam para a response: a action recebia o refresh token VELHO,
         * o `createClient` dela tentava renovar de novo com um token que o
         * GoTrue já tinha rotacionado — fora da janela de reuso, a sessão era
         * revogada. Candidata forte a "a sessão cai no meio do lançamento".
         * É o padrão documentado do @supabase/ssr.
         */
        setAll: (cs) => cs.forEach((c) => {
          cookiesParaGravar.push(c)
          request.cookies.set(c.name, c.value)
        }),
      },
    }
  )

  /*
   * Mantido: além de autenticar, é aqui que a sessão é renovada e os cookies
   * atualizados são gravados na response. Remover causaria logout ao expirar o
   * access token.
   *
   * Uma nova tentativa quando o Auth falha por instabilidade (5xx/rede).
   *
   * O "broken pipe" de 30/09 é o GoTrue usando uma conexão com o Postgres que
   * a rede do Swarm já tinha cortado por ociosidade: a primeira consulta falha
   * e a seguinte, numa conexão nova, passa. Sem repetir, esse soluço virava
   * redirect para /login — a "sessão caindo" no meio do lançamento. Erro 4xx
   * (token inválido de verdade) não repete: aí é sessão vencida mesmo.
   */
  const instavel = (e: { status?: number } | null) => !!e && (!e.status || e.status >= 500)
  let { data: { user }, error: erroAuth } = await supabase.auth.getUser()
  if (!user && instavel(erroAuth)) {
    await new Promise(r => setTimeout(r, 250))
    ;({ data: { user }, error: erroAuth } = await supabase.auth.getUser())
  }

  // Cabeçalhos que seguem para a aplicação — montados DEPOIS do getUser() para
  // levar o cookie renovado (ver setAll acima). O valor que veio do cliente é
  // apagado: quem escreve esse cabeçalho é só este proxy, depois de validar o
  // token. Ver src/lib/auth-header.ts.
  const headers = new Headers(request.headers)
  headers.delete(CABECALHO_USUARIO)
  // Mesma regra para o caminho: forjar `x-fv-pathname` daria à operadora acesso
  // a qualquer tela. Só o proxy escreve.
  headers.delete(CABECALHO_CAMINHO)

  // /login e /api/* são sempre acessíveis — sem autenticação prévia necessária
  if (!user && pathname !== '/login' && !pathname.startsWith('/api/')) {
    /*
     * Server action (o "Salvar" de venda, compra, transferência…) NÃO pode
     * receber redirect: o navegador segue para /login, recebe HTML e o Next
     * mostra "An unexpected response was received from the server" — foi o
     * que a dona viu em 30/09 com 47 linhas de consignação na tela.
     *
     * Respondendo text/plain com status de erro, o Next entrega ESTE texto ao
     * formulário, e src/lib/erroDeSalvar.ts o traduz em instrução: entrar de
     * novo em outra aba e clicar em Salvar aqui, sem perder a tela.
     *
     * Auth fora do ar (5xx, rede) não é sessão vencida: o Auth já teve
     * "broken pipe" com o Postgres. Nesse caso é "tente de novo", não "entre".
     */
    if (request.method === 'POST' && request.headers.has('next-action')) {
      const authInstavel = instavel(erroAuth)
      const resposta = new NextResponse(
        authInstavel ? MSG_AUTH_INSTAVEL : MSG_SESSAO_EXPIRADA,
        { status: authInstavel ? 503 : 401, headers: { 'content-type': 'text/plain' } },
      )
      for (const c of cookiesParaGravar) resposta.cookies.set(c.name, c.value, c.options)
      return resposta
    }

    const redirecionamento = NextResponse.redirect(publicUrl(request, '/login'))
    // Os cookies renovados vão também no redirect: sem isso, uma sessão que
    // acabou de ser renovada perderia a renovação ao ser mandada para /login.
    for (const c of cookiesParaGravar) redirecionamento.cookies.set(c.name, c.value, c.options)
    return redirecionamento
  }

  // Este token já está validado. A página lê o id daqui em vez de fazer a mesma
  // chamada de rede de novo (~200ms economizados por navegação).
  if (user) headers.set(CABECALHO_USUARIO, user.id)

  // Qual tela está sendo aberta. O layout de (sistema) usa isto para barrar a
  // operadora fora do PDV e das vendas — ver src/lib/auth-header.ts.
  headers.set(CABECALHO_CAMINHO, pathname)

  // A checagem de conta inativa saiu daqui: custava um round trip ao banco em
  // TODA navegação. Agora é feita uma vez por requisição em `requireProfile()`
  // (src/lib/auth.ts), que toda página protegida usa — inclusive /pdv, que antes
  // não validava `is_active` e dependia só deste ponto.
  const response = NextResponse.next({ request: { headers } })
  for (const c of cookiesParaGravar) response.cookies.set(c.name, c.value, c.options)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
