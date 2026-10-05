// Rodar: node --experimental-strip-types --test src/lib/acessoOperadora.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
import { operadoraPodeVer } from './acessoOperadora.ts'

test('operadora abre a conferência das transferências (05/10/2026)', () => {
  assert.equal(operadoraPodeVer('/estoque/transferencias'), true)
})

test('operadora continua sem o resto do estoque', () => {
  assert.equal(operadoraPodeVer('/estoque'), false)
  assert.equal(operadoraPodeVer('/estoque/conferencia'), false)
  assert.equal(operadoraPodeVer('/produtos'), false)
  assert.equal(operadoraPodeVer('/financeiro'), false)
  // prefixo sem barra não vale: /estoque/transferenciasX não é a tela
  assert.equal(operadoraPodeVer('/estoque/transferenciasX'), false)
})

test('o que ela já tinha continua', () => {
  for (const p of ['/pdv', '/vendas', '/vendas/123', '/consertos']) {
    assert.equal(operadoraPodeVer(p), true, p)
  }
})
