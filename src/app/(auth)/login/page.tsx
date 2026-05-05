import LoginForm from './LoginForm'
import styles from './login.module.css'

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoGem}>◆</div>
          <div className={styles.logoText}>
            <span className={styles.logoName}>Fernanda Vinícius</span>
            <span className={styles.logoTagline}>Sistema de Gestão</span>
          </div>
        </div>

        {/* Formulário */}
        <LoginForm />
      </div>
    </div>
  )
}
