import Esqueleto from '@/components/ui/Esqueleto'

/*
 * Aqui não há tabela: são os cinco cartões de seção (Pagamentos, Políticas de
 * Venda, Precificação, Clientes, Dashboard), um embaixo do outro.
 * Ver src/components/ui/Esqueleto.tsx.
 */
export default function Loading() {
  return <Esqueleto paineis={5} linhas={0} />
}
