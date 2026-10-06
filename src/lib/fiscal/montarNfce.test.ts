// Rodar: node --experimental-strip-types --test src/lib/fiscal/montarNfce.test.ts
//
// Focus SIMULADA: `fetch` é trocado por um falso que grava o POST e responde
// "autorizado". Nenhum teste aqui fala com a Focus de verdade (nem homologação).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  montarNfce, validarVenda, ratearDesconto, prepararParaNota, totalDaNota,
  type ItemVenda, type VendaParaNota, type EmitenteFiscal,
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
} from './montarNfce.ts'
// @ts-expect-error -- idem
import { emitirNfce } from './focus.ts'

const emitente: EmitenteFiscal = { cnpj: '12.137.229/0001-51', serie_nfce: 3, ambiente: 'homologacao' }

function peca(nome: string, valor: number, desconto = 0, extra: Partial<ItemVenda> = {}): ItemVenda {
  return {
    product_id: `id-${nome}`, codigo: `COD-${nome}`, descricao: nome, quantidade: 1,
    valor_unitario: valor, desconto,
    codigo_ncm: '71179000', cfop: '5102', unidade: 'UN', icms_origem: '0', csosn: '102',
    ...extra,
  }
}
const conserto = (valor: number, desconto = 0) => peca('Conserto', valor, desconto, {
  servico: true, codigo_ncm: null, cfop: null, csosn: null,
})

function venda(itens: ItemVenda[], pagamentos: VendaParaNota['pagamentos'], extra: Partial<VendaParaNota> = {}): VendaParaNota {
  return { id: 'v1', data: new Date().toISOString(), itens, pagamentos, ...extra }
}

const formas = (v: VendaParaNota) => (montarNfce(v, emitente) as { formas_pagamento: Record<string, unknown>[] }).formas_pagamento

// ─── Formas de pagamento ──────────────────────────────────────────────────────

test('pix: tPag 17, sem grupo de cartão', () => {
  const v = venda([peca('Colar', 150)], [{ metodo: 'pix', valor: 150 }])
  assert.deepEqual(validarVenda(v, emitente), [])
  assert.deepEqual(formas(v), [{ forma_pagamento: '17', valor_pagamento: '150.00' }])
})

test('dinheiro com troco: vPag maior que o total e valor_troco', () => {
  const v = venda([peca('Brinco', 87)], [{ metodo: 'cash', valor: 100 }])
  assert.deepEqual(validarVenda(v, emitente), [])
  const nota = montarNfce(v, emitente) as Record<string, unknown>
  assert.deepEqual(nota.formas_pagamento, [{ forma_pagamento: '01', valor_pagamento: '100.00' }])
  assert.equal(nota.valor_troco, '13.00')
})

test('sem troco, o campo valor_troco não vai', () => {
  const v = venda([peca('Brinco', 87)], [{ metodo: 'cash', valor: 87 }])
  assert.equal('valor_troco' in (montarNfce(v, emitente) as object), false)
})

test('débito: tPag 04, não integrado, bandeira Elo = 06', () => {
  const v = venda([peca('Anel', 220)], [{ metodo: 'debit', valor: 220, bandeira: 'elo' }])
  assert.deepEqual(formas(v), [{ forma_pagamento: '04', valor_pagamento: '220.00', tipo_integracao: 2, bandeira_operadora: '06' }])
})

test('crédito sem bandeira: tPag 03, só tipo_integracao 2 (sem CNPJ da credenciadora)', () => {
  const v = venda([peca('Anel', 220)], [{ metodo: 'credit', valor: 220, bandeira: null }])
  assert.deepEqual(formas(v), [{ forma_pagamento: '03', valor_pagamento: '220.00', tipo_integracao: 2 }])
})

