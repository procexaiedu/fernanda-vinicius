// Rodar: node --experimental-strip-types --test src/lib/compras/remessaPendente.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  remessaEstaPendente, itemQueMexeNaRemessa, mensagemRemessaPendente,
  type ItemTravavel,
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
} from './remessaPendente.ts'

const gravado: ItemTravavel[] = [
  { purchaseItemId: 'i1', name: 'Colar', quantity: 3, storeId: 'bsb', costPrice: 110, salePrice: 330, promoPrice: null },
  { purchaseItemId: 'i2', name: 'Brinco', quantity: 2, storeId: 'cps', costPrice: 16, salePrice: 48, promoPrice: 40 },
]
const copia = () => gravado.map(i => ({ ...i }))

test('remessa enviada está pendente; recebida, divergente e cancelada não', () => {
  assert.equal(remessaEstaPendente('enviada'), true)
  for (const s of ['recebida', 'divergente', 'cancelada']) assert.equal(remessaEstaPendente(s), false, s)
  assert.equal(remessaEstaPendente(null), false)
})

test('salvar sem mexer nas peças passa (data, NF, pagamentos, nome)', () => {
  const enviado = copia()
  enviado[0].name = 'Colar dourado'
  assert.equal(itemQueMexeNaRemessa(gravado, enviado), null)
  // valores numéricos iguais com ruído de ponto flutuante não contam
  enviado[1].costPrice = 16.000000001
  assert.equal(itemQueMexeNaRemessa(gravado, enviado), null)
})

test('quantidade, loja, custo e preço travam', () => {
  const casos: Array<[keyof ItemTravavel, unknown, string]> = [
    ['quantity', 5, 'quantidade'],
    ['storeId', 'cps', 'loja'],
    ['costPrice', 120, 'custo'],
    ['salePrice', 350, 'preço de venda'],
    ['promoPrice', 300, 'preço promocional'],
  ]
  for (const [campo, valor, rotulo] of casos) {
    const enviado = copia()
    ;(enviado[0] as unknown as Record<string, unknown>)[campo] = valor
    assert.deepEqual(itemQueMexeNaRemessa(gravado, enviado), { nome: 'Colar', campo: rotulo }, campo)
  }
})

test('item que não é desta compra também trava', () => {
  const enviado = [...copia(), { ...gravado[0], purchaseItemId: 'outro', name: 'Anel' }]
  assert.deepEqual(itemQueMexeNaRemessa(gravado, enviado), { nome: 'Anel', campo: 'item' })
})

test('a mensagem diz para onde vai, o que travou e o que ainda dá para salvar', () => {
  const m = mensagemRemessaPendente(['Brasília'], { nome: 'Colar', campo: 'quantidade' })
  assert.match(m, /remessa para Brasília ainda não conferida/)
  assert.match(m, /"Colar": quantidade foi alterado/)
  assert.match(m, /Data, NF, observação e pagamentos podem ser salvos/)
})
