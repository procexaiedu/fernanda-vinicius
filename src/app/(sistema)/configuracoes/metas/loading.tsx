import Esqueleto from '@/components/ui/Esqueleto'

/*
 * A barra de contexto tem o alternador padrão/mês, a navegação de mês e o botão
 * "Gerar comissões" à direita — três controles mais a ação. As linhas são as
 * vendedoras ativas. Ver src/components/ui/Esqueleto.tsx.
 *
 * Vale também para a troca de MÊS, não só para a entrada na aba: as setas
 * navegam por querystring e recarregam a página inteira no servidor.
 */
export default function Loading() {
  return <Esqueleto filtros={3} acaoDireita linhas={6} />
}
