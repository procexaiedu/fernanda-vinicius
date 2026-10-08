'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import styles from './login.module.css'
import { MSG_USE_O_COMPUTADOR } from '@/lib/acessoCelular'

export default function LoginForm() {
  const searchParams = useSearchParams()
  const hasError = searchParams.get('error') === 'invalid'
  const isInactive = searchParams.get('error') === 'inactive'
  const soComputador = searchParams.get('error') === 'celular'
  const [mostrarSenha, setMostrarSenha] = useState(false)

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
        <div className={styles.senhaWrap}>
          <input
            id="password"
            name="password"
            type={mostrarSenha ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className={`${styles.input} ${styles.inputSenha}`}
          />
          {/* Pedido da dona: conferir o que digitou antes de errar a senha. */}
          <button
            type="button"
            className={styles.olhoBtn}
            onClick={() => setMostrarSenha(v => !v)}
            aria-label={mostrarSenha ? 'Esconder senha' : 'Mostrar senha'}
            title={mostrarSenha ? 'Esconder senha' : 'Mostrar senha'}
          >
            {mostrarSenha ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {isInactive && (
        <div className={styles.errorBox} role="alert">
          Sua conta foi desativada. Fale com a administração.
        </div>
      )}
      {soComputador && (
        <div className={styles.errorBox} role="alert">
          {MSG_USE_O_COMPUTADOR}
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
