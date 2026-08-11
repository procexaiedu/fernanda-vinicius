import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicUrl } from '@/lib/request-url'

export async function proxy(request: NextRequest) {
  const response = NextResponse.next()
  const pathname = request.nextUrl.pathname

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cs) =>
          cs.forEach((c) => response.cookies.set(c.name, c.value, c.options)),
      },
    }
  )

  // Mantido: além de autenticar, é aqui que a sessão é renovada e os cookies
  // atualizados são gravados na response. Remover causaria logout ao expirar o
  // access token.
  const { data: { user } } = await supabase.auth.getUser()

  // /login e /api/* são sempre acessíveis — sem autenticação prévia necessária
  if (!user && pathname !== '/login' && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(publicUrl(request, '/login'))
  }

  // A checagem de conta inativa saiu daqui: custava um round trip ao banco em
  // TODA navegação. Agora é feita uma vez por requisição em `requireProfile()`
  // (src/lib/auth.ts), que toda página protegida usa — inclusive /pdv, que antes
  // não validava `is_active` e dependia só deste ponto.
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
