// Rodar: node --experimental-strip-types --test src/lib/fiscal/emissaoAtiva.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
import { EMISSAO_NOTA_ATIVA, emissaoAtiva, MSG_EMISSAO_EM_BREVE } from './emissaoAtiva.ts'

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

/** Corpo de uma função exportada, do cabeçalho até a próxima `export`. */
function corpo(fonte: string, nome: string): string {
  const ini = fonte.indexOf(`export async function ${nome}(`)
  assert.ok(ini >= 0, `${nome} não encontrada`)
  const fim = fonte.indexOf('\nexport ', ini + 1)
  return fonte.slice(ini, fim < 0 ? undefined : fim)
}

test('sem a variável, a emissão fica desligada', { skip: process.env.NEXT_PUBLIC_EMISSAO_NOTA_ATIVA !== undefined }, () => {
  assert.equal(EMISSAO_NOTA_ATIVA, false)
})

test('só "true" liga', () => {
  assert.equal(emissaoAtiva('true'), true)
  for (const v of [undefined, '', 'false', '1', 'sim', 'TRUE', ' true']) {
    assert.equal(emissaoAtiva(v), false, `"${v}" não pode ligar`)
  }
})

test('a mensagem de "em breve" diz para seguir como hoje', () => {
  assert.match(MSG_EMISSAO_EM_BREVE, /Por enquanto, siga como hoje\./)
})

/*
 * As actions puxam Supabase e next/cache, que não rodam aqui. O que importa é
 * que a recusa venha ANTES de qualquer leitura ou chamada ao provedor: confere
 * que a primeira instrução de cada uma é a trava.
 */
for (const nome of ['emitirNotaDaVenda', 'sincronizarNota']) {
  test(`${nome} recusa com a chave desligada antes de qualquer outra coisa`, () => {
    const c = corpo(ler('../../app/(sistema)/vendas/fiscal.ts'), nome)
    const primeira = c.split('\n').slice(1).find(l => l.trim() && !l.trim().startsWith('/*') && !l.trim().startsWith('*'))
    assert.equal(primeira?.trim(), 'if (!EMISSAO_NOTA_ATIVA) return { success: false, error: MSG_EMISSAO_EM_BREVE }')
  })
}

test('as telas só oferecem o clique de emitir com a chave ligada', () => {
  const painel = ler('../../components/venda/PainelNota.tsx')
  assert.match(painel, /nota\?\.emite && EMISSAO_NOTA_ATIVA && \(/)
  assert.match(painel, /disabled aria-disabled="true"[^>]*>\s*<FileText size=\{14\} \/> Em breve/)

  const detalhe = ler('../../components/venda/VendaDetalheModal.tsx')
  assert.match(detalhe, /\{EMISSAO_NOTA_ATIVA && !autorizada && status !== 'cancelada' && lojaEmite && \(/)
  assert.match(detalhe, /\{EMISSAO_NOTA_ATIVA && status === 'pendente' && \(/)
})
