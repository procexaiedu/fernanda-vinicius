'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import styles from './layout.module.css'

/**
 * Telas que já tratam o bipe por conta própria (o formulário de venda adiciona a
 * peça na lista). Aqui a captura global fica quieta para não agir duas vezes.
 * O /pdv está fora deste layout, então nem chega aqui.
 */
const TELAS_QUE_JA_TRATAM_O_BIPE = ['/vendas/nova', '/vendas/']

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
  const [abrindoVenda, setAbrindoVenda] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  /**
   * Bipar em qualquer tela do sistema abre a venda já com a peça dentro.
   *
   * Guardas, na ordem:
   * - modal aberto (`role="dialog"`): ela está no meio de um cadastro; navegar
   *   embora descartaria o que digitou.
   * - tela que já trata o bipe: o formulário de venda cuida sozinho.
   */
  const aoBiparNoSistema = useCallback((codigo: string) => {
    if (document.querySelector('[role="dialog"]')) return
    if (TELAS_QUE_JA_TRATAM_O_BIPE.some(p => pathname.startsWith(p))) return

    setAbrindoVenda(codigo)
    router.push(`/vendas/nova?bip=${encodeURIComponent(codigo)}`)
  }, [pathname, router])

  useBarcodeScanner({ onScan: aoBiparNoSistema })

  // O aviso some quando a navegação conclui (a rota muda)
  useEffect(() => { setAbrindoVenda(null) }, [pathname])

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
          collapsed={collapsed}
        />
        <main className={styles.content}>
          {children}
        </main>
      </div>

      {/* Sem isto o bipe parece não ter funcionado: a navegação leva ~1s e ela
          bipa de novo. */}
      {abrindoVenda && (
        <div className={styles.bipToast} role="status" aria-live="polite">
          <ScanLine size={16} />
          <span>Abrindo venda — peça <strong>{abrindoVenda}</strong></span>
        </div>
      )}
    </div>
  )
}
