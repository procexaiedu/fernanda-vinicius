/**
 * Cliente da Focus NFe — emissão, consulta e cancelamento de NFC-e.
 *
 * Segue o padrão de `src/lib/ycloud.ts`: `fetch` puro, sem SDK. A Focus tem
 * biblioteca oficial, e não usamos pelo mesmo motivo de lá — são quatro
 * chamadas HTTP, e o SDK traria uma dependência a mais para manter, com
 * versões próprias, só para montar uma requisição que cabe em dez linhas.
 *
 * Doc: https://doc.focusnfe.com.br/reference/emitir_nfce.md
 *
 *
 * POR QUE A FOCUS
 *
 * Ela aceita **somente certificado A1** — o A3 depende de token físico
 * plugado, e os nossos servidores são em nuvem. Foi o critério que decidiu, em
 * 01/09. Ver a task `29588978`.
 *
 *
 * NFC-e É SÍNCRONA
 *
 * Diferente da NF-e, a resposta do POST já diz se autorizou ou não. Não há fila
 * nem polling obrigatório — o que importa para o balcão: a operadora fecha a
 * venda e sabe na hora.
 *
 * Mesmo assim, `consultar` existe: rede cai no meio, e aí a única forma de
 * saber se a nota saiu é perguntar pela referência.
 */

/** URLs por ambiente. O de homologação NÃO é o de produção com um parâmetro. */
const BASES = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao:    'https://api.focusnfe.com.br',
} as const

export type AmbienteFiscal = keyof typeof BASES

/**
 * Token da Focus. **São dois, um por ambiente** — usar o de produção contra a
 * URL de homologação (ou o contrário) devolve 403, não um erro explicativo.
 */
export function tokenFocus(ambiente: AmbienteFiscal): string | null {
  return (ambiente === 'producao'
    ? process.env.FOCUS_NFE_TOKEN_PRODUCAO
    : process.env.FOCUS_NFE_TOKEN_HOMOLOGACAO) || null
}

/**
 * Basic com o token no USUÁRIO e senha VAZIA.
 *
 * Os dois-pontos finais não são detalhe: `Base64("token")` sem eles não
 * autentica. É o formato que o `curl -u 'TOKEN:'` da doc produz.
 */
function cabecalhoAuth(token: string): string {
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64')
}

// ─── Resultado ────────────────────────────────────────────────────────────────

/**
 * Status devolvido pela Focus. Só `autorizado` significa nota válida.
 *
 * `processando_autorizacao` não deveria acontecer em NFC-e, que é síncrona —
 * mas está aqui porque a doc não garante que nunca acontece, e tratar como
 * erro uma nota que estava a caminho seria pior que esperar.
 */
export type StatusNota =
  | 'autorizado'
  | 'cancelado'
  | 'erro_autorizacao'
  | 'processando_autorizacao'
  | 'denegado'
  | 'nao_encontrado'

export interface RespostaNota {
  ok: boolean
  status: StatusNota
  /** Chave de 44 dígitos, quando autorizada. */
  chave?: string
  numero?: string
  serie?: string
  /** URL do DANFE em PDF, para mandar à cliente. */
  danfeUrl?: string
  xmlUrl?: string
  /** Texto do SEFAZ — é o que diz o que corrigir. */
  mensagem?: string
  /** Corpo cru, para o log. Erro fiscal sem o corpo é impossível de diagnosticar. */
  bruto?: unknown
}

interface CorpoFocus {
  status?: string
  status_sefaz?: string
  mensagem_sefaz?: string
  chave_nfe?: string
  numero?: string
  serie?: string
  caminho_danfe?: string
  caminho_xml_nota_fiscal?: string
  erros?: { campo?: string; mensagem?: string }[]
  codigo?: string
  mensagem?: string
}

