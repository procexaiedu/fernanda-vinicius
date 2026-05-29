/**
 * Cliente HTTP para o agente local de impressão (fv-print-agent).
 * Ver agent/README.md.
 */

export interface PrinterInfo {
  name: string
  isDefault: boolean
  status: string[]
}

export interface AgentHealth {
  ok: true
  version: string
  agent: 'fv-print-agent'
  platform: string
}

export interface AgentError {
  ok: false
  error: string
}

const STORAGE_BASE_URL = 'fv:print-agent:baseUrl'
const STORAGE_TOKEN = 'fv:print-agent:token'
const STORAGE_PRINTER = 'fv:print-agent:printer'

export function getAgentBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:17777'
  return localStorage.getItem(STORAGE_BASE_URL) ?? 'http://localhost:17777'
}

export function setAgentBaseUrl(url: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_BASE_URL, url.replace(/\/+$/, ''))
}

export function getAgentToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_TOKEN)
}

export function setAgentToken(token: string | null): void {
  if (typeof window === 'undefined') return
  if (token) localStorage.setItem(STORAGE_TOKEN, token)
  else localStorage.removeItem(STORAGE_TOKEN)
}

export function getDefaultPrinter(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_PRINTER)
}

export function setDefaultPrinter(name: string | null): void {
  if (typeof window === 'undefined') return
  if (name) localStorage.setItem(STORAGE_PRINTER, name)
  else localStorage.removeItem(STORAGE_PRINTER)
}

function authHeaders(): Record<string, string> {
  const token = getAgentToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Chrome 142+ ("Local Network Access") bloqueia requests de um site HTTPS para
 * localhost a menos que o fetch sinalize o espaço de endereço alvo. A flag
 * `targetAddressSpace` é específica do Chrome; outros navegadores ignoram.
 * O nome do valor variou entre versões ('local' / 'loopback'), então tentamos
 * em ordem e caímos para o fetch normal se a opção não for suportada.
 */
async function lnaFetch(url: string, init: RequestInit): Promise<Response> {
  const candidates = ['loopback', 'local']
  for (const space of candidates) {
    try {
      return await fetch(url, { ...init, targetAddressSpace: space } as RequestInit)
    } catch (err) {
      // TypeError com valor inválido → tenta o próximo candidato.
      // AbortError ou erro de rede real → propaga.
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      const msg = err instanceof Error ? err.message : ''
      if (!/targetAddressSpace|address space|invalid/i.test(msg)) {
        // Não é erro da flag — pode ser a 1ª tentativa de rede; tenta fetch normal.
        break
      }
    }
  }
  return fetch(url, init)
}

export async function getHealth(signal?: AbortSignal): Promise<AgentHealth> {
  const res = await lnaFetch(`${getAgentBaseUrl()}/health`, {
    signal,
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Agente respondeu HTTP ${res.status}`)
  return res.json()
}

export async function listPrinters(signal?: AbortSignal): Promise<PrinterInfo[]> {
  const res = await lnaFetch(`${getAgentBaseUrl()}/printers`, {
    signal,
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Agente respondeu HTTP ${res.status}`)
  const data = await res.json()
  if (Array.isArray(data.printers)) return data.printers
  if (data.printers && typeof data.printers === 'object') return [data.printers as PrinterInfo]
  return []
}

/**
 * Converte Uint8Array para base64 sem usar Buffer (browser-safe).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export interface PrintResult {
  jobId: number
  bytes: number
}

export async function printJob(printerName: string, jobBytes: Uint8Array, docName?: string): Promise<PrintResult> {
  const body = {
    printer: printerName,
    jobBase64: bytesToBase64(jobBytes),
    docName,
  }
  const res = await lnaFetch(`${getAgentBaseUrl()}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(data.error ?? `Agente respondeu HTTP ${res.status}`)
  }
  return { jobId: data.jobId, bytes: data.bytes }
}
