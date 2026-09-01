import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicUrl } from '@/lib/request-url'
import { CABECALHO_USUARIO, CABECALHO_CAMINHO } from '@/lib/auth-header'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Cabeçalhos que seguem para a aplicação. O valor que veio do cliente é
  // apagado ANTES de qualquer coisa: quem escreve esse cabeçalho é só este
  // proxy, depois de validar o token. Ver src/lib/auth-header.ts.
  const headers = new Headers(request.headers)
  headers.delete(CABECALHO_USUARIO)
  // Mesma regra para o caminho: forjar `x-fv-pathname` daria à operadora acesso
  // a qualquer tela. Só o proxy escreve.
  headers.delete(CABECALHO_CAMINHO)

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
        setAll: (cs) => cs.forEach((c) => cookiesParaGravar.push(c)),
      },
    }
  )

  // Mantido: além de autenticar, é aqui que a sessão é renovada e os cookies
  // atualizados são gravados na response. Remover causaria logout ao expirar o
  // access token.
  const { data: { user } } = await supabase.auth.getUser()

  // /login e /api/* são sempre acessíveis — sem autenticação prévia necessária
  if (!user && pathname !== '/login' && !pathname.startsWith('/api/')) {
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
