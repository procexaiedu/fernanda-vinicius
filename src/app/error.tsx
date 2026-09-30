'use client'

import { useEffect } from 'react'
import Button from '@/components/ui/Button'

/*
 * Tela de falha FORA de (sistema) — e do próprio layout de (sistema).
 *
 * `getProfile` passou a LANÇAR quando a leitura do perfil falha (antes
 * devolvia "sem perfil" e a pessoa caía no login, achando que a senha tinha
 * expirado). Só que quem chama `getProfile` é o LAYOUT de (sistema), e o
 * `error.tsx` de um segmento não pega erro do layout do mesmo segmento — sobe
 * para o pai. Sem este arquivo, caía na tela genérica do Next, em inglês.
 *
 * Mesmo texto da tela de (sistema): é a mesma situação para quem está usando.
 * Aqui não há menu em volta (o layout que falhou é o que o desenha).
 */
export default function ErroDoApp({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[app] falha ao carregar:', error) }, [error])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: '64px 24px', textAlign: 'center', color: 'var(--text-secondary)',
      minHeight: '100vh',
    }}>
      <p style={{ fontSize: 15, color: 'var(--text-primary)', fontWeight: 600, margin: 0 }}>
        Não foi possível carregar esta tela agora.
      </p>
      <p style={{ fontSize: 13, margin: 0, maxWidth: 420 }}>
        Foi uma falha momentânea de conexão com o servidor. Nada do que já estava salvo foi perdido.
      </p>
      <Button onClick={() => reset()}>Tentar de novo</Button>
    </div>
  )
}
