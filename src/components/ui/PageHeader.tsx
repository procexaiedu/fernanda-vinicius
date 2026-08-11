import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Se informado, mostra o link de voltar acima do título. */
  backHref?: string
  backLabel?: string
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
export default function PageHeader({ title, subtitle, backHref, backLabel }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      {backHref && (
        <Link href={backHref} className={styles.back}>
          <ArrowLeft size={14} aria-hidden />
          {backLabel ?? 'Voltar'}
        </Link>
      )}
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>
  )
}
