import type { NextRequest } from 'next/server'

/**
 * Monta uma URL absoluta usando o host PÚBLICO da requisição.
 *
 * O problema que isto resolve: em produção o container escuta em 0.0.0.0:3000 e o
 * Traefik faz o proxy. Nesse arranjo `request.url` carrega o endereço interno
 * (`http://localhost:3000/...`), então qualquer `new URL(path, request.url)` usado
 * em redirect manda o navegador para `localhost:3000` — que não existe na máquina
 * da funcionária. Era a causa do "bug da página 3000" ao logar.
 *
 * Aqui a origem sai de `x-forwarded-proto` / `x-forwarded-host`, que o Traefik
 * preenche. Sem esses headers (dev local) cai no host da própria requisição, então
 * `localhost:3000` continua funcionando em desenvolvimento.
 */
export function publicUrl(request: NextRequest, path: string): URL {
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    request.nextUrl.protocol.replace(':', '')

  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    request.headers.get('host') ||
    request.nextUrl.host

  return new URL(path, `${proto}://${host}`)
}
