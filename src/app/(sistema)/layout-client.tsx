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
    // Sidebar
    const stored = localStorage.getItem('fv-sidebar-collapsed')
    if (stored !== null) setCollapsed(stored === 'true')

    const handler = () => {
      const val = localStorage.getItem('fv-sidebar-collapsed')
      setCollapsed(val === 'true')
    }
    window.addEventListener('storage', handler)

    // Tema — sincroniza com o que o anti-flash script já aplicou
    const savedTheme = localStorage.getItem('fv-theme')
    if (savedTheme === 'light') setTheme('light')

    return () => window.removeEventListener('storage', handler)
  }, [])

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
      <Sidebar userRole={userRole} />
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
