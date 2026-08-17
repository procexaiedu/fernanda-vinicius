import Esqueleto from '@/components/ui/Esqueleto'

/*
 * Três controles (busca, loja, "exibir inativas") mais o botão "Nova usuária".
 *
 * É a aba mais lenta das cinco: a página faz quatro consultas em paralelo, mais
 * a RPC de e-mails e o cálculo de metas por usuária. Era aqui que a troca de aba
 * mais parecia travamento. Ver src/components/ui/Esqueleto.tsx.
 */
export default function Loading() {
  return <Esqueleto filtros={3} acaoDireita linhas={6} />
}
