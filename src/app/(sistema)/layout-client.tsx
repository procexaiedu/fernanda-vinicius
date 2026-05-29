'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import styles from './layout.module.css'

interface SistemaLayoutClientProps {
  userName: string
  userRole: 'admin' | 'operator'
  storeName?: string
  children: React.ReactNode
}

export default function SistemaLayoutClient({
  userName,
  userRole,
  storeName,
  children,
}: SistemaLayoutClientProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    // Sidebar: em telas compactas (≤1366) recolhe sozinha; em telas grandes
    // usa a preferência salva. matchMedia dispara só ao cruzar o breakpoint.
    const mq = window.matchMedia('(max-width: 1366px)')
    const savedPref = () => localStorage.getItem('fv-sidebar-collapsed') === 'true'
    const apply = () => setCollapsed(mq.matches ? true : savedPref())
    apply()
    mq.addEventListener('change', apply)

    // Tema — sincroniza com o que o anti-flash script já aplicou
    const savedTheme = localStorage.getItem('fv-theme')
    if (savedTheme === 'light') setTheme('light')

    return () => mq.removeEventListener('change', apply)
  }, [])

  // Toggle manual — funciona em qualquer tela e persiste a preferência.
  function toggleSidebar() {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('fv-sidebar-collapsed', String(next))
      return next
    })
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('fv-theme', next)
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }

  return (
    <div className={styles.root}>
      <Sidebar userRole={userRole} collapsed={collapsed} onToggle={toggleSidebar} />
      <div className={`${styles.main} ${collapsed ? styles.mainCollapsed : ''}`}>
        <Header
          userName={userName}
          userRole={userRole}
          storeName={storeName}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  )
}
