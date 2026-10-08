/**
 * Cliente da procex-fiscal: emissão, consulta e cancelamento de NFC-e.
 *
 * A procex-fiscal é a plataforma fiscal da própria ProceX (repo
 * procexaiedu/procex-fiscal, produção em fiscal.procexai.tech). Fala direto com
 * a SEFAZ (SVRS, no DF) e expõe a MESMA API da Focus NFe (`/v2/nfce`), então o
 * JSON que `montarNfce` monta vai igual. Substituiu a Focus em 08/10/2026,
 * quando o teste da Focus acabou.
 *
 * Segue o padrão de `src/lib/ycloud.ts`: `fetch` puro, sem SDK. O SDK da
 * procex-fiscal (sdks/typescript) faz o mesmo e não está publicado no npm.
 *
 * Contrato: `GET /v2/openapi.json` da própria plataforma.
 *
 *
 * O QUE MUDOU EM RELAÇÃO À FOCUS
 *
 * - **Um token e uma URL, não um par por ambiente.** O ambiente (homologação ou
 *   produção) é da EMPRESA no painel da procex-fiscal, não da URL. O
 *   `fiscal_emitentes.ambiente` daqui fica só como registro; quem decide é o
 *   painel. Ver PROCEX_FISCAL_URL e PROCEX_FISCAL_TOKEN.
 * - **Os links de XML e DANFE podem vir relativos** (sem PROCEX_FISCAL_URL_PUBLICA
 *   configurada lá): são completados com a URL base daqui.
 * - **Consulta e cancelamento levam `?cnpj=`.** A ref é a mesma em todas as
 *   empresas de um integrador; com o CNPJ não existe "ref ambígua".
 * - **Retorno assíncrono por webhook** (`/api/procex-fiscal-webhook`), assinado
 *   com HMAC. É o que fecha a nota que ficou `pendente` (SEFAZ lenta, contingência).
 *
 *
 * NFC-e É SÍNCRONA
 *
 * A resposta do POST já diz se autorizou ou não (201 autorizado, 422 rejeição
 * da SEFAZ). Se a SEFAZ demora mais de ~20 s, vem 202 `processando_autorizacao`
 * e o resultado chega pelo webhook ou por `consultar`.
 */

/** Registro do ambiente em `fiscal_emitentes`. Não escolhe URL: ver o topo. */
export type AmbienteFiscal = 'homologacao' | 'producao'

interface Config { url: string; token: string }

/**
 * URL e token da procex-fiscal. Só no servidor: o token nunca vai para o
 * navegador (por isso NÃO é `NEXT_PUBLIC_`).
 */
export function configProcexFiscal(): Config | null {
  const url = process.env.PROCEX_FISCAL_URL?.trim().replace(/\/+$/, '')
  const token = process.env.PROCEX_FISCAL_TOKEN?.trim()
  return url && token ? { url, token } : null
}

/** Basic com o token no USUÁRIO e senha vazia, como na Focus (`curl -u 'TOKEN:'`). */
function cabecalhoAuth(token: string): string {
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64')
}

// ─── Resultado ────────────────────────────────────────────────────────────────

/**
 * Status devolvido. Só `autorizado` significa nota válida.
 *
 * `processando_autorizacao` acontece de verdade aqui (SEFAZ lenta, contingência
 * offline): a nota está a caminho e não pode ser tratada como erro.
 */
export type StatusNota =
  | 'autorizado'
  | 'cancelado'
  | 'erro_autorizacao'
  | 'erro_cancelamento'
  | 'processando_autorizacao'
  | 'denegado'
  | 'nao_encontrado'

export interface RespostaNota {
  ok: boolean
  status: StatusNota
  /** Referência da nota (a nossa, `venda-<id>`). Vem em toda resposta e no webhook. */
  ref?: string
  /** CNPJ do emitente, só dígitos. O webhook confere contra a loja da venda. */
  cnpjEmitente?: string
  /** Chave de 44 dígitos com o prefixo "NFe", quando autorizada. */
  chave?: string
  numero?: string
  serie?: string
  /** URL do DANFE em PDF, para mandar à cliente. */
  danfeUrl?: string
  xmlUrl?: string
  /** XML autorizado (nfeProc), quando a consulta é `completa`. */
  xml?: string
  /** Conteúdo do QR Code (URL da SEFAZ com a chave). Vai no cupom 80mm. */
  qrcodeUrl?: string
  /** "Consulte pela chave de acesso em": URL de consulta da UF. */
  urlConsulta?: string
  /** Protocolo de autorização. Só vem na consulta completa. */
  protocolo?: string
  /** cStat da SEFAZ (100 = autorizada, 135 = evento registrado). */
  statusSefaz?: string
  /** Texto do SEFAZ ou da plataforma: é o que diz o que corrigir. */
  mensagem?: string
  /** Corpo cru, para o log. Erro fiscal sem o corpo é impossível de diagnosticar. */
  bruto?: unknown
}

