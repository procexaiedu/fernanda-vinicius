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

/*
 * Nomes que NÃO são nome — vieram da agenda como marcador, não como pessoa.
 * "Oi" está aqui porque a saudação do template já começa com "Oi": o disparo
 * sairia "Oi Oi".
 */
const NAO_E_NOME = new Set([
  'sem nome', 'sem', 'oi', 'ola', 'teste', 'test', 'cliente',
  'nome', 'na', 'desconhecido', 'contato',
  // Tratamento não é nome: "Dra. Juliana" saudava "Oi Dra".
  'dr', 'dra', 'sr', 'sra', 'srta', 'exma', 'prof', 'profa',
])
/*
 * "ale" saiu desta lista depois de rodar contra a base inteira: "Ale Fernandes"
 * é cliente de verdade, apelido de Alexandre/Alessandra. Toda palavra aqui tem
 * que ser conferida contra os nomes reais antes de entrar — a lista bloqueia
 * mensagem para gente que existe.
 *
 * "na" fica: vem de "N/A", e ninguém na base se chama assim.
 */

/** Só as letras, sem acento, em minúscula — a chave de comparação. */
function chave(p: string): string {
  return p.replace(/[^\p{L}]/gu, '')
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .toLocaleLowerCase('pt-BR')
}

/**
 * Como chamar a pessoa numa mensagem. Devolve `null` quando não há como.
 *
 * Existe por causa de um disparo que ia sair "Oi Sem", "Oi 2" e "Oi Oi" para 20
 * clientes: a agenda importada trouxe marcador no lugar do nome. Um `{{1}}`
 * ruim não é detalhe estético — é a loja mandando mensagem de estranho.
 *
 * É a MESMA função que o envio usa para decidir se manda e para montar o
 * `{{1}}`. Separar as duas coisas (uma validação aqui, um `split(' ')[0]` lá)
 * é como elas passam a discordar: a validação aprova e o envio usa outro
 * pedaço do nome.
 *
 * Não pega cegamente a primeira palavra. Rodado contra os 3.272 clientes reais,
 * isso derrubava gente de verdade:
 *
 *   "~ Luis"                        → a primeira palavra é "~"
 *   "M A R I A N A"                 → a primeira palavra é "M"
 *   "Cliente Ana Rita / Ex Da Forum" → a primeira palavra é "Cliente"
 *
 * Todos são clientes que existem. A regra passou a ser: **a primeira palavra
 * que sirva**, e não a primeira palavra.
 *
 * Duas letras PASSAM de propósito — "Ju", "Lu", "Ma" e "Ru" estão na base e são
 * apelidos de verdade. Cortar em três derrubaria clientes para resolver um
 * problema que não é deles.
 */
export function primeiroNomeParaSaudacao(bruto: string | null | undefined): string | null {
  /*
   * Corta a anotação antes de qualquer coisa. A agenda trouxe muito nome com
   * observação colada — "Juliana(amiga Fe) Rocha", "Ana Rita / Ex Da Forum".
   * Sem cortar, a primeira palavra vira "Juliana(amiga", que é descartada por
   * ter parêntese, e a saudação cai na palavra seguinte: "Oi Fe" — o nome da
   * amiga, não o da cliente.
   */
  const limpo = (bruto ?? '')
    .split(/[(/|]/)[0]
    .trim()
    .replace(/\s+/g, ' ')
  if (!limpo) return null

  const palavras = limpo.split(' ')

  /*
   * "M A R I A N A" — nome digitado com espaço entre cada letra. Palavra por
   * palavra nunca serviria; junto, é "Mariana".
   */
  if (palavras.length >= 3 && palavras.every(p => p.replace(/[^\p{L}]/gu, '').length === 1)) {
    const junto = palavras.join('').replace(/[^\p{L}]/gu, '')
    return junto.length >= 2 ? formatarNomeProprio(junto) : null
  }

  for (const palavra of palavras) {
    const k = chave(palavra)
    if (k.length < 2) continue        // "~", "M", "!", "2", "98226-8615"
    if (NAO_E_NOME.has(k)) continue   // "Sem", "nome", "Oi", "Cliente"

    // Tira pontuação de fora, preserva acento e hífen de dentro: "(Ana)" → "Ana".
    const enxuto = palavra.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')

    /*
     * Dígito no meio da palavra derruba tudo. `1v1n3 Bu3n0` (Ivinne Bueno
     * escrito com números) passava pela contagem de letras e saía "Oi V1n".
     * Nome de gente não tem número: se tem, não é nome, é apelido de rede
     * social ou lixo de importação.
     */
    if (!/^[\p{L}''-]+$/u.test(enxuto)) continue

    return formatarNomeProprio(enxuto)
  }

  return null
}

/** Atalho de leitura: dá para saudar esta pessoa pelo nome? */
export function nomeServeParaSaudacao(bruto: string | null | undefined): boolean {
  return primeiroNomeParaSaudacao(bruto) !== null
}
