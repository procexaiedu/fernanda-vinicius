/**
 * CPF — máscara e validação de dígitos verificadores.
 *
 * Estava duplicado: a validação vivia dentro de ClienteFormModal e a máscara
 * existia em três lugares (clientes, venda, nota fiscal), cada uma escrita à
 * mão. Subiu para cá em 15/09, quando o cadastro da cliente passou a ser
 * editável também de dentro da venda — e o CPF preenchido no balcão precisa
 * valer a mesma coisa que o preenchido em /clientes.
 */

/** Formata enquanto digita: 000.000.000-00. */
export function mascararCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3)  return d
  if (d.length <= 6)  return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9)  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/**
 * Valida os dois dígitos verificadores.
 *
 * Rejeita também os 11 dígitos repetidos (111.111.111-11 e companhia), que
 * passam na conta do verificador mas não são CPF de ninguém.
 */
export function validarCpf(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i)
  let r = (sum * 10) % 11
  if (r === 10 || r === 11) r = 0
  if (r !== parseInt(d[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i)
  r = (sum * 10) % 11
  if (r === 10 || r === 11) r = 0
  return r === parseInt(d[10])
}
