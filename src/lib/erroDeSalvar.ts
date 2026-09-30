/**
 * Traduz a falha de salvamento para quem está no balcão.
 *
 * Nasceu em 07/09: a dona estava com 46 linhas de uma compra de Brasília na
 * tela quando um deploy subiu, e recebeu isto:
 *
 *   SERVER ACTION "405B43…D899" WAS NOT FOUND ON THE SERVER.
 *   READ MORE: HTTPS://NEXTJS.ORG/DOCS/MESSAGES/FAILED-TO-FIND-SERVER-ACTION
 *
 * O Next.js gera um identificador para cada ação de servidor NO BUILD. A página
 * aberta antes do deploy guarda os identificadores antigos; depois que a versão
 * nova sobe, eles não existem mais e o servidor recusa. Não é bug da tela nem
 * da compra: acontece com qualquer formulário aberto durante uma atualização.
 *
 * O conserto de verdade é só recarregar — e o rascunho local sobrevive, porque
 * ele só é apagado quando o salvamento dá certo. Mas isso ninguém adivinha
 * lendo "SERVER ACTION NOT FOUND", e no meio de uma compra grande o susto é de
 * ter perdido tudo.
 */

/** A mensagem que a versão nova do sistema derruba a página antiga. */
const SISTEMA_ATUALIZADO = /server action|failed to find server action|was not found on the server/i

/*
 * O que o proxy (src/proxy.ts) responde a um "Salvar" sem sessão válida. Os
 * textos são a mensagem do erro que chega aqui — mantenha as regex batendo.
 */
export const MSG_SESSAO_EXPIRADA = 'Sua sessão expirou.'
export const MSG_AUTH_INSTAVEL = 'O login está instável no servidor.'
const SESSAO_EXPIRADA = /sess[aã]o expirou/i
const AUTH_INSTAVEL = /login est[aá] inst[aá]vel/i
/* Resposta que não é da ação (HTML no lugar do payload do Next). */
const RESPOSTA_INESPERADA = /unexpected response was received from the server/i

/** Rede caiu, servidor reiniciando, timeout. */
const SEM_RESPOSTA = /failed to fetch|networkerror|load failed|timeout|aborted/i

/**
 * `temRascunho` muda o que a mensagem pode prometer, e isso não é detalhe.
 *
 * A COMPRA guarda rascunho no navegador: recarregar é seguro e traz tudo de
 * volta. A VENDA não guarda nada — recarregar apaga o que está na tela. Dizer
 * "recarregue, seu rascunho está salvo" no PDV seria mandar a dona jogar fora
 * a venda que ela acabou de digitar, com a cliente na frente.
 *
 * Enquanto ela NÃO recarrega, nada se perde: a falha é do envio, e o formulário
 * continua preenchido. É isso que a mensagem sem rascunho precisa dizer.
 */
export function mensagemDeErroAoSalvar(
  e: unknown,
  opcoes: { temRascunho?: boolean } = {},
): string {
  const bruto = e instanceof Error ? e.message : String(e ?? '')
  const comRascunho = opcoes.temRascunho ?? false

  if (SISTEMA_ATUALIZADO.test(bruto)) {
    return comRascunho
      ? 'O SISTEMA FOI ATUALIZADO ENQUANTO VOCÊ PREENCHIA. '
        + 'RECARREGUE A PÁGINA (F5) E ACEITE O RASCUNHO — NADA DO QUE VOCÊ DIGITOU FOI PERDIDO.'
      /* Sem rascunho, recarregar É a perda. O aviso tem de vir antes do
       * conselho, senão ela recarrega por reflexo e perde a venda. */
      : 'O SISTEMA FOI ATUALIZADO E ESTA PÁGINA FICOU VELHA. '
        + 'ANOTE O QUE ESTÁ NA TELA ANTES DE RECARREGAR (F5) — RECARREGAR AGORA APAGA ESTA VENDA.'
  }

  /*
   * Sessão vencida: F5 mandaria para /login e, sem rascunho, apagaria a tela.
   * Entrar em OUTRA aba renova o cookie que esta aba também usa — ela volta
   * aqui e clica em Salvar com tudo preenchido.
   */
  /*
   * Resposta que não veio do Next: com o proxy tratando sessão, hoje isso é
   * quase sempre o gateway sem o app — o "Update the service" do Portainer
   * derruba o container por 3 a 5 min. A action nem chegou a rodar.
   */
  if (RESPOSTA_INESPERADA.test(bruto)) {
    return 'O SISTEMA ESTÁ REINICIANDO (ATUALIZAÇÃO). ESPERE 1 OU 2 MINUTOS E CLIQUE EM SALVAR DE NOVO — '
      + 'SE PEDIR LOGIN, ENTRE EM OUTRA ABA E VOLTE AQUI. '
      + (comRascunho ? 'SEU RASCUNHO ESTÁ GUARDADO.' : 'NÃO RECARREGUE ESTA PÁGINA, O QUE VOCÊ DIGITOU CONTINUA AQUI.')
  }

  if (SESSAO_EXPIRADA.test(bruto)) {
    return 'SUA SESSÃO EXPIROU. ABRA O SISTEMA EM OUTRA ABA (CTRL+T), ENTRE COM SEU LOGIN '
      + 'E VOLTE AQUI PARA CLICAR EM SALVAR DE NOVO — '
      + (comRascunho ? 'SEU RASCUNHO ESTÁ GUARDADO.' : 'NÃO RECARREGUE ESTA PÁGINA, O QUE VOCÊ DIGITOU CONTINUA AQUI.')
  }

  if (AUTH_INSTAVEL.test(bruto)) {
    return 'O SERVIDOR DE LOGIN FALHOU POR UM INSTANTE. ESPERE ALGUNS SEGUNDOS E CLIQUE EM SALVAR DE NOVO — '
      + (comRascunho ? 'SEU RASCUNHO ESTÁ GUARDADO.' : 'NÃO RECARREGUE A PÁGINA.')
  }

  /*
   * Sem resposta NÃO quer dizer que não gravou: o servidor pode ter terminado
   * e a resposta se perdido no caminho. Mandar "clique de novo" sem conferir
   * duplicava venda/compra inteira — o salvamento ainda não é idempotente.
   */
  if (SEM_RESPOSTA.test(bruto)) {
    return 'O SERVIDOR NÃO RESPONDEU A TEMPO — PODE TER SALVO OU NÃO. '
      + 'ABRA A LISTA EM OUTRA ABA E CONFIRA SE JÁ APARECE ANTES DE CLICAR EM SALVAR DE NOVO — '
      + (comRascunho ? 'SEU RASCUNHO ESTÁ GUARDADO.' : 'NÃO RECARREGUE ESTA PÁGINA, O QUE VOCÊ DIGITOU CONTINUA AQUI.')
  }

  /* Erro que não sabemos traduzir: mostra o original, mas sempre com a parte
   * que tira o susto. Melhor um texto técnico com contexto do que nenhum. */
  const fim = comRascunho
    ? ' — SEU RASCUNHO FOI MANTIDO.'
    : ' — NÃO RECARREGUE: O QUE VOCÊ DIGITOU CONTINUA NA TELA.'

  return bruto
    ? `NÃO FOI POSSÍVEL SALVAR: ${bruto.toUpperCase()}${fim}`
    : `NÃO FOI POSSÍVEL SALVAR.${fim}`
}
