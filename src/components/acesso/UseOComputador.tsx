'use client'

import { useRouter } from 'next/navigation'
import { Monitor } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { MSG_USE_O_COMPUTADOR } from '@/lib/acessoCelular'
import styles from './UseOComputador.module.css'

/*
 * O que a vendedora vê ao abrir o sistema pelo celular (decisão de 06/10).
 * Educado e com saída: "Sair" libera o aparelho para outra conta (a gerente
 * pode entrar no mesmo celular).
 */
export default function UseOComputador({ nome }: { nome?: string | null }) {
  const router = useRouter()

  async function sair() {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const primeiro = (nome ?? '').trim().split(/\s+/)[0]

  return (
    <div className={styles.page}>
      <div className={styles.card} role="alert">
        <Monitor size={36} className={styles.icone} aria-hidden />
        <h1 className={styles.titulo}>{primeiro ? `Oi, ${primeiro}!` : 'Oi!'}</h1>
        <p className={styles.texto}>{MSG_USE_O_COMPUTADOR}</p>
        <p className={styles.sub}>No celular, só a gerência acessa.</p>
        <button type="button" className={styles.botao} onClick={sair}>Sair</button>
      </div>
    </div>
  )
}
