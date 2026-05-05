import styles from './page.module.css'

export default function DashboardPage() {
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.subtitle}>Visão geral do seu negócio</p>
      </div>

      <div className={styles.placeholder}>
        <p>Em construção — disponível na Fase 7</p>
      </div>
    </div>
  )
}
