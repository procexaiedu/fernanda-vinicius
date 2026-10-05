/**
 * O que a operadora alcança — por URL, não por menu.
 *
 * Esconder item da barra lateral não é controle de acesso: basta digitar
 * `/produtos` no endereço. Quatro telas (`/clientes`, `/disparos`, `/estoque`,
 * `/produtos`) não tinham trava nenhuma até 01/09.
 *
 * É uma LISTA DO QUE PODE, não do que não pode: tela nova nasce fora do alcance
 * dela até alguém decidir o contrário. Uma lista de proibições esqueceria a
 * próxima. Quem aplica é o layout de (sistema), por onde toda página passa.
 */
export const OPERADORA_PODE = [
  '/pdv',        // atender e fechar a venda
  '/vendas',     // as vendas do dia — a query já limita a hoje
  '/consertos',  // recebe a peça da cliente no balcão e devolve quando volta
  /*
   * Conferir a caixa que chegou (05/10/2026). Sem isto a operadora de Brasília
   * caía no PDV e a remessa ficava em trânsito esperando a admin. Lá ela só
   * vê as remessas da loja dela, sem custo e sem código (page.tsx), e só
   * confere: enviar, cancelar, devolver e acertar exigem admin no servidor.
   */
  '/estoque/transferencias',
]

export function operadoraPodeVer(pathname: string): boolean {
  return OPERADORA_PODE.some(p => pathname === p || pathname.startsWith(p + '/'))
}
