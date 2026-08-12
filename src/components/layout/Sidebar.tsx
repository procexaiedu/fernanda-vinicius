'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
  Monitor,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import styles from './Sidebar.module.css'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  adminOnly?: boolean
  /** Abre em nova aba/janela (o PDV é uma superfície separada, de operação). */
  newTab?: boolean
}

interface NavGroup {
  /** Sem título = itens soltos no topo, os dois pontos de entrada. */
  titulo?: string
  itens: NavItem[]
}

/*
 * Agrupamento por FLUXO de trabalho, não por tipo de tela:
 *
 * - Dashboard e PDV ficam soltos no topo porque são os dois pontos de entrada —
 *   a Fernanda abre no Dashboard, a funcionária abre no PDV.
 * - `Disparos` fica em VENDAS, junto de `Clientes`: é contato com cliente, não
 *   relatório.
 * - `Compras` + `Fornecedores` é o fluxo da mala de SP, do começo ao fim.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    itens: [
      { label: 'Dashboard', href: '/',    icon: <LayoutDashboard size={18} />, adminOnly: true },
      { label: 'PDV',       href: '/pdv', icon: <Monitor size={18} /> },
    ],
  },
  {
    titulo: 'Vendas',
    itens: [
      { label: 'Vendas',   href: '/vendas',   icon: <ShoppingCart size={18} /> },
      { label: 'Clientes', href: '/clientes', icon: <Users size={18} /> },
      { label: 'Disparos', href: '/disparos', icon: <Send size={18} />, adminOnly: true },
    ],
  },
  {
    titulo: 'Estoque',
    itens: [
      { label: 'Produtos', href: '/produtos', icon: <Package size={18} />, adminOnly: true },
      { label: 'Estoque',  href: '/estoque',  icon: <Warehouse size={18} /> },
    ],
  },
  {
    titulo: 'Compras',
    itens: [
      { label: 'Compras',      href: '/compras',      icon: <ShoppingBag size={18} />, adminOnly: true },
      { label: 'Fornecedores', href: '/fornecedores', icon: <Truck size={18} />, adminOnly: true },
    ],
  },
  {
    titulo: 'Gestão',
    itens: [
      { label: 'Financeiro',    href: '/financeiro',    icon: <BarChart2 size={18} />, adminOnly: true },
      { label: 'Configurações', href: '/configuracoes', icon: <Settings size={18} />, adminOnly: true },
    ],
  },
]

interface SidebarProps {
  userRole?: 'admin' | 'operator'
  userName?: string
  storeName?: string
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
  /** Estado controlado pelo layout (fonte única — habilita auto-collapse). */
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({
  userRole = 'operator', userName, storeName,
  theme = 'dark', onToggleTheme,
  collapsed, onToggle,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  // Um grupo cujos itens são todos adminOnly desaparece inteiro para a operadora
  // — inclusive o título, senão sobraria um rótulo sem nada embaixo.
  const grupos = NAV_GROUPS
    .map(g => ({ ...g, itens: g.itens.filter(i => !i.adminOnly || userRole === 'admin') }))
    .filter(g => g.itens.length > 0)

  async function sair() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const papel = userRole === 'admin' ? 'Administrador' : 'Operadora'
  const inicial = (userName ?? 'U').trim().charAt(0).toUpperCase()

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Topo: marca + recolher. O botão subiu para cá — no pé ele ficava longe
          do olho e competia com o rodapé do usuário. */}
      <div className={styles.topo}>
        {!collapsed && (
          <div className={styles.logo}>
            <span className={styles.logoMark} role="img" aria-label="Fernanda Vinícius" />
            <span className={styles.logoText}>
              Fernanda<strong>Vinícius</strong>
            </span>
          </div>
        )}
        <button
          className={styles.collapseBtn}
          onClick={onToggle}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navegação em coleções */}
      <nav className={styles.nav}>
        {grupos.map((grupo, gi) => (
          <div key={grupo.titulo ?? `topo-${gi}`} className={styles.grupo}>
            {grupo.titulo && (
              // Recolhida, o rótulo do grupo não caberia — vira um traço, que
              // preserva a separação visual sem texto cortado.
              collapsed
                ? <span className={styles.grupoTraco} aria-hidden="true" />
                : <span className={styles.grupoTitulo}>{grupo.titulo}</span>
            )}
            {grupo.itens.map(item => (
              item.newTab ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener"
                  className={styles.navItem}
                  title={collapsed ? item.label : 'Abre em uma nova aba'}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navItem} ${isActive(item.href) ? styles.active : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
                </Link>
              )
            ))}
          </div>
        ))}
      </nav>

      {/* Rodapé: quem está logado. Veio do header — é informação de sessão, e
          sessão pertence ao mesmo lugar que a navegação. */}
      <div className={styles.rodape}>
        <div className={styles.usuario} title={collapsed ? `${userName ?? 'Usuário'} · ${papel}` : undefined}>
          <span className={styles.avatar} aria-hidden="true">{inicial}</span>
          {!collapsed && (
            <span className={styles.usuarioInfo}>
              <span className={styles.usuarioNome}>{userName ?? 'Usuário'}</span>
              <span className={styles.usuarioPapel}>
                {storeName ? `${papel} · ${storeName}` : papel}
              </span>
            </span>
          )}
        </div>
        <div className={styles.rodapeAcoes}>
          <button
            className={styles.acaoBtn}
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            aria-label="Alternar tema"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button className={styles.acaoBtn} onClick={sair} title="Sair" aria-label="Sair">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