/** Corpo da procex-fiscal: o da Focus, mais `codigo`/`erro` estáveis nos erros. */
export interface CorpoProcex {
  cnpj_emitente?: string
  ref?: string
  status?: string
  status_sefaz?: string
  mensagem_sefaz?: string
  chave_nfe?: string
  numero?: string
  serie?: string
  caminho_danfe?: string
  caminho_xml_nota_fiscal?: string
  qrcode_url?: string
  url_consulta_nf?: string
  xml_nota_fiscal?: string
  protocolo_nota_fiscal?: { numero_protocolo?: string }
  erros?: { campo?: string; mensagem?: string }[]
  codigo?: string
  erro?: string
  mensagem?: string
}

const STATUS_CONHECIDOS: StatusNota[] = [
  'autorizado', 'cancelado', 'erro_autorizacao', 'erro_cancelamento',
  'processando_autorizacao', 'denegado',
]

/**
 * Lê o corpo (do POST, do GET, do DELETE ou do webhook) no formato da tela.
 * Exportada para o webhook e para os testes.
 */
export function interpretar(http: number, corpo: CorpoProcex, base = configProcexFiscal()?.url ?? ''): RespostaNota {
  const bruto = (corpo.status || '') as StatusNota
  const status: StatusNota = STATUS_CONHECIDOS.includes(bruto)
    ? bruto
    : (http === 404 && (!corpo.codigo || corpo.codigo === 'nao_encontrado') ? 'nao_encontrado' : 'erro_autorizacao')

  // O motivo vem em lugares diferentes conforme a falha: validação do payload
  // (`erros`), recusa da SEFAZ (`status_sefaz` + `mensagem_sefaz`) ou erro da
  // plataforma (`mensagem`, com `codigo` estável). Juntar aqui evita "erro
  // desconhecido" na tela quando a resposta explicava direitinho o problema.
  const sefaz = corpo.mensagem_sefaz
    ? [corpo.status_sefaz, corpo.mensagem_sefaz].filter(Boolean).join(' ')
    : undefined
  const mensagem =
    corpo.erros?.map(e => [e.campo, e.mensagem].filter(Boolean).join(': ')).join(' · ') ||
    sefaz ||
    corpo.mensagem ||
    (http >= 400 ? `HTTP ${http}` : undefined)

  return {
    ok: status === 'autorizado',
    status,
    ref:          corpo.ref,
    cnpjEmitente: corpo.cnpj_emitente?.replace(/\D/g, ''),
    chave:        corpo.chave_nfe,
    numero:       corpo.numero,
    serie:        corpo.serie,
    danfeUrl:     corpo.caminho_danfe ? absoluta(corpo.caminho_danfe, base) : undefined,
    xmlUrl:       corpo.caminho_xml_nota_fiscal ? absoluta(corpo.caminho_xml_nota_fiscal, base) : undefined,
    xml:          corpo.xml_nota_fiscal,
    qrcodeUrl:    corpo.qrcode_url,
    urlConsulta:  corpo.url_consulta_nf,
    protocolo:    corpo.protocolo_nota_fiscal?.numero_protocolo,
    statusSefaz:  corpo.status_sefaz,
    mensagem,
    bruto: corpo,
  }
}

/** Sem PROCEX_FISCAL_URL_PUBLICA lá, o link vem relativo ("/arquivos/..."). */
function absoluta(caminho: string, base: string): string {
  return /^https?:\/\//.test(caminho) ? caminho : base + caminho
}

// ─── Chamadas ─────────────────────────────────────────────────────────────────

