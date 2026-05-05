'use client'

import { usePathname, useRouter } from 'next/navigation'
import { LogOut, ChevronRight, Store } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import styles from './Header.module.css'

interface HeaderProps {
  userName?: string
  userRole?: 'admin' | 'operator'
  storeName?: string
}

const ROUTE_LABELS: Record<string, string> = {
  '/':              'Dashboard',
  '/vendas':        'Vendas',
  '/produtos':      'Produtos',
  '/clientes':      'Clientes',
  '/compras':       'Compras',
  '/financeiro':    'Financeiro',
  '/configuracoes': 'Configurações',
}

function getBreadcrumb(pathname: string): string[] {
  const base = '/' + pathname.split('/')[1]
  const label = ROUTE_LABELS[base]
  if (!label || base === '/') return ['Dashboard']
  return ['Dashboard', label]
}

export default function Header({ userName, userRole, storeName }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const breadcrumb = getBreadcrumb(pathname)
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className={styles.header}>
      {/* Breadcrumb */}
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        {breadcrumb.map((crumb, i) => (
          <span key={i} className={styles.breadcrumbItem}>
            {i > 0 && <ChevronRight size={14} className={styles.breadcrumbSep} />}
            <span className={i === breadcrumb.length - 1 ? styles.breadcrumbActive : styles.breadcrumbCrumb}>
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      {/* Lado direito */}
      <div className={styles.right}>
        {/* Loja */}
        {storeName && (
          <div className={styles.storeTag}>
            <Store size={13} />
            <span>{storeName}</span>
          </div>
        )}

        {/* Usuário + logout */}
        <div className={styles.user}>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{userName ?? 'Usuário'}</span>
            <span className={styles.userRole}>
              {userRole === 'admin' ? 'Administrador' : 'Operadora'}
            </span>
          </div>
          <button
            className={styles.logoutBtn}
            onClick={handleLogout}
            title="Sair"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  )
}
