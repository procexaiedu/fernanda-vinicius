import styles from './Spinner.module.css'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
}

export default function Spinner({ size = 'md' }: SpinnerProps) {
  return <span className={`${styles.spinner} ${styles[size]}`} aria-label="Carregando" />
}
