// Rodar: node --experimental-strip-types --test src/lib/recebimentos.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
import { calcularRecebimentos } from './recebimentos.ts'

/*
 * Mesmos casos de supabase/tests/20261015_taxas_cartao_fluxo_caixa.test.sql.
 * Taxas da planilha da Laranjinha (13/10/2026): Visa crédito 2x–6x = 2,81%,
 * Visa crédito à vista = 2,57%, Visa débito = 0,91%.
 */

test('caso motivador: R$100 crédito 3x Visa (2,81%) → 3 parcelas líquidas em +31/+62/+93', () => {
  const p = calcularRecebimentos(100, 3, 2.81, '2026-10-14', 'credit')
  assert.deepEqual(p.map(x => x.dataPrevista), ['2026-11-14', '2026-12-15', '2027-01-15'])
  assert.deepEqual(p.map(x => x.bruto), [33.34, 33.33, 33.33])
  assert.deepEqual(p.map(x => x.liquido), [32.41, 32.39, 32.39])
  const soma = (k: 'bruto' | 'liquido' | 'taxa') => Math.round(p.reduce((s, x) => s + x[k], 0) * 100) / 100
  assert.equal(soma('bruto'), 100)
  assert.equal(soma('liquido'), 97.19) // 100 × (1 − 2,81%)
  assert.equal(soma('taxa'), 2.81)
})

test('crédito à vista: uma parcela em +31 dias', () => {
  const p = calcularRecebimentos(250, 1, 2.57, '2026-10-14', 'credit')
  assert.deepEqual(p, [{ parcela: 1, dataPrevista: '2026-11-14', bruto: 250, taxa: 6.43, liquido: 243.57 }])
})

test('débito na sexta cai na segunda (1 dia útil)', () => {
  const p = calcularRecebimentos(100, 1, 0.91, '2026-10-16', 'debit')
  assert.deepEqual(p, [{ parcela: 1, dataPrevista: '2026-10-19', bruto: 100, taxa: 0.91, liquido: 99.09 }])
})

test('débito ignora parcelas informadas', () => {
  assert.equal(calcularRecebimentos(80, 3, 0.91, '2026-10-14', 'debit').length, 1)
})

test('sem taxa (Hipercard, 7x–12x): líquido = bruto', () => {
  const p = calcularRecebimentos(700, 7, null, '2026-10-14', 'credit')
  assert.equal(p.length, 7)
  assert.ok(p.every(x => x.taxa === 0 && x.bruto === x.liquido))
  assert.equal(p[6].dataPrevista, '2027-05-19') // +217 dias
})

test('centavos que não dividem: a sobra vai na 1ª', () => {
  const p = calcularRecebimentos(10, 3, 2.81, '2026-10-14', 'credit')
  assert.deepEqual(p.map(x => x.bruto), [3.34, 3.33, 3.33])
  assert.equal(Math.round(p.reduce((s, x) => s + x.liquido, 0) * 100), 972) // 10 × 0,9719
})
