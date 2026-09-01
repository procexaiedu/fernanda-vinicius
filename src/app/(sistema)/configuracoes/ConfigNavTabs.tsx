'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './ConfigNavTabs.module.css'

const tabs = [
  { label: 'Lojas',     href: '/configuracoes/lojas' },
  { label: 'Usuários',  href: '/configuracoes/usuarios' },
  { label: 'Metas',     href: '/configuracoes/metas' },
  { label: 'Negócio',   href: '/configuracoes/negocio' },
  { label: 'Impressão', href: '/configuracoes/impressao' },
]

export default function ConfigNavTabs() {
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)
  /* 'nenhum' | 'inicio' | 'fim' | 'ambos' — qual borda esmaece. */
  const [esmaece, setEsmaece] = useState<'nenhum' | 'inicio' | 'fim' | 'ambos'>('nenhum')

  /*
   * A fileira rola na horizontal no telefone, e rolagem sem borda esmaecida não
   * avisa que há mais aba fora da tela — quem abria em 390px via "Lojas … Metas"
   * cortado no meio e não tinha motivo para arrastar. O esmaecimento aparece só
   * do lado em que ainda há conteúdo, senão vira enfeite permanente.
   */
  const medir = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const sobra = nav.scrollWidth - nav.clientWidth
    /* 2px de folga: `scrollLeft` fracionário (zoom, DPI) nunca bate exato no fim. */
    if (sobra <= 2) return setEsmaece('nenhum')
    const noInicio = nav.scrollLeft <= 2
    const noFim = nav.scrollLeft >= sobra - 2
    setEsmaece(noInicio ? 'fim' : noFim ? 'inicio' : 'ambos')
  }, [])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [medir])

  /*
   * Trazer a aba ativa para o campo de visão ao entrar pela URL: quem abre
   * /configuracoes/impressao direto no telefone caía com a fileira no começo e a
   * aba em que está fora da tela — nada indicava onde ele estava.
   *
   * `scrollTo` no próprio contêiner, e não `scrollIntoView`: este último também
   * rola a PÁGINA na vertical, e o cabeçalho saía do lugar a cada troca de aba.
   */
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const ativa = nav.querySelector<HTMLElement>('[data-ativa="true"]')
    if (!ativa) return
    if (nav.scrollWidth <= nav.clientWidth) return
    nav.scrollTo({
      left: ativa.offsetLeft - (nav.clientWidth - ativa.offsetWidth) / 2,
      behavior: 'smooth',
    })
  }, [pathname])

  return (
    <div className={styles.wrap}>
      <nav ref={navRef} className={styles.nav} data-esmaece={esmaece} onScroll={medir}>
        {tabs.map(tab => {
          const ativa = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-ativa={ativa}
              aria-current={ativa ? 'page' : undefined}
              className={`tab ${ativa ? 'tab-active' : ''}`}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
