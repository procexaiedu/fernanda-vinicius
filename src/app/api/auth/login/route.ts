import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // Monta redirect de sucesso com cookies na response (padrão correto do @supabase/ssr)
  const redirectTo = new URL('/', request.url)
  const response = NextResponse.redirect(redirectTo, { status: 303 })

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

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.redirect(
      new URL('/login?error=invalid', request.url),
      { status: 303 }
    )
  }

  return response
}
