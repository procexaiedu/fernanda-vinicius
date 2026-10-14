// Rodar: node --experimental-strip-types --test src/lib/consertoTempo.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
import { tempoMedioConserto } from './consertoTempo.ts'

test('média de recebido → pronto e → entregue', () => {
  const r = tempoMedioConserto([
    { recebidoEm: '2026-10-01', prontoEm: '2026-10-05', entregueEm: '2026-10-08' },
    { recebidoEm: '2026-10-02', prontoEm: '2026-10-04', entregueEm: null },
  ], null)
  assert.deepEqual(r.ateProntos, { dias: 3, amostra: 2 })
  assert.deepEqual(r.ateEntregue, { dias: 7, amostra: 1 })
})

test('conserto levado na hora no PDV não puxa a média para zero', () => {
  const r = tempoMedioConserto([
    { recebidoEm: '2026-10-10', prontoEm: null, entregueEm: '2026-10-10' },
    { recebidoEm: '2026-10-01', prontoEm: null, entregueEm: '2026-10-11' },
  ], null)
  assert.deepEqual(r.ateEntregue, { dias: 10, amostra: 1 })
})

test('período corta pela data final; lista vazia dá nulo', () => {
  const r = tempoMedioConserto([
    { recebidoEm: '2026-08-01', prontoEm: '2026-08-05', entregueEm: '2026-08-06' },
  ], '2026-09-14')
  assert.deepEqual(r.ateProntos, { dias: null, amostra: 0 })
  assert.deepEqual(r.ateEntregue, { dias: null, amostra: 0 })
})
