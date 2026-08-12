/**
 * Telefone — um formato só na tela.
 *
 * O banco tem TRÊS formatos convivendo (medido em 760 clientes, 12/08/2026):
 *
 *   408  `+5519995672222`   internacional cru, 13 dígitos (55 + DDD + 9 dígitos)
 *   343  `(19) 98263-8400`  já mascarado, 11 dígitos
 *     9  `+551999567222`    internacional cru, 12 dígitos (55 + DDD + 8 dígitos)
 *
 * Vinham de origens diferentes (importação do WhatsApp × cadastro na mão) e a
 * lista mostrava cada um como estava, o que fazia a coluna parecer de outro
 * sistema a cada linha.
 *
 * ATENÇÃO — o bug que isto conserta, e que era pior que o visual: as quatro
 * cópias de `formatPhone` espalhadas pelo projeto faziam `.slice(0, 11)` nos
 * dígitos ANTES de formatar. Num número de 13 dígitos isso corta o fim e produz
 * `(55) 19995-6722` — DDD 55, número errado. Como a máscara também roda ao
 * carregar o formulário de edição, salvar depois de abrir gravava o número
 * corrompido no banco.
 */

/** Só os dígitos, já sem o código do país quando ele estiver presente. */
function nacional(bruto: string): string {
  const d = bruto.replace(/\D/g, '')
  // 55 só é código de país se sobrar um telefone válido depois de tirá-lo — sem
  // essa checagem, um fixo de São Paulo salvo como "5511..." perderia o DDD.
  if (d.length > 11 && d.startsWith('55')) return d.slice(2)
  return d
}

/**
 * Formata para exibição, SEMPRE com o código do país: `+55 (19) 99567-2222`.
 *
 * O `+55` fica explícito de propósito. Todo cliente da loja é brasileiro, então o
 * código não distingue nada no dia a dia — mas é justamente isso que torna um
 * número estrangeiro visível de relance no meio da lista, em vez de passar como
 * se fosse um DDD esquisito.
 *
 * Devolve o valor original se não reconhecer o tamanho: melhor mostrar o que está
 * gravado do que inventar um número plausível.
 */
export function formatarTelefone(bruto: string | null | undefined): string {
  if (!bruto) return '—'
  const d = nacional(bruto)
  if (d.length === 11) return `+55 (${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `+55 (${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return bruto
}

/**
 * Máscara progressiva, para `onChange` de input enquanto a pessoa digita.
 * Diferente da de exibição: precisa formatar número incompleto sem reclamar.
 * O `+55 ` aparece assim que o primeiro dígito entra, para o formato ficar óbvio.
 */
export function mascararTelefone(valor: string): string {
  const d = nacional(valor).slice(0, 11)
  if (!d.length)      return ''
  if (d.length <= 2)  return `+55 (${d}`
  if (d.length <= 6)  return `+55 (${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `+55 (${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `+55 (${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/**
 * Forma canônica para GRAVAR: E.164 sem pontuação (`+5519995672222`).
 *
 * O banco tinha três formatos porque cada tela salvava do jeito que exibia. Com
 * uma forma canônica, buscar por telefone e comparar duplicata passam a funcionar.
 */
export function normalizarTelefone(bruto: string): string {
  const d = nacional(bruto)
  return d ? `+55${d}` : ''
}

/**
 * Valida o formato exigido: código do país + DDD + número (10 ou 11 dígitos
 * depois do 55). Devolve a mensagem de erro, ou null se estiver certo.
 */
export function validarTelefone(bruto: string): string | null {
  const d = nacional(bruto)
  if (!d)             return 'Telefone é obrigatório.'
  if (d.length < 10)  return 'Faltam dígitos — informe DDD + número.'
  if (d.length > 11)  return 'Dígitos demais. Confira o número.'
  // DDD brasileiro válido: 11 a 99, e nenhum começa com 0.
  const ddd = Number(d.slice(0, 2))
  if (ddd < 11)       return 'DDD inválido.'
  // Celular no Brasil tem 9 na frente dos 8 dígitos desde 2016.
  if (d.length === 11 && d[2] !== '9') return 'Celular com 11 dígitos deve começar com 9 após o DDD.'
  return null
}

/** Só dígitos com o 55 na frente — o que o wa.me espera. */
export function telefoneParaWhatsApp(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  const d = nacional(bruto)
  if (d.length !== 10 && d.length !== 11) return null
  return `55${d}`
}
