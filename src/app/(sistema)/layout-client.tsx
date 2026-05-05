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

  useEffect(() => {
    const stored = localStorage.getItem('fv-sidebar-collapsed')
    if (stored !== null) setCollapsed(stored === 'true')

    const handler = () => {
      const val = localStorage.getItem('fv-sidebar-collapsed')
      setCollapsed(val === 'true')
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  return (
    <div className={styles.root}>
      <Sidebar userRole={userRole} />
      <div className={`${styles.main} ${collapsed ? styles.mainCollapsed : ''}`}>
        <Header userName={userName} userRole={userRole} storeName={storeName} />
        <main className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  )
}
