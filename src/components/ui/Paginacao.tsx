'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Paginacao.module.css'

/**
 * Paginação — 10 linhas por página, em todas as listas.
 *
 * Por que 10: as tabelas de /produtos e /estoque metiam 50 linhas numa caixa de
 * 640px com `overflow: auto`, o que dava 2540px de rolagem DENTRO da tabela, e
 * /clientes despejava as 760 de uma vez. 10 × ~63px = 630px, que cadê inteiro numa
 * tela de 900px sem rolar nada.
 *
 * A troca de página é INSTANTÂNEA porque o corte é local: o servidor continua
 * mandando o lote dele (50 em /produtos e /estoque) e só é consultado de novo a
 * cada 5 páginas. Medido: cada ida ao servidor custa ~500ms, e paginar 1031
 * produtos de 10 em 10 no servidor seriam 104 esperas em vez de 21.
 */

export const POR_PAGINA = 10

/** Janela de páginas com elipse: 1 … 4 5 6 … 21 */
function janela(atual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const p: (number | '…')[] = [1]
  if (atual > 3) p.push('…')
  for (let i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) p.push(i)
  if (atual < total - 2) p.push('…')
  p.push(total)
  return p
}

interface Props {
  pagina: number
  totalPaginas: number
  /** Total de itens, para o rótulo "Mostrando 1–10 de 760". */
  totalItens: number
  /** Nome do item no singular; o plural sai com "s". Ex: "cliente" → "clientes". */
  rotulo?: string
  /** Plural irregular, quando "+s" não serve ("transação" → "transações"). */
  rotuloPlural?: string
  onIr: (pagina: number) => void
  /** Marca que uma consulta ao servidor está em curso (troca de lote). */
  carregando?: boolean
}

export default function Paginacao({
  pagina, totalPaginas, totalItens, rotulo = 'item', rotuloPlural, onIr, carregando,
}: Props) {
  if (totalItens === 0) return null

  const de  = Math.min((pagina - 1) * POR_PAGINA + 1, totalItens)
  const ate = Math.min(pagina * POR_PAGINA, totalItens)
  const nome = totalItens === 1 ? rotulo : (rotuloPlural ?? `${rotulo}s`)

  return (
    <div className={styles.paginacao}>
      <span className={styles.info}>
        Mostrando {de}–{ate} de {totalItens.toLocaleString('pt-BR')} {nome}
        {carregando && <span className={styles.carregando}> · carregando…</span>}
      </span>

      {totalPaginas > 1 && (
        <div className={styles.botoes}>
          <button
            className={styles.btn}
            disabled={pagina <= 1}
            onClick={() => onIr(pagina - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} />
          </button>

          {janela(pagina, totalPaginas).map((p, i) =>
            p === '…'
              ? <span key={`e${i}`} className={styles.reticencia}>…</span>
              : (
                <button
                  key={p}
                  className={`${styles.btn} ${p === pagina ? styles.btnAtivo : ''}`}
                  onClick={() => onIr(p)}
                  aria-current={p === pagina ? 'page' : undefined}
                >
                  {p}
                </button>
              )
          )}

          <button
            className={styles.btn}
            disabled={pagina >= totalPaginas}
            onClick={() => onIr(pagina + 1)}
            aria-label="Página seguinte"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
