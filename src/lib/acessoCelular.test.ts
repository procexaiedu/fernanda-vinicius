// Rodar: node --experimental-strip-types --test src/lib/acessoCelular.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
import { ehCelular, bloqueiaNoCelular } from './acessoCelular.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

test('celular é reconhecido pelo User-Agent', () => {
  assert.equal(ehCelular(IPHONE), true)
  assert.equal(ehCelular(ANDROID), true)
})

test('client hint do Chrome no Android basta', () => {
  assert.equal(ehCelular(WINDOWS, '?1'), true)
})

test('computador da loja passa', () => {
  assert.equal(ehCelular(WINDOWS), false)
  assert.equal(ehCelular(WINDOWS, '?0'), false)
  assert.equal(ehCelular(MAC), false)
  // sem cabeçalho não barra: falha para o lado de deixar trabalhar
  assert.equal(ehCelular(null), false)
})

test('vendedora barrada no celular; admins (Eleandra e geral) liberadas', () => {
  assert.equal(bloqueiaNoCelular('operator'), true)
  assert.equal(bloqueiaNoCelular('admin'), false)
})
