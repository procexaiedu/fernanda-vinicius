import Link from 'next/link'
import styles from './SeletorLojaConfig.module.css'

/**
 * Seletor de loja das telas de Configurações (taxas, negócio, impressão).
 * Só aparece para quem administra mais de uma loja (a dona). Cada loja tem a
 * sua configuração: trocar aqui troca o que a tela mostra e grava. A lista
 * vem do servidor (lojasQueAdministra); a loja da URL é conferida lá também.
 */
export default function SeletorLojaConfig({ lojas, lojaId, href }: {
  lojas: { id: string; name: string }[]
  lojaId: string
  href: string
}) {
  if (lojas.length < 2) return null
  return (
    <nav className={styles.lojas} aria-label="Loja">
      {lojas.map(l => (
        <Link key={l.id} href={`${href}?loja=${l.id}`} data-ativa={l.id === lojaId} aria-current={l.id === lojaId ? 'page' : undefined}>
          {l.name}
        </Link>
      ))}
      <span className={styles.nota}>Cada loja tem a sua configuração: mudar uma não mexe na outra.</span>
    </nav>
  )
}
