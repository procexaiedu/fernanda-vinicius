/**
 * Data de "hoje" (YYYY-MM-DD) no fuso de Brasília (America/Sao_Paulo).
 * Usar em vez de `new Date().toISOString().slice(0,10)` (que é UTC e vira o dia
 * seguinte no fim da noite no Brasil). en-CA formata como YYYY-MM-DD.
 */
export function todaySP(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/* ── Data digitada ───────────────────────────────────────────────────────────
 *
 * Nasceu dentro de ClienteFormModal e subiu para cá em 15/09, quando a dona
 * esbarrou no calendário ao cadastrar uma cliente no meio da venda:
 *
 *   "Imagina, eu vou tendo que ir mês por mês até chegar no ano de 75."
 *
 * Para data de NASCIMENTO o calendário é o instrumento errado — o alvo está
 * cinquenta anos atrás. Para data de venda ou de conserto ele continua certo,
 * porque o alvo é perto de hoje. Por isso isto não substitui o DatePicker:
 * convive com ele.
 */

/** "YYYY-MM-DD" → "DD/MM/YYYY" para exibição. */
export function toDisplayDate(v: string): string {
  if (!v) return ''
  const [y, m, d] = v.split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y}`
}

/** Auto-insere as barras enquanto digita. */
export function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/**
 * "DD/MM/YYYY" → "YYYY-MM-DD". Devolve '' quando ainda não dá para saber.
 *
 * ACEITA ANO DE 2 DÍGITOS. Foi o que mordeu em 15/09: ela digitou "23/09/75",
 * seis dígitos, e a versão anterior exigia oito — devolvia string vazia e a
 * data de nascimento simplesmente não era salva, sem erro na tela. O cadastro
 * ficava incompleto e ninguém ficava sabendo.
 *
 * A régua para o século é o ano corrente: "75" não pode ser 2075, porque
 * ninguém nasceu no futuro; "09" é 2009. Quem faz 100 anos ou mais precisa
 * digitar os quatro dígitos — o caso existe, e não há como adivinhá-lo.
 */
export function toISODate(display: string): string {
  const digits = display.replace(/\D/g, '')
  if (digits.length !== 6 && digits.length !== 8) return ''

  const dia = digits.slice(0, 2)
  const mes = digits.slice(2, 4)

  let ano: string
  if (digits.length === 8) {
    ano = digits.slice(4, 8)
  } else {
    const dois = Number(digits.slice(4, 6))
    const atual = new Date().getFullYear()
    const seculo = Math.floor(atual / 100) * 100
    // Ano que cairia no futuro pertence ao século passado.
    ano = String(seculo + dois > atual ? seculo - 100 + dois : seculo + dois)
  }

  // Data impossível não vira dado. "32/13/2000" fica vazio em vez de virar
  // uma data que o Postgres recusa depois, no meio do salvamento da venda.
  const d = Number(dia), m = Number(mes), a = Number(ano)
  if (d < 1 || d > 31 || m < 1 || m > 12 || a < 1900) return ''

  return `${ano}-${mes}-${dia}`
}
