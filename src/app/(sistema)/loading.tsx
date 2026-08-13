import Esqueleto from '@/components/ui/Esqueleto'

/*
 * Dashboard: 5 cartões de indicador e nenhuma tabela no topo — o esqueleto
 * espelha isso. Era a tela com 16 consultas e 1167ms em produção, então é onde a
 * espera sem feedback mais aparecia. Ver src/components/ui/Esqueleto.tsx.
 */
export default function Loading() {
  return <Esqueleto cartoes={5} linhas={0} />
}
