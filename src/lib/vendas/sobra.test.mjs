/*
 * Troca com sobra e uso do crédito da cliente.
 * Rodar: node --test src/lib/vendas/sobra.test.mjs   (Node 24, lê .ts direto)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sobraDaTroca, usoMaximoDoCredito, conferirSobra } from './sobra.ts'

const base = { total: 18, creditoTroca: 198, pagos: 0, temCliente: true, destino: null, metodo: null }

test('troca R$ 198 x R$ 18 sobra R$ 180', () => {
  assert.equal(sobraDaTroca(18, 198), 180)
})

test('sem sobra: peça devolvida igual ou menor que o total', () => {
  assert.equal(sobraDaTroca(198, 198), 0)
  assert.equal(sobraDaTroca(200, 198), 0)
  assert.equal(sobraDaTroca(18, 18.004), 0)
})

test('sobra pede uma escolha', () => {
  assert.match(conferirSobra(base), /Escolha/)
})

test('guardar, não guardar e devolver (com forma) fecham', () => {
  assert.equal(conferirSobra({ ...base, destino: 'guardado' }), null)
  assert.equal(conferirSobra({ ...base, destino: 'dispensado' }), null)
  assert.equal(conferirSobra({ ...base, destino: 'devolvido', metodo: 'pix' }), null)
  assert.equal(conferirSobra({ ...base, destino: 'devolvido', metodo: 'cash' }), null)
})

test('devolver sem forma não fecha', () => {
  assert.match(conferirSobra({ ...base, destino: 'devolvido' }), /dinheiro ou Pix/)
})

test('guardar sem cliente não fecha', () => {
  assert.match(conferirSobra({ ...base, temCliente: false, destino: 'guardado' }), /cliente/)
})

test('pagamento junto com sobra é cobrar a mais', () => {
  assert.match(conferirSobra({ ...base, pagos: 10, destino: 'guardado' }), /Tire os pagamentos/)
})

test('uso do crédito: parcial, tudo, e nunca acima do saldo nem do que falta', () => {
  assert.equal(usoMaximoDoCredito(180, 100), 100)   // parcial: sobram 80
  assert.equal(usoMaximoDoCredito(80, 80), 80)      // usa tudo
  assert.equal(usoMaximoDoCredito(80, 250), 80)     // saldo é o teto
  assert.equal(usoMaximoDoCredito(0, 50), 0)
  assert.equal(usoMaximoDoCredito(50, -5), 0)
})