test('troca (caso Madalena): 70 em pix + 428 de peça devolvida = 498, tPag 21', () => {
  const v = venda([peca('Colar', 498)], [{ metodo: 'pix', valor: 70 }, { metodo: 'troca', valor: 428 }])
  assert.deepEqual(validarVenda(v, emitente), [])
  assert.deepEqual(formas(v), [
    { forma_pagamento: '17', valor_pagamento: '70.00' },
    { forma_pagamento: '21', valor_pagamento: '428.00' },
  ])
})

test('fiado: 100 em pix e 200 a receber, tPag 05', () => {
  const v = venda([peca('Pulseira', 300)], [{ metodo: 'pix', valor: 100 }, { metodo: 'fiado', valor: 200 }])
  assert.deepEqual(validarVenda(v, emitente), [])
  assert.deepEqual(formas(v)[1], { forma_pagamento: '05', valor_pagamento: '200.00' })
})

test('o bug antigo: troca fora dos pagamentos é recusada ANTES da Focus', () => {
  const v = venda([peca('Colar', 498)], [{ metodo: 'pix', valor: 70 }])
  const r = validarVenda(v, emitente)
  assert.equal(r.length, 1)
  assert.equal(r[0].campo, 'formas_pagamento')
  assert.match(r[0].motivo, /não cobrem/)
})

test('pagamento acima do total sem dinheiro (não há troco de pix) é recusado', () => {
  const v = venda([peca('Colar', 100)], [{ metodo: 'pix', valor: 120 }])
  assert.match(validarVenda(v, emitente)[0].motivo, /só dinheiro pode ter troco/)
})

// ─── Desconto e CPF ───────────────────────────────────────────────────────────

test('desconto: 122+108+138 com 128 de desconto fecha no centavo', () => {
  const base = [122, 108, 138].map(v => ({ quantidade: 1, valor_unitario: v }))
  const d = ratearDesconto(base, 128)
  const v = venda(
    [peca('A', 122, d[0]), peca('B', 108, d[1]), peca('C', 138, d[2])],
    [{ metodo: 'pix', valor: 240 }],
  )
  assert.equal(totalDaNota(v.itens), 240)
  assert.deepEqual(validarVenda(v, emitente), [])
  const itens = (montarNfce(v, emitente) as { items: { valor_desconto?: string }[] }).items
  const soma = itens.reduce((s, i) => s + Number(i.valor_desconto ?? 0), 0)
  assert.equal(soma.toFixed(2), '128.00')
})

test('CPF vai só com dígitos; CPF curto é recusado', () => {
  const ok = venda([peca('Colar', 150)], [{ metodo: 'pix', valor: 150 }], { cpf_destinatario: '123.456.789-09' })
  assert.equal((montarNfce(ok, emitente) as { cpf_destinatario: string }).cpf_destinatario, '12345678909')
  const ruim = { ...ok, cpf_destinatario: '123.456' }
  assert.equal(validarVenda(ruim, emitente)[0].campo, 'cpf_destinatario')
})

// ─── Conserto ─────────────────────────────────────────────────────────────────

test('peça + conserto: a nota sai só com a peça, pagamento reduzido, com aviso', () => {
  const v = venda([peca('Colar', 200), conserto(50)], [{ metodo: 'pix', valor: 250 }])
  const p = prepararParaNota(v)
  assert.equal(p.semNota, undefined)
  assert.deepEqual(p.venda.itens.map(i => i.descricao), ['Colar'])
  assert.deepEqual(p.venda.pagamentos, [{ metodo: 'pix', valor: 200 }])
  assert.match(p.avisos[0], /Conserto fora da nota \(R\$ 50,00\)/)
  assert.deepEqual(validarVenda(p.venda, emitente), [])
})