function interpretar(http: number, corpo: CorpoFocus): RespostaNota {
  const status = (corpo.status || '') as StatusNota

  // A Focus devolve o motivo em três lugares diferentes conforme o tipo de
  // falha: validação nossa (`erros`), recusa do SEFAZ (`mensagem_sefaz`) ou
  // erro da própria API (`mensagem`). Juntar aqui evita "erro desconhecido"
  // na tela quando a resposta explicava direitinho o problema.
  const mensagem =
    corpo.erros?.map(e => [e.campo, e.mensagem].filter(Boolean).join(': ')).join(' · ') ||
    corpo.mensagem_sefaz ||
    corpo.mensagem ||
    (http >= 400 ? `HTTP ${http}` : undefined)

  return {
    ok: status === 'autorizado',
    status: status || (http === 404 ? 'nao_encontrado' : 'erro_autorizacao'),
    chave:    corpo.chave_nfe,
    numero:   corpo.numero,
    serie:    corpo.serie,
    danfeUrl: corpo.caminho_danfe ? absoluta(corpo.caminho_danfe) : undefined,
    xmlUrl:   corpo.caminho_xml_nota_fiscal ? absoluta(corpo.caminho_xml_nota_fiscal) : undefined,
    mensagem,
    bruto: corpo,
  }
}

/** A Focus devolve caminho relativo ("/arquivos_development/..."), não URL. */
function absoluta(caminho: string): string {
  return caminho.startsWith('http') ? caminho : BASES.producao + caminho
}

// ─── Chamadas ─────────────────────────────────────────────────────────────────

