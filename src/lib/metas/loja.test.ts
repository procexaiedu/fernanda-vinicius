// Rodar: node --experimental-strip-types --test src/lib/metas/loja.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  META_PADRAO, lerConfigMetaLoja, metaDoMes, baseDaVenda, limitesDoMesSP,
  diasRestantes, progressoDaLoja, apurarMes,
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
} from './loja.ts'

test('sem configuração: R$ 60 mil, 4% se bater, 3% se não', () => {
  const cfg = lerConfigMetaLoja(null)
  assert.deepEqual(cfg, META_PADRAO)
  assert.equal(metaDoMes(cfg, '2026-10'), 60000)
})

test('meta própria do mês vence a padrão; campo estragado volta ao padrão', () => {
  const cfg = lerConfigMetaLoja({ meta: 50000, pctBateu: 'x', porMes: { '2026-12': 90000, 'lixo': 1 } })
  assert.equal(metaDoMes(cfg, '2026-12'), 90000)
  assert.equal(metaDoMes(cfg, '2026-11'), 50000)
  assert.equal(cfg.pctBateu, 4)
  assert.deepEqual(Object.keys(cfg.porMes), ['2026-12'])
})

test('conserto fora: venda de R$500 com R$80 de conserto conta R$420 (09/09)', () => {
  assert.equal(baseDaVenda(500, 80, 0), 420)
})

test('troca: devolve R$100, leva R$200, conta R$100 (06/10)', () => {
  assert.equal(baseDaVenda(200, 0, 100), 100)
})

test('troca em que leva menos do que devolveu não fica negativa', () => {
  assert.equal(baseDaVenda(80, 0, 100), 0)
})

test('mês recortado em Brasília, não no fuso do servidor', () => {
  assert.deepEqual(limitesDoMesSP('2026-10'), { inicio: '2026-10-01T00:00:00-03:00', fim: '2026-11-01T00:00:00-03:00' })
  assert.deepEqual(limitesDoMesSP('2026-12'), { inicio: '2026-12-01T00:00:00-03:00', fim: '2027-01-01T00:00:00-03:00' })
  // 31/10 às 22h em Brasília = 01/11 01h UTC: continua sendo outubro
  const venda = new Date('2026-10-31T22:00:00-03:00').getTime()
  const { inicio, fim } = limitesDoMesSP('2026-10')
  assert.ok(venda >= new Date(inicio).getTime() && venda < new Date(fim).getTime())
})

test('dias restantes contam hoje', () => {
  assert.equal(diasRestantes('2026-10', '2026-10-08'), 24)
  assert.equal(diasRestantes('2026-10', '2026-10-31'), 1)
  assert.equal(diasRestantes('2026-09', '2026-10-08'), 0)
  assert.equal(diasRestantes('2026-11', '2026-10-08'), 30)
})

test('painel: realizado, falta, média diária e % ', () => {
  const p = progressoDaLoja(META_PADRAO, '2026-10', 24000, '2026-10-08')
  assert.equal(p.meta, 60000)
  assert.equal(p.falta, 36000)
  assert.equal(p.pct, 40)
  assert.equal(p.diasRestantes, 24)
  assert.equal(p.mediaDiaria, 1500)
  assert.equal(p.bateu, false)
  assert.equal(p.pctComissao, 3)
})

test('bateu a meta: falta zero, média zero, 4%', () => {
  const p = progressoDaLoja(META_PADRAO, '2026-10', 61000, '2026-10-20')
  assert.equal(p.bateu, true)
  assert.equal(p.falta, 0)
  assert.equal(p.mediaDiaria, 0)
  assert.equal(p.pctComissao, 4)
})

test('apuração: loja não bate, 3% sobre a base de cada vendedora', () => {
  const vendas = [
    { id: 'v1', seller_id: 'alba', total: 500 },   // R$80 de conserto
    { id: 'v2', seller_id: 'alba', total: 200 },   // troca com crédito de R$100
    { id: 'v3', seller_id: 'rayane', total: 1000 },
    { id: 'v4', seller_id: null, total: 300 },      // sem vendedora: meta sim, comissão não
  ]
  const r = apurarMes(vendas, new Map([['v1', 80]]), new Map([['v2', 100]]), META_PADRAO, '2026-10', '2026-10-08')
  assert.equal(r.progresso.realizado, 420 + 100 + 1000 + 300)
  assert.equal(r.semVendedora, 300)
  const alba = r.porVendedora.find((c: { sellerId: string }) => c.sellerId === 'alba')
  assert.deepEqual(alba, { sellerId: 'alba', vendas: 2, base: 520, pct: 3, comissao: 15.6 })
})

test('apuração: loja bate, 4% sobre o mês inteiro (não só o que passou da meta)', () => {
  const cfg = { ...META_PADRAO, meta: 1000 }
  const r = apurarMes([{ id: 'a', seller_id: 's', total: 1500 }], new Map(), new Map(), cfg, '2026-10', '2026-10-08')
  assert.equal(r.progresso.bateu, true)
  assert.equal(r.porVendedora[0].comissao, 60)
})
