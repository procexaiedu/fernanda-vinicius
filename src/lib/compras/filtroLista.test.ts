// Rodar: node --experimental-strip-types --test src/lib/compras/filtroLista.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  passaNoTipo, passaNoStatus, contarConsignacoesAtivas, statusFiltroValido,
  type LinhaLista,
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
} from './filtroLista.ts'

// Cenário de 02/10: dois lotes ativos (Campinas e Brasília), ambos já viraram compra,
// então a lista de lotes antigos chega vazia.
const propriaPaga: LinhaLista     = { type: 'purchase', paymentStatus: 'paid' }
const propriaPendente: LinhaLista = { type: 'purchase', paymentStatus: 'pending' }
const loteCampinas: LinhaLista    = { type: 'purchase', paymentStatus: 'pending', consignment_id: 'c1', consignmentStatus: 'active' }
const loteBrasilia: LinhaLista    = { type: 'purchase', paymentStatus: 'pending', consignment_id: 'c2', consignmentStatus: 'active' }
const loteAcertado: LinhaLista    = { type: 'purchase', paymentStatus: 'pending', consignment_id: 'c3', consignmentStatus: 'settled' }
const loteAntigoAtivo: LinhaLista = { type: 'consignment', status: 'active' }
const todas = [propriaPaga, propriaPendente, loteCampinas, loteBrasilia, loteAcertado]

const filtrar = (linhas: LinhaLista[], tipo: Parameters<typeof passaNoTipo>[1], status: Parameters<typeof passaNoStatus>[1]) =>
  linhas.filter(r => passaNoTipo(r, tipo) && passaNoStatus(r, status))

test('card "Consignações ativas" conta as compras ligadas a lote ativo (era zero)', () => {
  assert.equal(contarConsignacoesAtivas(todas), 2)
  assert.equal(contarConsignacoesAtivas([...todas, loteAntigoAtivo]), 3)
})

test('filtro de tipo "Consignações" mostra as compras de lote, sem as próprias', () => {
  assert.deepEqual(filtrar(todas, 'consignment', 'all'), [loteCampinas, loteBrasilia, loteAcertado])
  assert.deepEqual(filtrar(todas, 'purchase', 'all'), [propriaPaga, propriaPendente])
  assert.equal(filtrar(todas, 'all', 'all').length, todas.length)
})

test('status "Consig. ativa" mostra só lote ativo, e cada lote uma vez', () => {
  assert.deepEqual(filtrar(todas, 'all', 'active'), [loteCampinas, loteBrasilia])
  assert.deepEqual(filtrar([...todas, loteAntigoAtivo], 'consignment', 'active'), [loteCampinas, loteBrasilia, loteAntigoAtivo])
})

test('"Pendente" é pagamento de compra própria; lote (que mostra "A acertar") não entra', () => {
  assert.deepEqual(filtrar(todas, 'all', 'pending'), [propriaPendente])
  assert.deepEqual(filtrar(todas, 'all', 'paid'), [propriaPaga])
})

test('valor salvo no navegador que não existe vira "todos"', () => {
  assert.equal(statusFiltroValido('active'), 'active')
  assert.equal(statusFiltroValido('ativo'), 'all')
  assert.equal(statusFiltroValido(null), 'all')
})
