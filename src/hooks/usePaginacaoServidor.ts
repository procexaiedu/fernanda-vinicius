'use client'

import { useState, useMemo, useEffect } from 'react'
import { POR_PAGINA } from '@/components/ui/Paginacao'

/**
 * Paginação encadeada, para listas que o SERVIDOR já pagina em lotes grandes
 * (/produtos e /estoque, 50 por lote).
 *
 * A pessoa vê uma numeração contínua de 10 em 10. Por baixo, cada lote de 50 do
 * servidor rende 5 páginas de tela: as 5 são instantâneas e só a 6ª dispara nova
 * consulta. Medido: cada ida ao servidor custa ~500ms, então paginar 1031 produtos
 * de 10 em 10 direto no servidor seriam 104 esperas — deste jeito são 21.
 *
 *   página vista:   1   2   3   4   5  │  6   7   8   9  10  │ 11 …
 *   lote servidor:  └────── 1 ─────────┘  └────── 2 ─────────┘
 *   custo:          0ms nas 5            500ms na virada
 */
export function usePaginacaoServidor<T>({
  itens, paginaServidor, porLoteServidor, totalItens, irParaPaginaServidor, carregando,
}: {
  /** O lote atual, como veio do servidor. */
  itens: T[]
  /** 1-based, o número de lote que o servidor entregou. */
  paginaServidor: number
  /** Tamanho do lote (50). */
  porLoteServidor: number
  /** Total geral, para saber quantas páginas de tela existem. */
  totalItens: number
  irParaPaginaServidor: (n: number) => void
  carregando?: boolean
}) {
  const porTela = POR_PAGINA
  const paginasPorLote = Math.max(1, Math.floor(porLoteServidor / porTela))

  // Página VISTA (numeração contínua). Começa na primeira do lote atual.
  const primeiraDoLote = (paginaServidor - 1) * paginasPorLote + 1
  const [pagina, setPagina] = useState(primeiraDoLote)

  /*
   * Quando um novo lote chega, reposiciona. `alvo` guarda para onde a pessoa
   * pediu para ir: sem isso, pular da página 5 para a 6 traria o lote 2 e
   * mostraria a página 6 (correto), mas voltar da 6 para a 5 traria o lote 1 e
   * mostraria a página 1 — um salto que ela não pediu.
   */
  const [alvo, setAlvo] = useState<number | null>(null)

  useEffect(() => {
    const primeira = (paginaServidor - 1) * paginasPorLote + 1
    const ultima = primeira + paginasPorLote - 1
    if (alvo !== null && alvo >= primeira && alvo <= ultima) {
      setPagina(alvo)
      setAlvo(null)
    } else if (pagina < primeira || pagina > ultima) {
      setPagina(primeira)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginaServidor, itens])

  const totalPaginas = Math.max(1, Math.ceil(totalItens / porTela))

  const fatia = useMemo(() => {
    const dentroDoLote = (pagina - 1) % paginasPorLote
    return itens.slice(dentroDoLote * porTela, (dentroDoLote + 1) * porTela)
  }, [itens, pagina, paginasPorLote, porTela])

  function irPara(n: number) {
    const destino = Math.min(Math.max(1, n), totalPaginas)
    const loteNecessario = Math.floor((destino - 1) / paginasPorLote) + 1
    if (loteNecessario !== paginaServidor) {
      // Troca de lote: guarda o destino e deixa o servidor responder.
      setAlvo(destino)
      irParaPaginaServidor(loteNecessario)
    } else {
      setPagina(destino)
    }
  }

  return { fatia, pagina, totalPaginas, totalItens, irPara, carregando }
}
