'use client'

import { useEffect, useRef } from 'react'

/**
 * Captura leituras do leitor de código de barras em qualquer lugar da página.
 *
 * O leitor em modo USB HID é um teclado: digita os caracteres e dá Enter. Não há
 * evento próprio de "leitura", então a única forma de distinguir leitor de pessoa
 * é a cadência — um leitor produz caracteres a ~5-15ms um do outro, ninguém
 * digita nessa velocidade.
 *
 * Dois cuidados que a versão anterior (embutida no formulário de venda) não tinha
 * e que estão resolvidos aqui:
 *
 * 1. Os dígitos também eram escritos no campo em foco. Bipar com o cursor na
 *    busca de cliente adicionava a peça E deixava "10100" digitado lá. O hook
 *    guarda o valor do campo antes da leitura e restaura ao reconhecer o leitor.
 * 2. O Enter final podia submeter o formulário. Agora é cancelado.
 */

interface Opcoes {
  /** Chamado com o código lido, só quando a cadência indica leitor. */
  onScan: (codigo: string) => void
  /** Desliga a captura sem desmontar o hook. Padrão: ligado. */
  ativo?: boolean
  /** Mínimo de caracteres para considerar leitura. Padrão 3. */
  minimoCaracteres?: number
  /** Máximo de ms por caractere. Acima disso é gente digitando. Padrão 80. */
  msPorCaractere?: number
}

export function useBarcodeScanner({
  onScan,
  ativo = true,
  minimoCaracteres = 3,
  msPorCaractere = 80,
}: Opcoes) {
  // Em ref para o listener não precisar ser recriado a cada render
  const onScanRef = useRef(onScan)
  const ativoRef  = useRef(ativo)
  useEffect(() => { onScanRef.current = onScan }, [onScan])
  useEffect(() => { ativoRef.current  = ativo  }, [ativo])

  const buf = useRef<{
    chars: string[]
    firstTs: number
    alvo: HTMLInputElement | HTMLTextAreaElement | null
    valorAntes: string
  }>({ chars: [], firstTs: 0, alvo: null, valorAntes: '' })

  useEffect(() => {
    function limpar() {
      buf.current = { chars: [], firstTs: 0, alvo: null, valorAntes: '' }
    }

    function onKeyDown(e: KeyboardEvent) {
      const b = buf.current
      const agora = Date.now()

      if (e.key === 'Enter') {
        const codigo = b.chars.join('')
        const decorrido = b.firstTs ? agora - b.firstTs : 9999
        const n = b.chars.length
        const alvo = b.alvo
        const antes = b.valorAntes
        limpar()

        if (!ativoRef.current) return
        if (n < minimoCaracteres || (n > 1 && decorrido / n > msPorCaractere)) return

        // Foi o leitor: cancela o Enter e desfaz o que ele digitou no campo.
        e.preventDefault()
        if (alvo && alvo.value !== antes) {
          const proto = alvo instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
          const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
          setter?.call(alvo, antes)
          alvo.dispatchEvent(new Event('input', { bubbles: true }))
        }

        onScanRef.current(codigo)
        return
      }

      if (e.key.length === 1) {
        if (!b.chars.length) {
          b.firstTs = agora
          const foco = document.activeElement
          if (foco instanceof HTMLInputElement || foco instanceof HTMLTextAreaElement) {
            b.alvo = foco
            b.valorAntes = foco.value
          } else {
            b.alvo = null
            b.valorAntes = ''
          }
        }
        b.chars.push(e.key)
      } else if (e.key !== 'Shift' && e.key !== 'CapsLock') {
        limpar()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [minimoCaracteres, msPorCaractere])
}
