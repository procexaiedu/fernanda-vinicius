'use client'

import { usePathname } from 'next/navigation'
import { ChevronRight, Menu } from 'lucide-react'
import styles from './Header.module.css'

/**
 * Header = trilha de navegação, e nada mais.
 *
 * O bloco de usuário (nome, papel, loja, tema, sair) desceu para o rodapé da
 * sidebar: é informação de SESSÃO, e sessão pertence ao mesmo lugar que a
 * navegação. Aqui ficava disputando a barra com o breadcrumb e empurrando o
 * conteúdo da página para baixo sem necessidade.
 */
interface HeaderProps {
  /** Precisa saber: o header é `fixed` e alinha o `left` com a sidebar. */
  collapsed?: boolean
  /**
   * Abre a gaveta de navegação. Só aparece abaixo de 900px, onde a sidebar deixa
   * de ocupar coluna fixa: num celular de 390px ela comia 64px (16% da tela) para
   * mostrar ícones sem rótulo, que ninguém sabe o que são.
   */
  onAbrirMenu?: () => void
}

const ROUTE_LABELS: Record<string, string> = {
  '/':              'Dashboard',
  '/pdv':           'PDV',
  '/vendas':        'Vendas',
  '/produtos':      'Produtos',
  '/clientes':      'Clientes',
  '/estoque':       'Estoque',
  '/compras':       'Compras',
  '/fornecedores':  'Fornecedores',
  '/disparos':      'Disparos',
  '/financeiro':    'Financeiro',
  '/configuracoes': 'Configurações',
}

function getBreadcrumb(pathname: string): string[] {
  const base = '/' + pathname.split('/')[1]
  const label = ROUTE_LABELS[base]
  if (!label || base === '/') return ['Dashboard']
  return ['Dashboard', label]
}

export default function Header({ collapsed = false, onAbrirMenu }: HeaderProps) {
  const pathname = usePathname()
  const breadcrumb = getBreadcrumb(pathname)

  return (
    <header className={`${styles.header} ${collapsed ? styles.headerCollapsed : ''}`}>
      {onAbrirMenu && (
        <button
          type="button"
          className={styles.botaoMenu}
          onClick={onAbrirMenu}
          aria-label="Abrir menu de navegação"
        >
          <Menu size={20} />
        </button>
      )}
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
    </header>
  )
}
