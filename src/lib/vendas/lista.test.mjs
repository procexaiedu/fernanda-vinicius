/*
 * Lista de Vendas: lotes que cabem na URL e o caso da troca.
 * Rodar: node --test src/lib/vendas/lista.test.mjs   (Node 24, lê .ts direto)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { emLotes } from '../supabase/em-lotes.ts'
import { resumirVendas, faltaPagar } from './lista.ts'

/* Mesmo limite que derrubou a lista em 02/10: o Kong responde 414 acima de ~8 KB. */
const LIMITE_URL = 8 * 1024
const BASE = 'https://db.procexai.tech/rest/v1/sale_payments?select=sale_id%2Camount&sale_id=in.'

function falsoPostgrest(linhasPorId) {
  const urls = []
  const consulta = lote => {
    const url = BASE + encodeURIComponent(`(${lote.join(',')})`)
    urls.push(url)
    if (url.length > LIMITE_URL) return Promise.resolve({ data: null, error: { message: 'URI Too Long', code: '414' } })
    return Promise.resolve({ data: lote.flatMap(id => linhasPorId(id)), error: null })
  }
  return { consulta, urls }
}

test('a lista inteira num .in() estoura a URL (o defeito) e em lotes não', async () => {
  const ids = Array.from({ length: 320 }, () => randomUUID())
  const { consulta } = falsoPostgrest(id => [{ sale_id: id, amount: 10 }])

  const tudoDeUmaVez = await consulta(ids)
  assert.equal(tudoDeUmaVez.error?.code, '414')

  const { consulta: emPartes, urls } = falsoPostgrest(id => [{ sale_id: id, amount: 10 }])
  const linhas = await emLotes(ids, emPartes, 'os pagamentos')
  assert.equal(linhas.length, 320)
  assert.equal(urls.length, 4)
  assert.ok(urls.every(u => u.length < LIMITE_URL), 'todo lote cabe na URL')
})

test('falha num lote lança, não devolve lista pela metade', async () => {
  const ids = Array.from({ length: 250 }, () => randomUUID())
  let n = 0
  const consulta = lote => Promise.resolve(++n === 2
    ? { data: null, error: { message: 'boom' } }
    : { data: lote.map(id => ({ sale_id: id })), error: null })
  const erroOriginal = console.error
  console.error = () => {}
  try {
    await assert.rejects(emLotes(ids, consulta, 'os itens'), /Não foi possível carregar os itens: boom/)
  } finally {
    console.error = erroOriginal
  }
})

test('lista vazia não consulta', async () => {
  let chamou = false
  assert.deepEqual(await emLotes([], () => { chamou = true; return Promise.resolve({ data: [], error: null }) }, 'x'), [])
  assert.equal(chamou, false)
})

test('caso a045bf00: R$11 pago + troca de R$324 quita a venda de R$335 e conta como troca', () => {
  const venda = 'a045bf00-0000-4000-8000-000000000000'
  const resumo = resumirVendas({
    itens: [{ sale_id: venda }],
    pagamentos: [{ sale_id: venda, amount: '11.00' }],
    /* Como o PDV grava: sale_id = venda nova, original_sale_id NULL. */
    trocas: [{ id: 'troca-1', sale_id: venda, original_sale_id: null }],
    devolvidos: [{ exchange_id: 'troca-1', quantity: 1, unit_price: '324.00' }],
  })
  const r = resumo.get(venda)
  assert.equal(r.temTroca, true)
  assert.equal(r.pago + r.creditoTroca, 335)
  assert.equal(faltaPagar(335, r), 0)
})

test('venda sem troca e pagamento parcial continua devendo; original_sale_id também marca troca', () => {
  const resumo = resumirVendas({
    itens: [{ sale_id: 'a' }, { sale_id: 'a' }],
    pagamentos: [{ sale_id: 'a', amount: 300 }],
    trocas: [{ id: 't', sale_id: 'nova', original_sale_id: 'antiga' }],
    devolvidos: [],
  })
  assert.equal(resumo.get('a').itens, 2)
  assert.equal(resumo.get('a').temTroca, false)
  assert.equal(faltaPagar(645, resumo.get('a')), 345)
  assert.equal(resumo.get('antiga').temTroca, true)
  assert.equal(faltaPagar(100, undefined), 100)
})
