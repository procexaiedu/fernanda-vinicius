#!/usr/bin/env node
/**
 * Carga da lista de exclusão de disparo (13/10/2026). Só escreve em
 * fv.disparo_exclusoes; fv.customers é só lida.
 *
 * 1. HISTÓRICO: para cada mensagem já enviada, pergunta o status real à YCloud
 *    (o webhook nunca atualizou o banco) e exclui falha permanente:
 *    131026 -> invalido, 130403 -> bloqueio, 131050 -> opt_out.
 *    Saldo/taxa/131049 não excluem. Sem YCLOUD_API_KEY, pula esta parte.
 * 2. LIMPEZA (--limpeza): regras de scripts/disparo-classificar.mjs sobre os
 *    clientes de cada loja (lugar, emergência, número inválido, sem primeiro nome).
 *    Duvidosos NÃO entram: vão para o CSV "revisar".
 *
 * Sem --aplicar não grava nada: só conta e, com --csv=<pasta>, gera
 *   disparo-exclusoes-fevinicius.csv          (todos que saem, + resumo por motivo)
 *   disparo-exclusoes-fevinicius-revisar.csv  (duvidosos)
 * CSV em UTF-8 com BOM e separador ";" (abre direto no Excel).
 *
 * Uso (migrações 20261013 e 20261013b aplicadas antes de --aplicar; Node 23.6+):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [YCLOUD_API_KEY=...] \
 *     node scripts/disparo-carga-exclusoes.mjs [--limpeza] [--csv=C:/Users/x/Desktop] [--aplicar]
 */

import fs from 'node:fs'
import path from 'node:path'
import { classificar } from './disparo-classificar.mjs'

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const YK = process.env.YCLOUD_API_KEY
const arg = n => process.argv.find(a => a === `--${n}` || a.startsWith(`--${n}=`))
const APLICAR = !!arg('aplicar')
const LIMPEZA = !!arg('limpeza')
const CSV = arg('csv')?.split('=')[1]
if (!URL_ || !KEY) { console.error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }

const MOTIVO_YCLOUD = { '131026': 'invalido', '130403': 'bloqueio', '131050': 'opt_out' }
const ROTULO = {
  invalido: 'Número inválido / sem WhatsApp', bloqueio: 'Bloqueado', opt_out: 'Pediu para não receber',
  lugar: 'Número de lugar/empresa', emergencia: 'Emergência/serviço', sem_nome_utilizavel: 'Sem primeiro nome utilizável',
}
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'fv', 'Content-Profile': 'fv' }

async function lerTudo(tabela, select, filtro = '') {
  const out = []
  for (let de = 0; ; de += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${tabela}?select=${select}${filtro}&order=id&offset=${de}&limit=1000`, { headers: h })
    if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status} ${await r.text()}`)
    const lote = await r.json()
    out.push(...lote)
    if (lote.length < 1000) return out
  }
}

/** Igual a src/lib/ycloud.ts#normalizePhoneBR. */
function e164(raw) {
  let n = (raw ?? '').replace(/\D/g, '')
  if (n.startsWith('55') && (n.length === 12 || n.length === 13)) return '+' + n
  if (n.length === 10 || n.length === 11) return '+55' + n
  return null
}

const lojas = new Map((await lerTudo('stores', 'id,name')).map(s => [s.id, s.name]))
const clientes = await lerTudo('customers', 'id,name,phone,origin_store_id', '&whatsapp_opt_out=eq.false')
const porId = new Map(clientes.map(c => [c.id, c]))

const sai = new Map()     // `${loja}|${chave}` -> linha
const revisar = []

