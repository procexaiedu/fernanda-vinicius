'use client'

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

  return (
    <nav className={styles.nav}>
      {tabs.map(tab => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`${styles.tab} ${pathname.startsWith(tab.href) ? styles.tabActive : ''}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