test('peça + conserto com desconto e dois pagamentos: proporção fecha no centavo', () => {
  // 300 + 100, desconto 20 rateado (15 na peça, 5 no conserto) → total 380
  const d = ratearDesconto([{ quantidade: 1, valor_unitario: 300 }, { quantidade: 1, valor_unitario: 100 }], 20)
  const v = venda([peca('Colar', 300, d[0]), conserto(100, d[1])],
    [{ metodo: 'pix', valor: 200 }, { metodo: 'cash', valor: 180 }])
  const p = prepararParaNota(v)
  assert.equal(totalDaNota(p.venda.itens), 285)
  assert.equal(p.venda.pagamentos.reduce((s, x) => s + x.valor, 0).toFixed(2), '285.00')
  assert.deepEqual(p.venda.pagamentos.map(x => x.valor), [150, 135])
  assert.deepEqual(validarVenda(p.venda, emitente), [])
})

test('peça + conserto com valor quebrado: o centavo vai para o maior pagamento', () => {
  const v = venda([peca('Brinco', 33.33), conserto(10)],
    [{ metodo: 'pix', valor: 21.66 }, { metodo: 'debit', valor: 21.67, bandeira: 'visa' }])
  const p = prepararParaNota(v)
  assert.equal(p.venda.pagamentos.reduce((s, x) => s + x.valor, 0).toFixed(2), '33.33')
  assert.ok(p.venda.pagamentos.every(x => x.valor > 0))
  assert.deepEqual(validarVenda(p.venda, emitente), [])
})

test('só conserto: não gera nota, com a frase pronta', () => {
  const p = prepararParaNota(venda([conserto(80)], [{ metodo: 'cash', valor: 80 }]))
  assert.match(p.semNota ?? '', /só de conserto/)
})

// ─── A viagem, com a Focus simulada ───────────────────────────────────────────

test('emissão com Focus simulada: POST na URL de homologação, ref idempotente, QR e consulta lidos', async () => {
  process.env.FOCUS_NFE_TOKEN_HOMOLOGACAO = 'token-falso'
  const chamadas: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init })
    return new Response(JSON.stringify({
      status: 'autorizado', chave_nfe: 'NFe53261012137229000151650030000000011000000017',
      numero: '1', serie: '3', caminho_danfe: '/arquivos/danfe.html', caminho_xml_nota_fiscal: '/arquivos/nota.xml',
      qrcode_url: 'http://dec.fazenda.df.gov.br/ConsultarNFCe.aspx?p=53261012137229000151650030000000011000000017|3|2',
      url_consulta_nf: 'www.fazenda.df.gov.br/nfce/consulta',
    }), { status: 201 })
  }) as typeof fetch
  try {
    const v = venda([peca('Colar', 200), conserto(50)],
      [{ metodo: 'pix', valor: 100 }, { metodo: 'troca', valor: 100 }, { metodo: 'fiado', valor: 50 }],
      { cpf_destinatario: '12345678909' })
    const p = prepararParaNota(v)
    assert.deepEqual(validarVenda(p.venda, emitente), [])
    const r = await emitirNfce('homologacao', 'venda-v1', montarNfce(p.venda, emitente))

    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].url, 'https://homologacao.focusnfe.com.br/v2/nfce?ref=venda-v1')
    const corpo = JSON.parse(String(chamadas[0].init.body))
    assert.equal(corpo.items.length, 1)
    assert.equal(corpo.cpf_destinatario, '12345678909')
    assert.deepEqual(corpo.formas_pagamento.map((f: { forma_pagamento: string }) => f.forma_pagamento), ['17', '21', '05'])
    assert.equal(corpo.formas_pagamento.reduce((s: number, f: { valor_pagamento: string }) => s + Number(f.valor_pagamento), 0).toFixed(2), '200.00')

    assert.equal(r.ok, true)
    assert.match(r.qrcodeUrl ?? '', /ConsultarNFCe/)
    assert.equal(r.urlConsulta, 'www.fazenda.df.gov.br/nfce/consulta')
    assert.equal(r.danfeUrl, 'https://api.focusnfe.com.br/arquivos/danfe.html')
  } finally {
    globalThis.fetch = original
  }
})
