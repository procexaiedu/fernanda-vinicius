'use client'

import { useState, useMemo, useEffect } from 'react'
import { POR_PAGINA } from '@/components/ui/Paginacao'

/**
 * Paginação puramente local, para listas que já estão inteiras na memória
 * (/clientes com 760, /financeiro, /fornecedores, /disparos).
 *
 * Volta para a página 1 sempre que a lista muda de tamanho — sem isso, filtrar de
 * 760 para 3 resultados enquanto se está na página 40 mostra uma tabela vazia e
 * parece que o filtro não achou nada.
 */
export function usePaginacaoLocal<T>(itens: T[], porPagina = POR_PAGINA) {
  const [pagina, setPagina] = useState(1)

  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina))

  useEffect(() => { setPagina(1) }, [itens.length])

  // Rede de segurança: se a lista encolheu sem mudar de tamanho (troca de filtro
  // que mantém a contagem), a página atual pode ficar fora do intervalo.
  const paginaSegura = Math.min(pagina, totalPaginas)

  const fatia = useMemo(
    () => itens.slice((paginaSegura - 1) * porPagina, paginaSegura * porPagina),
    [itens, paginaSegura, porPagina],
  )

  return {
    fatia,
    pagina: paginaSegura,
    totalPaginas,
    totalItens: itens.length,
    irPara: setPagina,
  }
}
