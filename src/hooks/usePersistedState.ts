'use client'

import { useState, useEffect, useRef } from 'react'

/**
 * useState que persiste no localStorage (por navegador) — para lembrar filtros
 * de cada módulo entre acessos, sem banco.
 *
 * Uso: troque `useState(inicial)` por `usePersistedState('fv-filtros-vendas', inicial)`.
 * A chave deve ser única por módulo (prefixo `fv-filtros-<modulo>`).
 *
 * SSR-safe: começa com o `initial` no server e no primeiro render do client;
 * carrega o valor salvo logo após montar. Só grava depois de carregar, para não
 * sobrescrever o salvo com o valor inicial.
 */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial)
  const loaded = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) setState(JSON.parse(raw) as T)
    } catch { /* quota/privado/JSON inválido — ignora */ }
    loaded.current = true
  }, [key])

  useEffect(() => {
    if (!loaded.current) return
    try { localStorage.setItem(key, JSON.stringify(state)) } catch { /* ignora */ }
  }, [key, state])

  return [state, setState]
}
