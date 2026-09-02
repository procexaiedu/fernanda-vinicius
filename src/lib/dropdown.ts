/**
 * Onde o menu de um dropdown cabe — uma conta só, para os cinco do sistema.
 *
 * Todos eles abriam com `top: rect.bottom + 4` e mais nada. Perto do pé da
 * tela isso corta o menu: no modal de baixa de estoque, "Uso interno /
 * mostruário" — a última opção — ficava metade fora e não havia como alcançar,
 * porque o menu não rolava e a página por trás também não ajudava.
 *
 * Duas decisões que a conta resolve:
 *
 *   1. ABRIR PARA CIMA quando não cabe embaixo e cabe melhor em cima. É o que
 *      o `<select>` nativo faz, e o motivo de ninguém nunca ter reparado nele.
 *
 *   2. LIMITAR A ALTURA ao espaço disponível. Assim o menu nunca ultrapassa a
 *      janela: quando a lista é maior que o espaço, ela rola por dentro. Sem
 *      isto, "abrir para cima" só mudaria o lado pelo qual o menu é cortado.
 *
 * Ancorar pela BASE (`bottom`) ao abrir para cima, e não calcular um `top`, é
 * o que faz o menu crescer para cima sem precisar saber a altura real antes de
 * renderizar — que era a outra fonte de erro: a altura estimada por
 * "itens × 34px" não bate com a renderizada, e o menu vazava assim mesmo.
 */

export interface PosicaoDropdown {
  left: number
  width: number
  /** Definido quando abre para baixo. */
  top?: number
  /** Definido quando abre para cima — distância do menu ao pé da janela. */
  bottom?: number
  /** Teto de altura; passando disso, o menu rola por dentro. */
  maxHeight: number
}

interface Opcoes {
  /** Folga entre o gatilho e o menu. */
  gap?: number
  /** Respiro para a borda da janela. */
  margem?: number
  /** Altura máxima desejada quando há espaço de sobra. */
  altura?: number
  /**
   * Abaixo disto não vale a pena abrir para baixo — o menu ficaria uma fresta.
   * Duas linhas e meia de opção.
   */
  minimo?: number
}

export function posicionarDropdown(
  gatilho: DOMRect,
  { gap = 4, margem = 8, altura = 320, minimo = 140 }: Opcoes = {},
): PosicaoDropdown {
  const espacoAbaixo = window.innerHeight - gatilho.bottom - gap - margem
  const espacoAcima  = gatilho.top - gap - margem

  // Só sobe se embaixo está apertado E em cima cabe mais. Subir por pouco
  // desorienta: o menu aparece onde o olho não está.
  const paraCima = espacoAbaixo < minimo && espacoAcima > espacoAbaixo

  const espaco = paraCima ? espacoAcima : espacoAbaixo

  return {
    left:  gatilho.left,
    width: gatilho.width,
    ...(paraCima
      ? { bottom: window.innerHeight - gatilho.top + gap }
      : { top: gatilho.bottom + gap }),
    // Piso de 120px mesmo em espaço curtíssimo: melhor um menu pequeno que
    // rola do que um que não mostra nada.
    maxHeight: Math.max(120, Math.min(altura, espaco)),
  }
}

/**
 * O scroll veio de DENTRO do menu?
 *
 * Fechar o dropdown em qualquer scroll parece razoável até a lista ser maior
 * que o menu: aí rolar as opções fecha o próprio menu que se está lendo. Foi
 * exatamente o que aconteceu na lista de motivos de baixa.
 */
export function scrollVeioDeDentro(evento: Event, menu: HTMLElement | null): boolean {
  return !!menu && evento.target instanceof Node && menu.contains(evento.target)
}
