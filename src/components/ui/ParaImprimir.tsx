'use client'

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import styles from './ParaImprimir.module.css'

/**
 * Documento que abre DENTRO de um modal mas precisa sair inteiro no papel.
 *
 * O problema: o Modal tem altura máxima e rolagem (`overflow-y: auto`), e o
 * navegador imprime o que está dentro de um contêiner com rolagem cortado na
 * altura dele. Um romaneio ou uma compra de 300 peças saía com a primeira
 * página e o resto sumia — sem erro, só papel faltando. As folhas antigas
 * tentavam contornar com `body { visibility: hidden }` + `position: absolute`,
 * mas visibilidade não desfaz o corte do contêiner (revisão de 16/09).
 *
 * A saída: mostra o conteúdo normal na tela e, ao mesmo tempo, monta uma CÓPIA
 * direto no `<body>`, fora de qualquer modal. A cópia fica escondida na tela e
 * é a única coisa visível na impressão — sem pai com rolagem, ela pagina.
 */
export default function ParaImprimir({ children }: { children: React.ReactNode }) {
  // `document` só existe no navegador. Sem efeito com setState (regra
  // react-hooks/set-state-in-effect): o store devolve true no cliente.
  const noNavegador = useSyncExternalStore(() => () => {}, () => true, () => false)

  return (
    <>
      {children}
      {noNavegador && createPortal(
        <div data-impressao className={styles.copia} aria-hidden>
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
