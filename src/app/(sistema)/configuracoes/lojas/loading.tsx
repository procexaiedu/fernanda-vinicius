import Esqueleto from '@/components/ui/Esqueleto'

/*
 * A barra de /configuracoes/lojas é só o botão "Nova Loja", encostado à direita —
 * daí `acaoDireita` sem filtro nenhum. A rede tem poucas lojas, então 4 linhas
 * já cobrem a altura real. Ver src/components/ui/Esqueleto.tsx.
 */
export default function Loading() {
  return <Esqueleto acaoDireita linhas={4} />
}
