'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getHealth,
  listPrinters,
  getDefaultPrinter,
  setDefaultPrinter,
  type PrinterInfo,
  type AgentHealth,
} from './printAgent'

export type AgentStatus = 'checking' | 'online' | 'offline'

export interface UseLocalPrintAgentResult {
  status: AgentStatus
  health: AgentHealth | null
  printers: PrinterInfo[]
  /** Impressora preferencial: localStorage > heurística "argox" > default do SO > primeira. */
  selectedPrinter: string | null
  setSelectedPrinter: (name: string | null) => void
  error: string | null
  refresh: () => void
}

const REFRESH_INTERVAL_MS = 30_000

function pickPreferredPrinter(printers: PrinterInfo[], stored: string | null): string | null {
  if (printers.length === 0) return null
  if (stored && printers.some(p => p.name === stored)) return stored
  const argox = printers.find(p => /argox/i.test(p.name))
  if (argox) return argox.name
  const def = printers.find(p => p.isDefault)
  if (def) return def.name
  return printers[0].name
}

export function useLocalPrintAgent(): UseLocalPrintAgentResult {
  const [status, setStatus] = useState<AgentStatus>('checking')
  const [health, setHealth] = useState<AgentHealth | null>(null)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const check = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const h = await getHealth(ctrl.signal)
      const ps = await listPrinters(ctrl.signal)
      if (ctrl.signal.aborted) return
      setHealth(h)
      setPrinters(ps)
      setSelected(prev => pickPreferredPrinter(ps, prev ?? getDefaultPrinter()))
      setStatus('online')
      setError(null)
    } catch (err) {
      if (ctrl.signal.aborted) return
      setStatus('offline')
      setHealth(null)
      setPrinters([])
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, REFRESH_INTERVAL_MS)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [check])

  const handleSetSelected = useCallback((name: string | null) => {
    setSelected(name)
    setDefaultPrinter(name)
  }, [])

  return {
    status,
    health,
    printers,
    selectedPrinter: selected,
    setSelectedPrinter: handleSetSelected,
    error,
    refresh: check,
  }
}
