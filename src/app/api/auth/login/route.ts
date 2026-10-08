import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicUrl } from '@/lib/request-url'
import { bloqueiaNoCelular, ehCelular } from '@/lib/acessoCelular'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // Monta redirect de sucesso com cookies na response (padrão correto do @supabase/ssr).
  // `publicUrl` em vez de `request.url`: atrás do Traefik, `request.url` aponta para
  // localhost:3000 (host interno do container) e o navegador era jogado lá.
  const response = NextResponse.redirect(publicUrl(request, '/'), { status: 303 })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        // Cookies de sessão escritos diretamente na response de redirect
        setAll: (cs) =>
          cs.forEach((c) => response.cookies.set(c.name, c.value, c.options)),
      },
    }
  )

  const { data: entrada, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.redirect(
      publicUrl(request, '/login?error=invalid'),
      { status: 303 }
    )
  }

  /*
   * Vendedora no celular não entra (reunião de 06/10/2026): só a gerência usa
   * o sistema fora do computador da loja. Barrar AQUI, e não só no layout,
   * evita deixar a sessão aberta no aparelho dela. Sem perfil legível, deixa
   * entrar: o layout barra de novo, e um soluço do banco não tranca a loja.
   */
  if (ehCelular(request.headers.get('user-agent'), request.headers.get('sec-ch-ua-mobile'))) {
    const { data: perfil } = await supabase
      .from('users').select('role').eq('id', entrada.user.id).maybeSingle()
    if (perfil && bloqueiaNoCelular(perfil.role as 'admin' | 'operator')) {
      await supabase.auth.signOut()
      // Resposta nova, sem os cookies da sessão que acabou de ser criada.
      return NextResponse.redirect(publicUrl(request, '/login?error=celular'), { status: 303 })
    }
  }

  return response
}
