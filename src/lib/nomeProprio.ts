/**
 * Formatação de nome de pessoa para GRAVAR.
 *
 * A base tem o mesmo tipo de nome escrito de três jeitos — "MONICA CARVALHO",
 * "Vanessa Godinho", "thalita de oliveira" — porque cada pessoa digita de um jeito
 * e nada normalizava na hora de salvar. Numa lista ordenada isso salta aos olhos.
 *
 * A regra é: quem cadastra escreve como quiser; o sistema formata ao salvar.
 * Não formatamos enquanto a pessoa digita — o cursor pularia de posição e brigar
 * com o campo é pior que o problema que isso resolve.
 */

/*
 * Conectivos ficam em minúscula ("Maria da Silva", não "Maria Da Silva"), EXCETO
 * quando abrem o nome — "Da Silva" como sobrenome isolado existe.
 */
const CONECTIVOS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas', 'a', 'o',
])

/*
 * Siglas e nomes que NÃO devem virar Capitalizado: continuam como estão. Sem esta
 * lista, "ME" (microempresa) viraria "Me" e "LTDA" viraria "Ltda" — este último até
 * é aceitável, mas "SP" virando "Sp" não.
 */
const MANTER_MAIUSCULO = new Set([
  'ME', 'MEI', 'EPP', 'LTDA', 'EIRELI', 'SA', 'CNPJ', 'CPF',
  'SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'GO', 'DF', 'PE', 'CE', 'PA', 'MA',
  'II', 'III', 'IV',
])

/**
 * Uma palavra: capitaliza a primeira LETRA e minúscula o resto.
 *
 * Tem que ser a primeira letra, não o primeiro caractere: em "(santa" o caractere
 * zero é o parêntese, e capitalizá-lo deixava "(santa" intacto — foi assim que
 * "(santa costura)" virava "(santa Costura)".
 */
function capitalizarPalavra(p: string): string {
  const i = p.search(/\p{L}/u)
  if (i < 0) return p
  return p.slice(0, i)
    + p.charAt(i).toLocaleUpperCase('pt-BR')
    + p.slice(i + 1).toLocaleLowerCase('pt-BR')
}

/**
 * "MARIA DA SILVA" → "Maria da Silva"
 * "thalita de oliveira (santa costura)" → "Thalita de Oliveira (Santa Costura)"
 * "ANA D'ÁVILA" → "Ana d'Ávila"
 *
 * Devolve string vazia para entrada vazia; nunca lança.
 */
export function formatarNomeProprio(bruto: string | null | undefined): string {
  const limpo = (bruto ?? '').trim().replace(/\s+/g, ' ')
  if (!limpo) return ''

  /*
   * Só normaliza quando o nome está TODO em maiúsculas ou TODO em minúsculas.
   *
   * Se já vem com caixa mista, quem digitou escolheu a grafia — "iPhone", "McDonald",
   * "LeKa" — e reescrever seria destruir uma decisão consciente. É a diferença entre
   * corrigir descuido e sobrescrever intenção.
   */
  const temMinuscula = /\p{Ll}/u.test(limpo)
  const temMaiuscula = /\p{Lu}/u.test(limpo)
  if (temMinuscula && temMaiuscula) return limpo

  return limpo
    .split(' ')
    .map((palavra, i) => {
      // Preserva a pontuação de fora ao decidir: "(SANTA" → olha "SANTA".
      const nucleo = palavra.replace(/[^\p{L}\p{N}']/gu, '')
      if (!nucleo) return palavra

      if (MANTER_MAIUSCULO.has(nucleo.toLocaleUpperCase('pt-BR'))) {
        return palavra.toLocaleUpperCase('pt-BR')
      }

      if (i > 0 && CONECTIVOS.has(nucleo.toLocaleLowerCase('pt-BR'))) {
        return palavra.toLocaleLowerCase('pt-BR')
      }

      // "d'ávila" e "maria-clara": capitaliza depois do apóstrofo e do hífen também.
      return palavra
        .split(/(['-])/)
        .map(parte => (parte === "'" || parte === '-') ? parte : capitalizarPalavra(parte))
        .join('')
    })
    .join(' ')
}