// 1. Histórico (YCloud)
if (YK) {
  const linhas = await lerTudo('disparo_destinatarios', 'id,customer_id,telefone_e164,ycloud_message_id,disparos(store_id)', '&ycloud_message_id=not.is.null')
  let i = 0
  const trabalhador = async () => {
    while (i < linhas.length) {
      const l = linhas[i++]
      const r = await fetch(`https://api.ycloud.com/v2/whatsapp/messages/${l.ycloud_message_id}`, { headers: { 'X-API-Key': YK } })
      if (!r.ok) throw new Error(`YCloud HTTP ${r.status}`)
      const m = await r.json()
      if (m.status !== 'failed') continue
      const codigo = String(m.whatsappApiError?.code ?? m.errorCode ?? '')
      const motivo = MOTIVO_YCLOUD[codigo]
      const loja = Array.isArray(l.disparos) ? l.disparos[0]?.store_id : l.disparos?.store_id
      if (!motivo || !loja || !l.telefone_e164) continue
      sai.set(`${loja}|${l.telefone_e164}`, {
        store_id: loja, telefone_e164: l.telefone_e164, telefone: l.telefone_e164, customer_id: l.customer_id,
        nome: porId.get(l.customer_id)?.name ?? '', motivo, origem: 'historico',
        detalhe: `${codigo} ${m.whatsappApiError?.message ?? m.errorMessage ?? ''}`.trim(),
      })
    }
  }
  await Promise.all(Array.from({ length: 5 }, trabalhador))
  console.log(`histórico: ${linhas.length} mensagens lidas`)
} else {
  console.log('histórico: pulado (sem YCLOUD_API_KEY)')
}

// 2. Limpeza (regras)
if (LIMPEZA) {
  const vendas = await lerTudo('sales', 'id,customer_id,store_id', '&status=eq.completed&customer_id=not.is.null')
  const comprou = new Set(vendas.map(v => `${v.store_id}|${v.customer_id}`))
  for (const c of clientes) {
    if (!c.origin_store_id) continue
    const r = classificar(c.name, c.phone, comprou.has(`${c.origin_store_id}|${c.id}`))
    if (r.acao === 'manter') continue
    const tel = e164(c.phone)
    const linha = {
      store_id: c.origin_store_id, telefone_e164: tel, telefone: c.phone ?? '', customer_id: c.id,
      nome: c.name ?? '', motivo: r.motivo, origem: 'limpeza', detalhe: r.detalhe,
    }
    if (r.acao === 'revisar') { revisar.push(linha); continue }
    // Telefone que não normaliza não cabe na tabela (check do E.164): o envio
    // já recusa esse número ("telefone inválido"), então só entra no relatório.
    const k = `${c.origin_store_id}|${tel ?? 'sem-e164:' + c.id}`
    if (!sai.has(k)) sai.set(k, linha)
  }
}

const todos = [...sai.values()]
const conta = {}
for (const e of todos) conta[e.motivo] = (conta[e.motivo] ?? 0) + 1
console.log(`saem da lista: ${todos.length}`, conta, `| revisar: ${revisar.length}`)

if (CSV) {
  const q = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const linhaCsv = e => [lojas.get(e.store_id) ?? e.store_id, e.nome, e.telefone, ROTULO[e.motivo] ?? e.motivo, e.origem, e.detalhe].map(q).join(';')
  const cab = ['loja', 'nome', 'telefone', 'motivo', 'origem', 'detalhe'].join(';')
  const ordem = (a, b) => (a.motivo + a.nome).localeCompare(b.motivo + b.nome)
  const resumo = ['', 'RESUMO POR MOTIVO;quantidade', ...Object.entries(conta).map(([m, n]) => `${q(ROTULO[m] ?? m)};${n}`), `TOTAL;${todos.length}`]
  fs.writeFileSync(path.join(CSV, 'disparo-exclusoes-fevinicius.csv'),
    '﻿' + [cab, ...todos.sort(ordem).map(linhaCsv), ...resumo].join('\r\n') + '\r\n')
  fs.writeFileSync(path.join(CSV, 'disparo-exclusoes-fevinicius-revisar.csv'),
    '﻿' + [cab, ...revisar.sort(ordem).map(linhaCsv)].join('\r\n') + '\r\n')
  console.log(`CSVs gravados em ${CSV}`)
}

if (!APLICAR) { console.log('Nada gravado no banco (rode com --aplicar).'); process.exit(0) }

let novas = 0, ja = 0, fora = 0
for (const e of todos) {
  if (!e.telefone_e164) { fora++; continue }
  const corpo = {
    store_id: e.store_id, telefone_e164: e.telefone_e164, customer_id: e.customer_id,
    motivo: e.motivo, origem: e.origem, detalhe: e.detalhe,
  }
  const r = await fetch(`${URL_}/rest/v1/disparo_exclusoes`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(corpo),
  })
  if (r.ok) novas++
  else if (r.status === 409) ja++
  else throw new Error(`insert: HTTP ${r.status} ${await r.text()}`)
}
console.log(`Gravadas ${novas}; ${ja} já estavam; ${fora} sem telefone válido (o envio já recusa, ficam só no relatório).`)
