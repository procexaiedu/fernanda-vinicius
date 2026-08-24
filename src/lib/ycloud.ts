/**
 * Cliente da YCloud — envio de template de WhatsApp e leitura de templates.
 *
 * Veio de `supabase/functions/_shared/ycloud.ts`, que rodava como Edge Function
 * no Supabase Cloud. O self-hosted da ProceX não tem runtime de Edge Functions
 * — nenhum dos 9 projetos usa — então a lógica passou a viver aqui dentro do
 * app. Não se perdeu nada: o código nunca dependeu de Deno, só de `fetch`.
 *
 * Doc: https://docs.ycloud.com/reference/whatsapp-messaging-examples
 */

const YCLOUD_MSG = 'https://api.ycloud.com/v2/whatsapp/messages'
const YCLOUD_TPL = 'https://api.ycloud.com/v2/whatsapp/templates'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** WABA da Fernanda. Sobrescrevível por FV_WABA_ID. */
export const WABA_ID_PADRAO = '2640848569584957'

export function wabaId() {
  return process.env.FV_WABA_ID || WABA_ID_PADRAO
}

/** Chave da API. Sem ela nada envia — é o único segredo que este módulo exige. */
export function apiKey(): string | null {
  return process.env.YCLOUD_API_KEY || null
}

/** Normaliza telefone BR -> E.164 (+55...). O cadastro vem como "(DD) 9XXXX-XXXX". */
export function normalizePhoneBR(raw: string): string | null {
  let n = (raw || '').replace(/\D/g, '')
  if (n.startsWith('55') && (n.length === 12 || n.length === 13)) {
    // já tem DDI
  } else if (n.length === 10 || n.length === 11) {
    n = '55' + n
  } else {
    return null
  }
  return '+' + n
}

/** O WhatsApp recusa parâmetro com quebra de linha, tab ou 4+ espaços. Nunca devolve vazio. */
export function sanitizeParam(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\s+/g, ' ').trim()
  return s.length ? s : '.'
}

// ─── Templates ────────────────────────────────────────────────────────────────

export type HeaderFormat = 'IMAGE' | 'TEXT' | 'VIDEO' | 'DOCUMENT' | 'NONE'

export interface TemplateMeta {
  name: string
  language: string
  category: string       // MARKETING | UTILITY | AUTHENTICATION
  status: string         // APPROVED | PENDING | REJECTED | ...
  headerFormat: HeaderFormat
  bodyText: string
  bodyVarCount: number   // quantas variáveis {{n}} o corpo tem
  bodyExample: string[]
  footer: string | null
}

interface ComponenteApi {
  type?: string
  format?: string
  text?: string
  example?: { body_text?: string[][] }
}

interface TemplateApi {
  name: string
  language: string
  category?: string
  status?: string
  components?: ComponenteApi[]
}

/** Conta variáveis {{1}}, {{2}}… distintas num texto. */
export function countVars(text: string): number {
  const nums = new Set<number>()
  for (const m of (text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]))
  return nums.size
}

function parseTemplate(t: TemplateApi): TemplateMeta {
  const comps = t.components ?? []
  const tipo = (c: ComponenteApi) => (c.type || '').toUpperCase()
  const header = comps.find(c => tipo(c) === 'HEADER')
  const body   = comps.find(c => tipo(c) === 'BODY')
  const footer = comps.find(c => tipo(c) === 'FOOTER')
  const bodyText = body?.text ?? ''
  return {
    name: t.name,
    language: t.language,
    category: t.category ?? '',
    status: (t.status ?? '').toUpperCase(),
    headerFormat: ((header?.format ?? 'NONE').toUpperCase()) as HeaderFormat,
    bodyText,
    bodyVarCount: countVars(bodyText),
    bodyExample: body?.example?.body_text?.[0] ?? [],
    footer: footer?.text ?? null,
  }
}

export async function listTemplates(chave: string, waba: string): Promise<TemplateMeta[]> {
  const url = `${YCLOUD_TPL}?filter.wabaId=${encodeURIComponent(waba)}&limit=100&includeTotal=false`
  const res = await fetch(url, { headers: { 'X-API-Key': chave }, cache: 'no-store' })
  if (!res.ok) throw new Error(`YCloud templates HTTP ${res.status}`)
  const data = await res.json().catch(() => ({}))
  return ((data.items ?? []) as TemplateApi[]).map(parseTemplate)
}

export async function getTemplateMeta(
  chave: string, waba: string, name: string, language: string,
): Promise<TemplateMeta | null> {
  const url = `${YCLOUD_TPL}?filter.wabaId=${encodeURIComponent(waba)}`
            + `&filter.name=${encodeURIComponent(name)}&limit=100`
  const res = await fetch(url, { headers: { 'X-API-Key': chave }, cache: 'no-store' })
  if (!res.ok) throw new Error(`YCloud templates HTTP ${res.status}`)
  const data = await res.json().catch(() => ({}))
  const items = ((data.items ?? []) as TemplateApi[]).map(parseTemplate)
  return items.find(t => t.name === name && t.language === language)
      ?? items.find(t => t.name === name)
      ?? null
}

// ─── Envio ────────────────────────────────────────────────────────────────────

export interface SendTemplateInput {
  apiKey: string
  from: string
  to: string
  templateName: string
  language: string
  bodyParams: string[]  // já cortado no nº de variáveis do template
  imageUrl?: string     // só quando o template tem header de imagem
  externalId?: string
}

export interface SendResult {
  ok: boolean
  messageId?: string
  error?: string
  retriable?: boolean
}

export async function sendTemplate(i: SendTemplateInput): Promise<SendResult> {
  const components: unknown[] = []
  if (i.imageUrl) {
    components.push({ type: 'header', parameters: [{ type: 'image', image: { link: i.imageUrl } }] })
  }
  if (i.bodyParams.length) {
    components.push({
      type: 'body',
      parameters: i.bodyParams.map(t => ({ type: 'text', text: sanitizeParam(t) })),
    })
  }

  const body = {
    from: i.from,
    to: i.to,
    type: 'template',
    ...(i.externalId ? { externalId: i.externalId } : {}),
    template: { name: i.templateName, language: { code: i.language }, components },
  }

  // 429 e 5xx são transitórios — a YCloud limita taxa e um lote grande esbarra
  // nisso com frequência. Sem o retry, a peça vira "falhou" por acidente.
  const maxTentativas = 3
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const res = await fetch(YCLOUD_MSG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': i.apiKey },
        body: JSON.stringify(body),
        cache: 'no-store',
      })

      if (res.status === 429 || res.status >= 500) {
        if (tentativa < maxTentativas) { await sleep(600 * tentativa); continue }
        return { ok: false, retriable: true, error: `HTTP ${res.status} (transitório)` }
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, error: data?.error?.message || data?.message || `HTTP ${res.status}` }
      }
      return { ok: true, messageId: data?.id }
    } catch (e) {
      if (tentativa < maxTentativas) { await sleep(600 * tentativa); continue }
      return { ok: false, retriable: true, error: String(e) }
    }
  }
  return { ok: false, error: 'inalcançável' }
}
