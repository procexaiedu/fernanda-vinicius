import Esqueleto from '@/components/ui/Esqueleto'

/*
 * Quatro blocos de formulário (status do agente, conexão, impressora padrão,
 * instalação). O painel de categorias fica na coluna da direita e só aparece
 * para admin — no telefone ele já desce para baixo, então a coluna única do
 * esqueleto serve para os dois casos. Ver src/components/ui/Esqueleto.tsx.
 */
export default function Loading() {
  return <Esqueleto paineis={4} linhas={0} />
}
