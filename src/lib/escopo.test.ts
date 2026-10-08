// Rodar: node --experimental-strip-types --test src/lib/escopo.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
import { lojaDoEscopo, escopoDaListaDeVendas, type PerfilDeEscopo } from './escopo.ts'

/*
 * Bug de 08/10/2026: Fernanda/Felipe "em Brasília", Vendas, últimos 30 dias, e
 * apareciam vendas da Rosi de Campinas. A lista filtrava por `profile.store_id`,
 * que é NULL para o admin global mesmo com a loja escolhida no login.
 */

const BSB = 'loja-brasilia'
const CPS = 'loja-campinas'
const HOJE = '2026-10-08'

type Venda = { id: string; store_id: string; sale_date: string }

/* Uma venda por loja em cada degrau de período, para todo período ter as duas. */
const VENDAS: Venda[] = []
for (const [dia, rotulo] of [
  ['2026-10-08', 'hoje'], ['2026-10-03', '7d'], ['2026-09-20', '30d'],
  ['2026-10-01', 'mes'], ['2026-08-15', 'antigo'],
] as const) {
  VENDAS.push({ id: `bsb-${rotulo}`, store_id: BSB, sale_date: `${dia}T00:00:00+00:00` })
  VENDAS.push({ id: `cps-${rotulo}`, store_id: CPS, sale_date: `${dia}T00:00:00+00:00` })
}

/* Query builder de mentira: aplica eq/gte/lte numa lista, como o PostgREST. */
class Consulta {
  linhas: Venda[]
  constructor(linhas: Venda[]) { this.linhas = linhas }
  eq(col: string, v: string) { return new Consulta(this.linhas.filter(l => (l as Record<string, string>)[col] === v)) }
  gte(col: string, v: string) { return new Consulta(this.linhas.filter(l => (l as Record<string, string>)[col].slice(0, 10) >= v)) }
  lte(col: string, v: string) { return new Consulta(this.linhas.filter(l => (l as Record<string, string>)[col].slice(0, 10) <= v)) }
}

/* Os períodos da tela, como o VendasClient filtra no navegador. */
const PERIODOS: Record<string, [string, string]> = {
  hoje: [HOJE, HOJE],
  '7 dias': ['2026-10-02', HOJE],
  '30 dias': ['2026-09-09', HOJE],
  'este mês': ['2026-10-01', HOJE],
  intervalo: ['2026-08-01', '2026-09-30'],
}

function naTela(perfil: PerfilDeEscopo, [de, ate]: [string, string]): Venda[] {
  const doServidor = escopoDaListaDeVendas(new Consulta(VENDAS), perfil, HOJE).linhas
  return doServidor.filter(s => s.sale_date.slice(0, 10) >= de && s.sale_date.slice(0, 10) <= ate)
}

const PERFIS: Array<[string, PerfilDeEscopo, string]> = [
  ['admin global escolheu Brasília', { role: 'admin', store_id: null, lojaSelecionada: BSB }, BSB],
  ['admin global escolheu Campinas', { role: 'admin', store_id: null, lojaSelecionada: CPS }, CPS],
  ['admin de loja (Brasília)',        { role: 'admin', store_id: BSB, lojaSelecionada: null }, BSB],
  ['admin de loja (Campinas)',        { role: 'admin', store_id: CPS, lojaSelecionada: null }, CPS],
  ['operadora de Brasília',           { role: 'operator', store_id: BSB, lojaSelecionada: null }, BSB],
  ['operadora de Campinas',           { role: 'operator', store_id: CPS, lojaSelecionada: null }, CPS],
]

for (const [quem, perfil, loja] of PERFIS) {
  for (const [periodo, janela] of Object.entries(PERIODOS)) {
    test(`${quem} · ${periodo}: só vendas da própria loja`, () => {
      const vistas = naTela(perfil, janela)
      assert.ok(vistas.every(v => v.store_id === loja), `vazou: ${vistas.filter(v => v.store_id !== loja).map(v => v.id)}`)
      // e não some com as da própria loja (admin vê o período inteiro)
      if (perfil.role === 'admin') assert.ok(vistas.length > 0, 'a própria loja sumiu')
    })
  }
}

test('operadora só recebe hoje do servidor, qualquer período que escolha', () => {
  const op: PerfilDeEscopo = { role: 'operator', store_id: CPS, lojaSelecionada: null }
  assert.deepEqual(naTela(op, PERIODOS['30 dias']).map(v => v.id), ['cps-hoje'])
})

test('o filtro da URL não tira ninguém da loja da sessão', () => {
  assert.equal(lojaDoEscopo({ role: 'admin', store_id: null, lojaSelecionada: BSB }, CPS), BSB)
  assert.equal(lojaDoEscopo({ role: 'admin', store_id: BSB, lojaSelecionada: null }, CPS), BSB)
  assert.equal(lojaDoEscopo({ role: 'operator', store_id: BSB, lojaSelecionada: null }, CPS), BSB)
})

test('só o admin global sem loja escolhida fica sem corte (é mandado escolher)', () => {
  assert.equal(lojaDoEscopo({ role: 'admin', store_id: null, lojaSelecionada: null }), null)
})
