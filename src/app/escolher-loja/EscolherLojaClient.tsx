'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Store, ArrowRight } from 'lucide-react'
import { escolherLoja } from './actions'
import styles from './EscolherLoja.module.css'

interface Loja { id: string; name: string; city: string | null }

/**
 * Uma pergunta, duas respostas grandes. Nada mais.
 *
 * É a primeira tela do dia para a dona, e ela usa o sistema no fim do
 * expediente, cansada — "é a hora que eu tô quebrada, que eu saio da loja".
 * Um cartão por loja, do tamanho de um botão de verdade, é mais difícil de
 * errar do que uma lista suspensa.
 */
export default function EscolherLojaClient({ nome, lojas }: { nome: string; lojas: Loja[] }) {
  const router = useRouter()
  const [entrando, setEntrando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function entrar(loja: Loja) {
    setErro(null)
    setEntrando(loja.id)
    /* try/finally: sem ele um erro deixaria o cartão em "Entrando…" para
     * sempre, e ela ficaria presa na porta de entrada do sistema. */
    try {
      const r = await escolherLoja(loja.id)
      if (r.error) { setErro(r.error); return }
      router.replace('/')
      router.refresh()
    } catch {
      setErro('Não foi possível entrar. Tente de novo.')
    } finally {
      setEntrando(null)
    }
  }

  const primeiroNome = (nome ?? '').trim().split(/\s+/)[0]

  return (
    <div className={styles.tela}>
      <div className={styles.caixa}>
        <h1 className={styles.titulo}>
          {primeiroNome ? `Oi, ${primeiroNome}` : 'Oi'}
        </h1>
        <p className={styles.subtitulo}>Em qual loja você vai trabalhar agora?</p>

        {erro && <div className={styles.erro}>{erro}</div>}

        <div className={styles.lojas}>
          {lojas.map(loja => (
            <button
              key={loja.id}
              className={styles.loja}
              onClick={() => entrar(loja)}
              disabled={entrando !== null}
            >
              <span className={styles.icone}><Store size={20} /></span>
              <span className={styles.textos}>
                <strong className={styles.lojaNome}>{loja.name}</strong>
                {loja.city && <span className={styles.lojaCidade}>{loja.city}</span>}
              </span>
              <span className={styles.seta}>
                {entrando === loja.id ? 'Entrando…' : <ArrowRight size={16} />}
              </span>
            </button>
          ))}
        </div>

        {lojas.length === 0 && (
          <p className={styles.vazio}>Nenhuma loja ativa cadastrada.</p>
        )}

        <p className={styles.rodape}>
          Você vê e lança só o que é desta loja. Para ir à outra, troque pelo menu lateral.
        </p>
      </div>
    </div>
  )
}
