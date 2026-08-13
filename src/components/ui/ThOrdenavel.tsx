'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { Direcao } from '@/hooks/useOrdenacao'
import styles from './ThOrdenavel.module.css'

/**
 * Cabeçalho de coluna clicável.
 *
 * O ícone é sempre visível, apagado, quando a coluna não está ordenando: sem ele
 * não há como saber que a coluna é clicável — só descobrindo por acidente. Ativo,
 * ele assume a cor de acento e aponta o sentido.
 *
 * `className` recebe as classes globais de alinhamento (`col-num`, `col-center`,
 * `col-tertiary`…) porque a coluna ordenável precisa continuar respeitando a
 * prioridade responsiva e o alinhamento como qualquer outra.
 */
/*
 * Genérico na chave da coluna de propósito: assim o TypeScript garante que o
 * `coluna` passado aqui existe no mapa entregue ao `useOrdenacao`. Com `string`
 * solto, errar o nome de uma coluna compilava e só falhava em silêncio na tela.
 *
 * Recebe o `ord` inteiro em vez de três props separadas. Não é só economia de
 * digitação: a primeira versão pedia `ordenandoPor`/`direcao`/`onOrdenar`, e para
 * não repetir isso em nove colunas cada página declarava um wrapper `<Th>` DENTRO
 * do componente. Função declarada no corpo do componente é um TIPO novo a cada
 * render, então o React desmontava e remontava todos os <th> a cada mudança de
 * estado — perdia foco e descartava o nó em que o clique tinha acabado de cair.
 */
interface Props<K extends string> {
  children: React.ReactNode
  /** Identificador da coluna, igual à chave passada ao useOrdenacao. */
  coluna: K
  /** O retorno do useOrdenacao, inteiro. */
  ord: {
    chave: K | null
    direcao: Direcao
    alternar: (coluna: K) => void
  }
  className?: string
}

export default function ThOrdenavel<K extends string>({
  children, coluna, ord, className,
}: Props<K>) {
  const { chave: ordenandoPor, direcao, alternar: onOrdenar } = ord
  const ativa = ordenandoPor === coluna

  return (
    <th
      className={`${styles.th} ${ativa ? styles.ativa : ''} ${className ?? ''}`}
      onClick={() => onOrdenar(coluna)}
      aria-sort={ativa ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none'}
      title="Clique para ordenar"
    >
      <span className={styles.conteudo}>
        {children}
        {ativa
          ? (direcao === 'asc'
              ? <ChevronUp size={11} className={styles.iconeAtivo} />
              : <ChevronDown size={11} className={styles.iconeAtivo} />)
          : <ChevronsUpDown size={11} className={styles.iconeInativo} />}
      </span>
    </th>
  )
}
