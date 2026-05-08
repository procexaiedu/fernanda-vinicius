'use client'

import { useSearchParams } from 'next/navigation'
import styles from './login.module.css'

export default function LoginForm() {
  const searchParams = useSearchParams()
  const hasError = searchParams.get('error') === 'invalid'
  const isInactive = searchParams.get('error') === 'inactive'

  return (
    <form method="POST" action="/api/auth/login" className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="email" className={styles.label}>E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="seu@email.com"
          className={styles.input}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="password" className={styles.label}>Senha</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className={styles.input}
        />
      </div>

      {isInactive && (
        <div className={styles.errorBox} role="alert">
          Sua conta foi desativada. Fale com a administração.
        </div>
      )}
      {hasError && !isInactive && (
        <div className={styles.errorBox} role="alert">
          E-mail ou senha inválidos.
        </div>
      )}

      <button type="submit" className={styles.submitBtn}>
        Entrar
      </button>
    </form>
  )
}
