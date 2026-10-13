#!/usr/bin/env node
/**
 * Carga inicial da lista de exclusão a partir dos disparos já feitos (13/10/2026).
 *
 * Lê cada mensagem enviada (fv.disparo_destinatarios com ycloud_message_id),
 * pergunta o status REAL à YCloud (o webhook nunca atualizou o banco: tudo ficou
 * "enviado") e, para falha permanente, inclui a exclusão na loja que enviou.
 *
 *   131026 -> invalido   (sem WhatsApp)
 *   130403 -> bloqueio
 *   131050 -> opt_out
 * Saldo/taxa/131049 não excluem.
 *
 * Sem --aplicar só mostra a contagem (não escreve nada). Telefone não vai para
 * o repositório nem para o log.
 *
 * Uso (precisa da migração 20261013_disparo_exclusoes aplicada antes):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... YCLOUD_API_KEY=... \
 *     node scripts/disparo-carga-exclusoes.mjs [--aplicar]
 */

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const YK = process.env.YCLOUD_API_KEY
const APLICAR = process.argv.includes('--aplicar')
if (!URL_ || !KEY || !YK) { console.error('Faltam SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou YCLOUD_API_KEY.'); process.exit(1) }

const MOTIVO = { '131026': 'invalido', '130403': 'bloqueio', '131050': 'opt_out' }
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'fv', 'Content-Profile': 'fv' }

async function rest(path, init = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers ?? {}) } })
  if (!r.ok && r.status !== 409) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`)
  return r.status === 204 || init.method === 'POST' ? null : r.json()
}

const linhas = []
for (let de = 0; ; de += 1000) {
  const lote = await rest(`disparo_destinatarios?select=id,customer_id,telefone_e164,ycloud_message_id,disparos(store_id)&ycloud_message_id=not.is.null&order=id&offset=${de}&limit=1000`)
  linhas.push(...lote)
  if (lote.length < 1000) break
}

const achados = new Map()   // `${loja}|${tel}` -> exclusão
let i = 0
async function trabalhador() {
  while (i < linhas.length) {
    const l = linhas[i++]
    const r = await fetch(`https://api.ycloud.com/v2/whatsapp/messages/${l.ycloud_message_id}`, { headers: { 'X-API-Key': YK } })
    if (!r.ok) throw new Error(`YCloud HTTP ${r.status} na mensagem ${l.ycloud_message_id}`)
    const m = await r.json()
    if (m.status !== 'failed') continue
    const codigo = String(m.whatsappApiError?.code ?? m.errorCode ?? '')
    const motivo = MOTIVO[codigo]
    const loja = Array.isArray(l.disparos) ? l.disparos[0]?.store_id : l.disparos?.store_id
    if (!motivo || !loja || !l.telefone_e164) continue
    achados.set(`${loja}|${l.telefone_e164}`, {
      store_id: loja, telefone_e164: l.telefone_e164, customer_id: l.customer_id,
      motivo, origem: 'historico', detalhe: `${codigo} ${m.whatsappApiError?.message ?? m.errorMessage ?? ''}`.trim(),
    })
  }
}
await Promise.all(Array.from({ length: 5 }, trabalhador))

const porMotivo = {}
for (const e of achados.values()) porMotivo[e.motivo] = (porMotivo[e.motivo] ?? 0) + 1
console.log(`${linhas.length} mensagens lidas; ${achados.size} números para excluir:`, porMotivo)

if (!APLICAR) { console.log('Nada gravado (rode com --aplicar).'); process.exit(0) }

let novas = 0
for (const e of achados.values()) {
  const r = await fetch(`${URL_}/rest/v1/disparo_exclusoes`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(e),
  })
  if (r.ok) novas++
  else if (r.status !== 409) throw new Error(`insert: HTTP ${r.status} ${await r.text()}`)
}
console.log(`Gravadas ${novas} (as outras já estavam na lista).`)
