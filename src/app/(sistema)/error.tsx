'use client'

import { useEffect } from 'react'
import Button from '@/components/ui/Button'

/*
 * Tela de falha das páginas do sistema.
 *
 * As leituras deixaram de devolver lista pela metade em silêncio (fetchAll,
 * painel, estoque): em falha elas LANÇAM, porque catálogo incompleto no PDV
 * vira "código não encontrado" para uma peça que está na gaveta. Sem este
 * arquivo, o lançamento caía na tela genérica do Next, em inglês.
 *
 * Fica dentro do layout de (sistema): menu e cabeçalho continuam no lugar,
 * só o miolo da tela troca.
 */
export default function ErroDaTela({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[tela] falha ao carregar:', error) }, [error])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: '64px 24px', textAlign: 'center', color: 'var(--text-secondary)',
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
