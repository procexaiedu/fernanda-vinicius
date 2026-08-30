'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { buscarCep, cepCompleto, digitosCep, type EnderecoCep } from '@/lib/cep'

/**
 * Autopreenchimento de endereço por CEP.
 *
 * O componente continua dono do valor do campo — o hook só cuida de QUANDO
 * consultar e do que fazer com a resposta. Três coisas que a versão colada
 * dentro de `FornecedorFormModal` não tratava:
 *
 * 1. **Repetição.** Lá a busca disparava a cada tecla depois do 8º dígito:
 *    apagar o traço e redigitar mandava a mesma consulta de novo. Aqui um CEP
 *    já consultado não repete até o valor realmente mudar.
 *
 * 2. **Corrida.** Duas consultas em voo e a primeira demorando mais que a
 *    segunda: a resposta velha chegava por último e sobrescrevia o endereço
 *    certo. O contador de sequência descarta tudo que não é a busca mais nova.
 *
 * 3. **Componente desmontado.** Fechar o modal com a busca em voo chamava
 *    `setState` em componente morto. `vivoRef` corta isso.
 *
 * O callback fica em ref de propósito: assim o consumidor passa uma função
 * inline sem precisar de `useCallback`, e ela nunca chega velha.
 */
export function useCep(aoEncontrar: (endereco: EnderecoCep) => void) {
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro]         = useState<string | null>(null)

  const aoEncontrarRef = useRef(aoEncontrar)

  const ultimoRef = useRef('')   // último CEP consultado, só dígitos
  const seqRef    = useRef(0)
  const vivoRef   = useRef(true)

  // Sem array de dependência: roda a cada render e mantém o callback fresco.
  // Escrever a ref no corpo do componente seria mais curto, mas é escrita
  // durante o render — o lint reclama, e com razão.
  useEffect(() => { aoEncontrarRef.current = aoEncontrar })

  useEffect(() => {
    vivoRef.current = true
    return () => { vivoRef.current = false }
  }, [])

  /**
   * Chame no `onChange` do campo, com o valor cru digitado. Só sai consulta
   * quando o CEP fecha 8 dígitos e é diferente do último consultado.
   */
  const consultar = useCallback(async (bruto: string) => {
    const d = digitosCep(bruto)

    // Voltou a ser incompleto: some o erro antigo e libera o mesmo CEP a ser
    // consultado de novo, senão corrigir um dígito e voltar não busca nada.
    if (!cepCompleto(d)) {
      ultimoRef.current = ''
      if (erro) setErro(null)
      return
    }

    if (d === ultimoRef.current) return
    ultimoRef.current = d

    const seq = ++seqRef.current
    setBuscando(true)
    setErro(null)

    const r = await buscarCep(d)

    // Resposta atrasada de uma busca que já não interessa.
    if (!vivoRef.current || seq !== seqRef.current) return

    setBuscando(false)
    if (r.ok) aoEncontrarRef.current(r.endereco)
    else {
      setErro(r.erro)
      // Deu erro: permite tentar o mesmo CEP outra vez (rede pode ter caído).
      ultimoRef.current = ''
    }
  }, [erro])

  return { buscando, erro, consultar }
}
