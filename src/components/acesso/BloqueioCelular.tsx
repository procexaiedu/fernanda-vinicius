'use client'

import { useSyncExternalStore } from 'react'
import UseOComputador from './UseOComputador'

/*
 * Segunda camada do bloqueio de celular, no navegador.
 *
 * O servidor já barra pelo User-Agent (layout de (sistema)). Sobra o aparelho
 * que se diz computador: iPad e celular em "versão para computador". O que o
 * denuncia é não ter mouse nem trackpad, e tela estreita. Notebook com tela de
 * toque tem trackpad (`any-pointer: fine`), então passa.
 */
const CONSULTA = '(any-pointer: fine)'

function assinar(cb: () => void) {
  const mq = window.matchMedia(CONSULTA)
  mq.addEventListener('change', cb)
  window.addEventListener('resize', cb)
  return () => { mq.removeEventListener('change', cb); window.removeEventListener('resize', cb) }
}

function semMouseETelaPequena(): boolean {
  return !window.matchMedia(CONSULTA).matches && window.innerWidth < 1100
}

export default function BloqueioCelular({ nome, children }: { nome?: string | null; children: React.ReactNode }) {
  // No servidor: não bloqueia (o servidor já decidiu pelo User-Agent).
  const bloqueia = useSyncExternalStore(assinar, semMouseETelaPequena, () => false)
  if (bloqueia) return <UseOComputador nome={nome} />
  return <>{children}</>
}
