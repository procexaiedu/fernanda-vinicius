'use client'

import { useState, useMemo, useCallback } from 'react'

/**
 * Ordenação por clique no título da coluna.
 *
 * Existia solta em /clientes e /fornecedores, cada uma com sua cópia. Aqui vira
 * uma só, para valer em todas as tabelas.
 *
 * Regras de comportamento, todas deliberadas:
 * - Primeiro clique numa coluna nova entra DESCENDENTE em número e data (o que
 *   interessa é o maior e o mais recente) e ASCENDENTE em texto (A-Z).
 * - Clicar de novo inverte. Um terceiro clique volta à ordem original — dá para
 *   desfazer sem recarregar a página.
 * - Nulo sempre no fim, independente da direção: uma peça sem última venda não é
 *   "a mais antiga", é ausência de informação.
 * - Texto compara com `localeCompare('pt-BR')`, senão "Ângela" cai depois de "Zuleica".
 */

export type Direcao = 'asc' | 'desc'

export interface ColunaOrdenavel<T> {
  /** Como extrair o valor de comparação da linha. */
  valor: (item: T) => string | number | null | undefined
  /** 'texto' ordena A-Z no primeiro clique; 'numero' e 'data', do maior/mais recente. */
  tipo?: 'texto' | 'numero' | 'data'
}

export function useOrdenacao<T, K extends string>(
  itens: T[],
  colunas: Record<K, ColunaOrdenavel<T>>,
  inicial?: { chave: K; direcao: Direcao },
) {
  /*
   * Chave e direção vivem no MESMO estado.
   *
   * A primeira versão usava dois `useState` e, no terceiro clique, decidia se
   * desligava dentro do updater de `setDirecao` para devolver o resultado no
   * updater de `setChave`. Os dois updaters rodam em momentos distintos, então a
   * variável lida já estava desatualizada e o terceiro clique nunca desligava —
   * pego no teste, não na leitura do código. Com um objeto só, a transição é
   * calculada de uma vez a partir do estado corrente.
   */
  const [estado, setEstado] = useState<{ chave: K | null; direcao: Direcao }>({
    chave: inicial?.chave ?? null,
    direcao: inicial?.direcao ?? 'desc',
  })
  const { chave, direcao } = estado

  const alternar = useCallback((nova: K) => {
    setEstado(atual => {
      const padrao: Direcao = (colunas[nova]?.tipo ?? 'texto') === 'texto' ? 'asc' : 'desc'

      // Coluna nova: entra na direção padrão do tipo dela.
      if (atual.chave !== nova) return { chave: nova, direcao: padrao }

      // Mesma coluna, ainda no padrão: inverte.
      if (atual.direcao === padrao) {
        return { chave: nova, direcao: padrao === 'asc' ? 'desc' : 'asc' }
      }

      // Mesma coluna, já invertida: terceiro clique desliga e volta à ordem original.
      return { chave: null, direcao: padrao }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colunas])

  const ordenados = useMemo(() => {
    if (!chave) return itens
    const col = colunas[chave]
    if (!col) return itens

    return [...itens].sort((a, b) => {
      const va = col.valor(a)
      const vb = col.valor(b)

      // Ausência de informação vai para o fim SEMPRE — não é "o menor valor".
      const aVazio = va === null || va === undefined || va === ''
      const bVazio = vb === null || vb === undefined || vb === ''
      if (aVazio && bVazio) return 0
      if (aVazio) return 1
      if (bVazio) return -1

      let cmp: number
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
      else cmp = String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })

      return direcao === 'asc' ? cmp : -cmp
    })
  }, [itens, chave, direcao, colunas])

  return { ordenados, chave, direcao, alternar }
}
