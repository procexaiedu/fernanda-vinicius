import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  /** Aceita nó, não só texto: alguns subtítulos trazem `<code>` ou link. */
  subtitle?: ReactNode
  /** Se informado, mostra o link de voltar acima do título. */
  backHref?: string
  backLabel?: string
  /**
   * Ações à direita do título — "Novo Produto", "Exportar", "Abrir PDV".
   *
   * Este slot é a razão de o componente não ter pegado antes: quase toda tela
   * de lista tem botão de ação no cabeçalho, e sem lugar para ele cada uma
   * remontou a linha inteira à mão, com `style={{ display: flex … }}` repetido.
   */
  actions?: ReactNode
}

/**
 * Cabeçalho de página: título, subtítulo opcional e link de voltar.
 *
 * Existe para parar de repetir isso à mão em cada página. Antes, três telas
 * traziam o voltar como `← Voltar para X` — seta de TEXTO, com estilo inline, e
 * `<a href>` puro, que recarrega o documento inteiro em vez de navegar. O resto
 * do sistema já usava o ícone `ArrowLeft` do lucide; era só falta de um lugar
 * comum. O título usa o token `--fs-page-title`, que já existia com `clamp()`
 * responsivo e era usado em uma única página de vinte.
 */
export default function PageHeader({ title, subtitle, backHref, backLabel, actions }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      {backHref && (
        <Link href={backHref} className={styles.back}>
          <ArrowLeft size={14} aria-hidden />
          {backLabel ?? 'Voltar'}
        </Link>
      )}
      <div className={styles.linha}>
        <div className={styles.textos}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.acoes}>{actions}</div>}
      </div>
    </div>
  )
}
