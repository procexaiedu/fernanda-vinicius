'use client'

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
  Warehouse,
  Send,
  ChevronLeft,
  ChevronRight,
  Gem,
  Monitor,
} from 'lucide-react'
import styles from './Sidebar.module.css'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'PDV',          href: '/pdv',           icon: <Monitor size={18} /> },
  { label: 'Dashboard',    href: '/',              icon: <LayoutDashboard size={18} />, adminOnly: true },
  { label: 'Vendas',       href: '/vendas',        icon: <ShoppingCart size={18} /> },
  { label: 'Produtos',     href: '/produtos',      icon: <Package size={18} />,    adminOnly: true },
  { label: 'Estoque',      href: '/estoque',       icon: <Warehouse size={18} /> },
  { label: 'Clientes',     href: '/clientes',      icon: <Users size={18} /> },
  { label: 'Disparos',     href: '/disparos',      icon: <Send size={18} />, adminOnly: true },
  { label: 'Compras',      href: '/compras',       icon: <ShoppingBag size={18} />, adminOnly: true },
  { label: 'Financeiro',   href: '/financeiro',    icon: <BarChart2 size={18} />,   adminOnly: true },
  { label: 'Fornecedores', href: '/fornecedores',  icon: <Truck size={18} />, adminOnly: true },
  { label: 'Configurações',href: '/configuracoes', icon: <Settings size={18} />, adminOnly: true },
]

interface SidebarProps {
  userRole?: 'admin' | 'operator'
  /** Estado controlado pelo layout (fonte única — habilita auto-collapse). */
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ userRole = 'operator', collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()

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
      <button className={styles.collapseBtn} onClick={onToggle} title={collapsed ? 'Expandir' : 'Recolher'}>
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  )
}