async function chamar(
  ambiente: AmbienteFiscal,
  metodo: 'POST' | 'GET' | 'DELETE',
  caminho: string,
  corpo?: unknown,
): Promise<RespostaNota> {
  const token = tokenFocus(ambiente)
  if (!token) {
    return {
      ok: false,
      status: 'erro_autorizacao',
      mensagem: `Token da Focus não configurado para ${ambiente}. Ver FOCUS_NFE_TOKEN_*.`,
    }
  }

  let resp: Response
  try {
    resp = await fetch(BASES[ambiente] + caminho, {
      method: metodo,
      headers: {
        Authorization: cabecalhoAuth(token),
        'Content-Type': 'application/json',
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      // A NFC-e é síncrona: a Focus só responde depois de o SEFAZ responder.
      // 30s é folgado para o caminho normal e curto o bastante para não
      // segurar o balcão quando o SEFAZ está fora.
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    // Rede caiu ou estourou o tempo. A nota PODE ter sido emitida — quem
    // decide é uma consulta pela referência, nunca um novo POST.
    return {
      ok: false,
      status: 'processando_autorizacao',
      mensagem: e instanceof Error && e.name === 'TimeoutError'
        ? 'A Focus não respondeu em 30s. A nota pode ter saído — consulte pela referência antes de reemitir.'
        : `Falha de rede ao falar com a Focus: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  let corpoResp: CorpoFocus = {}
  try { corpoResp = await resp.json() as CorpoFocus } catch { /* 204 e afins */ }

  return interpretar(resp.status, corpoResp)
}

/**
 * Emite uma NFC-e.
 *
 * `ref` é a nossa referência única e é o que torna a operação **idempotente**:
 * reenviar com a mesma `ref` não gera segunda nota — a Focus devolve a
 * existente. Usar o id da venda é o que impede nota duplicada quando a
 * operadora clica duas vezes ou a rede cai no meio.
 */
export function emitirNfce(ambiente: AmbienteFiscal, ref: string, nota: unknown) {
  return chamar(ambiente, 'POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, nota)
}

/** Consulta pela nossa referência. `completa=true` traz o XML junto. */
export function consultarNfce(ambiente: AmbienteFiscal, ref: string, completa = false) {
  return chamar(ambiente, 'GET', `/v2/nfce/${encodeURIComponent(ref)}${completa ? '?completa=1' : ''}`)
}

/**
 * Cancela uma nota autorizada.
 *
 * A justificativa é exigida pelo SEFAZ e tem **mínimo de 15 caracteres** — a
 * validação está aqui para o erro aparecer antes da viagem, com um texto que
 * diz o que fazer, em vez de voltar como recusa fiscal.
 */
export function cancelarNfce(ambiente: AmbienteFiscal, ref: string, justificativa: string) {
  const j = justificativa.trim()
  if (j.length < 15) {
    return Promise.resolve<RespostaNota>({
      ok: false,
      status: 'erro_autorizacao',
      mensagem: `A justificativa precisa de ao menos 15 caracteres (tem ${j.length}).`,
    })
  }
  return chamar(ambiente, 'DELETE', `/v2/nfce/${encodeURIComponent(ref)}`, { justificativa: j })
}


// ─── Cadastro da empresa ──────────────────────────────────────────────────────

/**
 * Campos do `POST /v2/empresas`, conferidos na doc em 02/09.
 *
 * Doc: https://doc.focusnfe.com.br/reference/criar_empresa.md
 */
export interface EmpresaFocus {
  nome: string
  cnpj: string
  inscricao_estadual?: string
  regime_tributario?: number
  cnae_fiscal?: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  municipio: string
  uf: string
  cep: string
  telefone?: string
  email?: string

  /** Modelo 65. É o que a loja emite. */
  habilita_nfce?: boolean
  /** Modelo 55 — precisa dele para a nota de REMESSA entre as duas lojas. */
  habilita_nfe?: boolean

  /**
   * CSC e id do token, um par por ambiente.
   *
   * O de produção veio do Hiper (Configurações → Loja → Cupom fiscal), com
   * `id_token = 1`. O de homologação não existia e a contadora vai gerar no
   * portal da SEFAZ-DF.
   */
  csc_nfce_producao?: string
  id_token_nfce_producao?: number
  csc_nfce_homologacao?: string
  id_token_nfce_homologacao?: number

  /**
   * ⚠️ O `.pfx` em base64 e a senha, no MESMO POST.
   *
   * **O caminho recomendado NÃO é este: é subir o certificado pelo painel da
   * Focus.** Assim o arquivo nunca passa pelo nosso código, nem por log, nem
   * por variável de ambiente, nem por backup — e o que a gente guarda é só o
   * token, que dá para rotacionar.
   *
   * Estes dois campos existem para automação e para o `dry_run`. Se um dia
   * forem usados de verdade, a regra é: ler de arquivo no ato, mandar, e não
   * guardar em lugar nenhum.
   */
  arquivo_certificado_base64?: string
  senha_certificado?: string
}

export interface RespostaEmpresa {
  ok: boolean
  id?: number
  /** Token da empresa, quando a Focus devolve na criação. */
  token?: string
  mensagem?: string
  bruto?: unknown
}

/**
 * Cadastra (ou valida) a empresa na conta da Focus.
 *
 * `dryRun` usa o `?dry_run=1` da API: valida tudo — inclusive o certificado e a
 * senha — e **não persiste**. É o jeito de conferir o cadastro antes de criar
 * de verdade, e o primeiro passo que vale rodar.
 */
export async function cadastrarEmpresa(
  ambiente: AmbienteFiscal,
  empresa: EmpresaFocus,
  dryRun = false,
): Promise<RespostaEmpresa> {
  const token = tokenFocus(ambiente)
  if (!token) {
    return { ok: false, mensagem: `Token da Focus não configurado para ${ambiente}.` }
  }

  let resp: Response
  try {
    resp = await fetch(`${BASES[ambiente]}/v2/empresas${dryRun ? '?dry_run=1' : ''}`, {
      method: 'POST',
      headers: { Authorization: cabecalhoAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(empresa),
      signal: AbortSignal.timeout(60_000),   // instalar certificado é lento
    })
  } catch (e) {
    return { ok: false, mensagem: `Falha de rede: ${e instanceof Error ? e.message : String(e)}` }
  }

  let corpo: Record<string, unknown> = {}
  try { corpo = await resp.json() as Record<string, unknown> } catch { /* sem corpo */ }

  const erros = corpo.erros as { campo?: string; mensagem?: string }[] | undefined
  const mensagem =
    erros?.map(e => [e.campo, e.mensagem].filter(Boolean).join(': ')).join(' · ') ||
    (corpo.mensagem as string | undefined) ||
    (resp.ok ? undefined : `HTTP ${resp.status}`)

  return {
    ok: resp.ok,
    id: corpo.id as number | undefined,
    token: corpo.token as string | undefined,
    mensagem,
    bruto: corpo,
  }
}
