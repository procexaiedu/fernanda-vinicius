import styles from './Badge.module.css'

interface BadgeProps {
  variant?: 'success' | 'danger' | 'warning' | 'muted' | 'accent'
  children: React.ReactNode
}

export default function Badge({ variant = 'muted', children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{children}</span>
}
