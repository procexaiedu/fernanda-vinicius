'use client'

import { useEffect } from 'react'

/*
 * Última rede: erro no LAYOUT RAIZ (ou em algo que o `error.tsx` da raiz não
 * alcança). Aqui o layout raiz foi substituído — não há <html>/<body> dele, e
 * o globals.css pode nem ter carregado. Por isso: <html>/<body> próprios,
 * nenhum componente do sistema e cores FIXAS do tema escuro (os mesmos
 * valores de --bg-base/--text-* em globals.css), em estilo inline.
 *
 * Mesmo texto das outras telas de falha — ver src/app/(sistema)/error.tsx.
 */
export default function ErroGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[global] falha ao carregar:', error) }, [error])

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: '#0B0B0E', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, padding: '64px 24px', textAlign: 'center', color: '#A1A1AA', minHeight: '100vh',
          boxSizing: 'border-box',
        }}>
          <p style={{ fontSize: 15, color: '#F4F4F5', fontWeight: 600, margin: 0 }}>
            Não foi possível carregar esta tela agora.
          </p>
          <p style={{ fontSize: 13, margin: 0, maxWidth: 420 }}>
            Foi uma falha momentânea de conexão com o servidor. Nada do que já estava salvo foi perdido.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#F4F4F5', color: '#0D0D0D', border: 'none', borderRadius: 8,
              padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  )
}
