'use client'

import { useMemo, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Paginacao from '@/components/ui/Paginacao'
import { usePaginacaoLocal } from '@/hooks/usePaginacaoLocal'
import styles from './DetalheListaModal.module.css'

/*
 * ─── O que há por trás do número ──────────────────────────────────────────────
 *
 * Cada cartão da dashboard mostra um total. Este modal mostra as linhas que
 * formam esse total, e no rodapé refaz a soma — se a soma da lista não bater com
 * o número do cartão, o erro aparece aqui em vez de passar despercebido.
 *
 * É genérico de propósito: são sete lugares clicáveis na dashboard (resultado,
 * quatro indicadores, cinco cartões de estoque), e sete modais quase iguais
 * significaria sete lugares para consertar o mesmo detalhe.
 */

export type Alinhamento = 'esq' | 'dir'

export interface ColunaDetalhe<T> {
  chave: string
  rotulo: string
  alinhamento?: Alinhamento
  /** Enfatiza a coluna que dá identidade à linha (o nome, a descrição). */
  forte?: boolean
  /** Some abaixo de 720px de modal — a coluna secundária, não a que importa. */
  secundaria?: boolean
  valor: (linha: T) => React.ReactNode
  /** Texto usado pela busca; sem isto a coluna não é pesquisável. */
  busca?: (linha: T) => string
}

/** Uma linha do resumo do topo: "Receita bruta … R$ 14.663,86". */
export interface ItemResumo {
  rotulo: string
  valor: string
  /** 'pos' | 'neg' pintam o valor; ausente deixa na cor de texto normal. */
  tom?: 'pos' | 'neg'
  /** Fecha a conta — ganha linha própria acima e peso maior. */
  total?: boolean
}

interface Props<T> {
  titulo: string
  subtitulo: string
  colunas: ColunaDetalhe<T>[]
  linhas: T[]
  chave: (linha: T) => string
  /** A conta que o cartão mostra, decomposta. Opcional. */
  resumo?: ItemResumo[]
  /** Rodapé com o total da coluna numérica, quando faz sentido somar. */
  rodape?: React.ReactNode
  rotuloItem?: string
  rotuloItemPlural?: string
  carregando?: boolean
  vazio?: string
  onLinhaClick?: (linha: T) => void
  onClose: () => void
}

export default function DetalheListaModal<T>({
  titulo, subtitulo, colunas, linhas, chave, resumo, rodape,
  rotuloItem = 'registro', rotuloItemPlural, carregando, vazio = 'Nada a mostrar',
  onLinhaClick, onClose,
}: Props<T>) {
  const [busca, setBusca] = useState('')

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return linhas
    const buscaveis = colunas.filter(c => c.busca)
    return linhas.filter(l =>
      buscaveis.some(c => c.busca!(l).toLocaleLowerCase('pt-BR').includes(termo)),
    )
  }, [linhas, busca, colunas])

  const pag = usePaginacaoLocal(filtradas)

  return (
    <Modal isOpen onClose={onClose} size="xl" title={titulo}>
      <div className={styles.corpo}>
        <p className={styles.subtitulo}>{subtitulo}</p>

        {resumo && resumo.length > 0 && (
          <div className={styles.resumo}>
            {resumo.map(r => (
              <div
                key={r.rotulo}
                className={`${styles.resumoLinha} ${r.total ? styles.resumoTotal : ''}`}
              >
                <span className={styles.resumoRotulo}>{r.rotulo}</span>
                <span className={`${styles.resumoValor} ${r.tom ? styles[r.tom] : ''}`}>
                  {r.valor}
                </span>
              </div>
            ))}
          </div>
        )}

        {carregando ? (
          <div className={styles.estado}>
            <Loader2 size={18} className={styles.girando} />
            <span>Carregando…</span>
          </div>
        ) : linhas.length === 0 ? (
          <div className={styles.estado}>{vazio}</div>
        ) : (
          <>
            {linhas.length > 10 && (
              <div className={styles.buscaCampo}>
                <Search size={14} className={styles.buscaIcone} />
                <input
                  className={styles.buscaInput}
                  placeholder="Buscar na lista…"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  autoFocus
                />
              </div>
            )}

            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    {colunas.map(c => (
                      <th
                        key={c.chave}
                        className={[
                          c.alinhamento === 'dir' ? styles.dir : '',
                          c.secundaria ? styles.secundaria : '',
                        ].join(' ')}
                      >
                        {c.rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pag.fatia.map(l => (
                    <tr
                      key={chave(l)}
                      className={onLinhaClick ? styles.clicavel : ''}
                      onClick={onLinhaClick ? () => onLinhaClick(l) : undefined}
                    >
                      {colunas.map(c => (
                        <td
                          key={c.chave}
                          className={[
                            c.alinhamento === 'dir' ? styles.dir : '',
                            c.forte ? styles.forte : '',
                            c.secundaria ? styles.secundaria : '',
                          ].join(' ')}
                        >
                          {c.valor(l)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filtradas.length === 0 && (
              <div className={styles.estado}>Nenhum resultado para “{busca}”</div>
            )}

            {rodape && <div className={styles.rodape}>{rodape}</div>}

            <Paginacao
              pagina={pag.pagina}
              totalPaginas={pag.totalPaginas}
              totalItens={pag.totalItens}
              rotulo={rotuloItem}
              rotuloPlural={rotuloItemPlural}
              onIr={pag.irPara}
            />
          </>
        )}
      </div>
    </Modal>
  )
}
