/**
 * A CHAVE ÚNICA da emissão de nota pelo sistema.
 *
 * Desligada por padrão (08/10): a emissão apontava para a Focus, cujo teste
 * acabou, e a troca para a procex-fiscal (fiscal.procexai.tech) ainda não
 * entrou. Enquanto isso a tela mostra "Em breve" no lugar de "Emitir nota
 * fiscal" e o servidor recusa emitir e consultar, mesmo que alguém chame a
 * server action direto.
 *
 * Para religar: `NEXT_PUBLIC_EMISSAO_NOTA_ATIVA=true` nas variáveis do serviço
 * `fevinicius_web` e um novo build (o `NEXT_PUBLIC_` é gravado no build, e é o
 * que deixa a MESMA chave valer na tela e no servidor). Não precisa mexer em
 * mais nada: `habilitado` em `fiscal_emitentes` continua sendo a trava por loja.
 *
 * Selo "sem nota", filtro da lista e cancelamento não passam por aqui.
 */
export const EMISSAO_NOTA_ATIVA = emissaoAtiva(process.env.NEXT_PUBLIC_EMISSAO_NOTA_ATIVA)

/** Só o texto exato `true` liga. Ausente, vazio, `1`, `sim`: desligado. */
export function emissaoAtiva(valor: string | undefined): boolean {
  return valor === 'true'
}

export const MSG_EMISSAO_EM_BREVE =
  'A emissão de nota pelo sistema está chegando. Por enquanto, siga como hoje.'
