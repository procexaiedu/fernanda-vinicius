import styles from './Esqueleto.module.css'

/**
 * Esqueleto de carregamento — o que a pessoa vê ENQUANTO a tela carrega.
 *
 * Por que existe (medido em 13/08/2026, A/B na mesma rota `/produtos`):
 *
 *   sem esqueleto:  564 ms com a tela CONGELADA na página anterior
 *   com esqueleto:   13 ms até a tela mudar
 *
 * 43× no tempo até a primeira resposta visual. O tempo TOTAL não muda — o que
 * muda é que a pessoa deixa de ficar meio segundo olhando para a tela antiga sem
 * nenhum sinal de que o clique funcionou. Era essa a queixa de "sistema travado".
 *
 * Regras de desenho, todas deliberadas:
 * - A pulsação é lenta (1.4s) e de baixa amplitude. Esqueleto que pisca forte
 *   chama mais atenção que o conteúdo que vai substituí-lo.
 * - As alturas espelham as reais (linha de tabela = 63px, controle = 34px), senão
 *   a página SALTA quando o dado chega, e o salto incomoda mais que a espera.
 * - Nada de texto ("Carregando..."): a forma já comunica, e texto que aparece e
 *   some em 500ms só polui.
 */

interface Props {
  /** Mostra o bloco de título + subtítulo da página. */
  titulo?: boolean
  /** Quantos controles desenhar na barra de filtros (0 = sem barra). */
  filtros?: number
  /** Linhas da tabela. 10 é o padrão da paginação — mesma altura do conteúdo real. */
  linhas?: number
  /** Cartões de indicador acima da tabela (dashboard, financeiro). */
  cartoes?: number
  /**
   * Botão primário encostado à direita da barra ("Nova loja", "Nova usuária").
   * Ligado sozinho, já é motivo para a barra existir — em /configuracoes/lojas a
   * barra inteira é só esse botão.
   */
  acaoDireita?: boolean
  /**
   * Painéis empilhados de largura total, para as telas que NÃO são tabela:
   * cartões de seção (/configuracoes/negocio) e blocos de formulário
   * (/configuracoes/impressao). Use com `linhas={0}`.
   */
  paineis?: number
}

export default function Esqueleto({
  titulo = true,
  filtros = 0,
  linhas = 10,
  cartoes = 0,
  acaoDireita = false,
  paineis = 0,
}: Props) {
  return (
    <div className={styles.wrap} aria-busy="true" aria-live="polite" aria-label="Carregando">
      {titulo && (
        <>
          <div className={styles.titulo} />
          <div className={styles.subtitulo} />
        </>
      )}

      {cartoes > 0 && (
        <div className={styles.cartoes}>
          {Array.from({ length: cartoes }).map((_, i) => (
            <div key={i} className={styles.cartao} />
          ))}
        </div>
      )}

      {(filtros > 0 || acaoDireita) && (
        <div className={styles.barra}>
          {/* O primeiro é o campo de busca, que é sempre mais largo. */}
          {Array.from({ length: filtros }).map((_, i) => (
            <div key={i} className={styles.controle} style={{ width: i === 0 ? 260 : 118 }} />
          ))}
          {acaoDireita && <div className={`${styles.controle} ${styles.acao}`} />}
        </div>
      )}

      {paineis > 0 && (
        <div className={styles.paineis}>
          {Array.from({ length: paineis }).map((_, i) => (
            <div key={i} className={styles.painel} />
          ))}
        </div>
      )}

      {linhas > 0 && (
        <div className={styles.tabela}>
          <div className={styles.cabecalho} />
          {Array.from({ length: linhas }).map((_, i) => (
            <div key={i} className={styles.linha}>
              <div className={styles.avatar} />
              <div className={styles.texto} />
              <div className={styles.curta} />
              <div className={styles.curta} />
              <div className={styles.numero} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
