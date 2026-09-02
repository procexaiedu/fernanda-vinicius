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

/**
 * Rótulo dos segundos níveis, por caminho completo.
 *
 * Chave é o caminho inteiro e não o último pedaço porque `nova` e `editar` se
 * repetem entre módulos: `/vendas/nova` é "Nova Venda" e `/compras/nova` é
 * "Nova Compra". Um mapa por pedaço diria "Nova" nos dois.
 */
const SUB_LABELS: Record<string, string> = {
  '/vendas/nova':              'Nova Venda',
  '/compras/nova':             'Nova Compra',
  '/estoque/conferencia':      'Conferência',
  '/estoque/transferencias':   'Transferências',
  '/configuracoes/lojas':      'Lojas',
  '/configuracoes/usuarios':   'Usuários',
  '/configuracoes/metas':      'Metas',
  '/configuracoes/negocio':    'Negócio',
  '/configuracoes/impressao':  'Impressão',
}

/** Segmento que é id (uuid ou number) e não vira degrau na trilha. */
function ehIdentificador(seg: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^\d+$/.test(seg)
}

/**
 * A trilha completa, não só o módulo.
 *
 * Antes lia SÓ o primeiro pedaço da URL e devolvia no máximo dois degraus —
 * então em 13 sub-rotas a trilha mentia: quem estava em "Nova Venda" lia
 * "Dashboard › Vendas", e quem estava em Transferências lia "Dashboard ›
 * Estoque". A tela dizia uma coisa e o cabeçalho dizia outra.
 *
 * Os ids saem da trilha: `/vendas/<uuid>/editar` vira Vendas › Editar Venda, e
 * não Vendas › 4f3a… › Editar.
 */
function getBreadcrumb(pathname: string): string[] {
  const segmentos = pathname.split('/').filter(Boolean)
  if (segmentos.length === 0) return ['Dashboard']

  const base = '/' + segmentos[0]
  const label = ROUTE_LABELS[base]
  if (!label) return ['Dashboard']

  const trilha = ['Dashboard', label]

  // Caminho sem os ids: /vendas/<uuid>/editar → /vendas/editar
  const resto = segmentos.slice(1).filter(seg => !ehIdentificador(seg))
  if (resto.length === 0) return trilha

  const ultimo = resto[resto.length - 1]
  const cheio = base + '/' + resto.join('/')
  const direto = SUB_LABELS[cheio] ?? SUB_LABELS[base + '/' + ultimo]

  if (direto) {
    trilha.push(direto)
  } else if (ultimo === 'editar') {
    // "Editar Venda", "Editar Compra" — o singular do módulo, sem mapa extra.
    trilha.push('Editar ' + label.replace(/s$/, ''))
  } else {
    trilha.push(ultimo.charAt(0).toUpperCase() + ultimo.slice(1))
  }

  return trilha
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