async function chamar(
  metodo: 'POST' | 'GET' | 'DELETE',
  caminho: string,
  corpo?: unknown,
): Promise<RespostaNota> {
  const cfg = configProcexFiscal()
  if (!cfg) {
    return {
      ok: false,
      status: 'erro_autorizacao',
      mensagem: 'Emissor fiscal não configurado no servidor (PROCEX_FISCAL_URL e PROCEX_FISCAL_TOKEN).',
    }
  }

  let resp: Response
  try {
    resp = await fetch(cfg.url + caminho, {
      method: metodo,
      headers: {
        Authorization: cabecalhoAuth(cfg.token),
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      // A plataforma segura ~20 s esperando a SEFAZ e então responde 202. 30 s
      // cobre isso com folga e não segura o balcão quando a SEFAZ está fora.
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    })
  } catch (e) {
    // Rede caiu ou estourou o tempo. A nota PODE ter sido emitida: quem
    // decide é uma consulta pela referência (ou o webhook), nunca um palpite.
    return {
      ok: false,
      status: 'processando_autorizacao',
      mensagem: e instanceof Error && e.name === 'TimeoutError'
        ? 'O emissor fiscal não respondeu em 30s. A nota pode ter saído: use "Consultar na Receita" antes de emitir de novo.'
        : `Falha de rede ao falar com o emissor fiscal: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  let corpoResp: CorpoProcex = {}
  try { corpoResp = await resp.json() as CorpoProcex } catch { /* 204 e afins */ }

  return interpretar(resp.status, corpoResp, cfg.url)
}

const qCnpj = (cnpj?: string | null) => {
  const d = cnpj?.replace(/\D/g, '')
  return d ? `cnpj=${d}` : ''
}

/**
 * Emite uma NFC-e.
 *
 * `ref` é a nossa referência única e é o que torna a operação **idempotente**:
 * reenviar com a mesma `ref` não gera segunda nota, a plataforma devolve a
 * existente. Usar o id da venda é o que impede nota duplicada quando a
 * operadora clica duas vezes ou a rede cai no meio.
 */
export function emitirNfce(ref: string, nota: unknown) {
  return chamar('POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, nota)
}

/** Consulta pela nossa referência. `completa=true` traz o XML autorizado junto. */
export function consultarNfce(ref: string, completa = false, cnpj?: string | null) {
  const q = [completa ? 'completa=1' : '', qCnpj(cnpj)].filter(Boolean).join('&')
  return chamar('GET', `/v2/nfce/${encodeURIComponent(ref)}${q ? `?${q}` : ''}`)
}

/**
 * Cancela uma nota autorizada.
 *
 * A justificativa é exigida pela SEFAZ e tem **mínimo de 15 caracteres**: a
 * validação está aqui para o erro aparecer antes da viagem, com um texto que
 * diz o que fazer, em vez de voltar como recusa fiscal.
 */
export function cancelarNfce(ref: string, justificativa: string, cnpj?: string | null) {
  const j = justificativa.trim()
  if (j.length < 15) {
    return Promise.resolve<RespostaNota>({
      ok: false,
      status: 'erro_cancelamento',
      mensagem: `A justificativa precisa de ao menos 15 caracteres (tem ${j.length}).`,
    })
  }
  const q = qCnpj(cnpj)
  return chamar('DELETE', `/v2/nfce/${encodeURIComponent(ref)}${q ? `?${q}` : ''}`, { justificativa: j })
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

/**
 * Confere `X-ProceX-Signature: sha256=<hex>` = HMAC-SHA256(corpo CRU, segredo).
 *
 * O corpo tem de ser o texto exato recebido, antes do `JSON.parse`: reserializar
 * muda espaços e ordem e a assinatura não bate. Comparação em tempo constante.
 */
export async function assinaturaValida(corpoCru: string, assinatura: string | null, segredo: string): Promise<boolean> {
  if (!segredo || !assinatura?.startsWith('sha256=')) return false
  const { createHmac, timingSafeEqual } = await import('node:crypto')
  const esperado = Buffer.from('sha256=' + createHmac('sha256', segredo).update(corpoCru).digest('hex'))
  const recebido = Buffer.from(assinatura)
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido)
}

/**
 * CNPJ da loja vindo do join `stores(cnpj)` do supabase-js, que tipa a relação
 * como lista mesmo quando é uma linha só.
 */
export function cnpjDaLoja(stores: unknown): string | null {
  const s = (Array.isArray(stores) ? stores[0] : stores) as { cnpj?: string | null } | null | undefined
  return s?.cnpj ?? null
}
