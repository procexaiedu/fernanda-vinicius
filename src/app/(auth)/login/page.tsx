import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import LoginForm from './LoginForm'
import styles from './login.module.css'

export default async function LoginPage() {
  // Já logado e ativo? vai direto pro sistema.
  const profile = await getProfile()
  if (profile?.is_active) redirect('/')

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoGem}>◆</div>
          <div className={styles.logoText}>
            <span className={styles.logoName}>Fernanda Vinícius</span>
            <span className={styles.logoTagline}>Sistema de Gestão</span>
          </div>
        </div>

        <Suspense fallback={<div style={{ height: 180 }} />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
