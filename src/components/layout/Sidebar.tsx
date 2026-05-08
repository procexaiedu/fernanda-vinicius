'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  ShoppingBag,
  BarChart2,
  Settings,
  Truck,
  ChevronLeft,
  ChevronRight,
  Gem,
} from 'lucide-react'
import styles from './Sidebar.module.css'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',    href: '/',              icon: <LayoutDashboard size={18} /> },
  { label: 'Vendas',       href: '/vendas',        icon: <ShoppingCart size={18} /> },
  { label: 'Produtos',     href: '/produtos',      icon: <Package size={18} /> },
  { label: 'Clientes',     href: '/clientes',      icon: <Users size={18} /> },
  { label: 'Compras',      href: '/compras',       icon: <ShoppingBag size={18} /> },
  { label: 'Financeiro',   href: '/financeiro',    icon: <BarChart2 size={18} /> },
  { label: 'Fornecedores', href: '/fornecedores',  icon: <Truck size={18} />, adminOnly: true },
  { label: 'Configurações',href: '/configuracoes', icon: <Settings size={18} />, adminOnly: true },
]

interface SidebarProps {
  userRole?: 'admin' | 'operator'
}

export default function Sidebar({ userRole = 'operator' }: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('fv-sidebar-collapsed')
    if (stored !== null) setCollapsed(stored === 'true')
  }, [])

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('fv-sidebar-collapsed', String(next))
  }

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || userRole === 'admin'
  )

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Logo */}
      <div className={styles.logo}>
        <Gem size={20} className={styles.logoIcon} />
        {!collapsed && (
          <span className={styles.logoText}>
            Fernanda<strong>Vinícius</strong>
          </span>
        )}
      </div>

      {/* Navegação */}
      <nav className={styles.nav}>
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.navItem} ${isActive(item.href) ? styles.active : ''}`}
            title={collapsed ? item.label : undefined}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
          </Link>
        ))}
      </nav>

      {/* Botão colapsar */}
      <button className={styles.collapseBtn} onClick={toggle} title={collapsed ? 'Expandir' : 'Recolher'}>
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  )
}
