import Esqueleto from '@/components/ui/Esqueleto'

/* Ver o porquê e a medição em src/components/ui/Esqueleto.tsx. */
export default function Loading() {
  return <Esqueleto filtros={7} linhas={10} cartoes={4} />
}
