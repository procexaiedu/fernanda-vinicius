import Esqueleto from '@/components/ui/Esqueleto'

/*
 * PDV: a tela mais lenta do sistema (3608ms em produção, 420 KB — carrega o
 * catálogo inteiro para o leitor de código de barras achar a peça). É formulário,
 * não tabela, daí os "cartões" no lugar das linhas.
 *
 * Aqui o esqueleto importa mais que em qualquer outra tela: é a tela que a
 * funcionária abre no meio do atendimento, com a cliente esperando na frente dela.
 */
export default function Loading() {
  return <Esqueleto cartoes={2} linhas={0} filtros={2} />
}
