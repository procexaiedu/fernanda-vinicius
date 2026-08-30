/**
 * CEP — máscara e consulta de endereço.
 *
 * A busca por CEP já existia, mas só dentro de `FornecedorFormModal.tsx`: uma
 * `handleCEPChange` de 30 linhas colada no meio do componente. Cliente ficou de
 * fora e a operadora digitava rua, cidade e UF na mão — é onde nasce "Campians",
 * "SAO PAULO" e "sp".
 *
 * Aqui a consulta vira uma função só, sem React, para servir os dois cadastros.
 *
 * Decisões que valem para todo consumidor:
 *
 * - **Erro nunca vira endereço.** ViaCEP responde 200 com `{ "erro": true }`
 *   para CEP inexistente. Quem não checar esse campo preenche o formulário com
 *   `undefined` e apaga o que a pessoa já tinha digitado.
 *
 * - **Timeout.** Sem ele um ViaCEP fora do ar deixa o spinner girando e a
 *   operadora achando que o formulário travou, no meio de uma venda.
 *
 * - **Nunca bloquear a digitação.** Toda falha volta como `ok: false` com
 *   motivo legível; o campo continua editável. CEP de cidade pequena é único
 *   para o município inteiro e vem sem logradouro — isso é resposta válida, não
 *   erro, e a pessoa completa o resto na mão.
 */

export interface EnderecoCep {
  cep:        string
  logradouro: string
  bairro:     string
  cidade:     string
  uf:         string
}

export type ResultadoCep =
  | { ok: true;  endereco: EnderecoCep }
  | { ok: false; erro: string }

const TIMEOUT_MS = 6000

/** `01310100` → `01310-100`. Corta em 8 dígitos: CEP não tem mais que isso. */
export function mascararCep(bruto: string): string {
  const d = (bruto || '').replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`
}

/** Só os dígitos — é o que a API recebe. */
export function digitosCep(bruto: string): string {
  return (bruto || '').replace(/\D/g, '').slice(0, 8)
}

/** Pronto para consultar: 8 dígitos e não é `00000000`. */
export function cepCompleto(bruto: string): boolean {
  const d = digitosCep(bruto)
  return d.length === 8 && !/^0{8}$/.test(d)
}

/**
 * Consulta o CEP no ViaCEP. Não lança: erro de rede, timeout e CEP inexistente
 * voltam todos como `ok: false`, porque para quem está preenchendo o formulário
 * os três significam a mesma coisa — segue digitando na mão.
 */
export async function buscarCep(bruto: string): Promise<ResultadoCep> {
  const d = digitosCep(bruto)
  if (!cepCompleto(d)) return { ok: false, erro: 'CEP incompleto.' }

  const abortar = new AbortController()
  const relogio = setTimeout(() => abortar.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: abortar.signal })
    if (!res.ok) return { ok: false, erro: 'Não foi possível consultar o CEP.' }

    const data = await res.json()
    // O 200 mentiroso do ViaCEP.
    if (data?.erro) return { ok: false, erro: 'CEP não encontrado.' }

    return {
      ok: true,
      endereco: {
        cep:        mascararCep(d),
        logradouro: data.logradouro || '',
        bairro:     data.bairro     || '',
        cidade:     data.localidade || '',
        uf:         (data.uf || '').toUpperCase(),
      },
    }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar o CEP.' }
  } finally {
    clearTimeout(relogio)
  }
}
