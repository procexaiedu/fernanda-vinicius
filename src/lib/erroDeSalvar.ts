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

/** Rede caiu, servidor reiniciando, timeout. */
const SEM_RESPOSTA = /failed to fetch|networkerror|load failed|timeout|aborted/i

export function mensagemDeErroAoSalvar(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e ?? '')

  if (SISTEMA_ATUALIZADO.test(bruto)) {
    return 'O SISTEMA FOI ATUALIZADO ENQUANTO VOCÊ PREENCHIA. '
         + 'RECARREGUE A PÁGINA (F5) E ACEITE O RASCUNHO — NADA DO QUE VOCÊ DIGITOU FOI PERDIDO.'
  }

  if (SEM_RESPOSTA.test(bruto)) {
    return 'O SERVIDOR NÃO RESPONDEU. '
         + 'CONFIRA A INTERNET E TENTE DE NOVO — SEU RASCUNHO ESTÁ GUARDADO.'
  }

  /* Erro que não sabemos traduzir: mostra o original, mas sempre com a parte
   * que tira o susto. Melhor um texto técnico com contexto do que nenhum. */
  return bruto
    ? `NÃO FOI POSSÍVEL SALVAR: ${bruto.toUpperCase()} — SEU RASCUNHO FOI MANTIDO.`
    : 'NÃO FOI POSSÍVEL SALVAR. SEU RASCUNHO FOI MANTIDO — RECARREGUE A PÁGINA E TENTE DE NOVO.'
}
