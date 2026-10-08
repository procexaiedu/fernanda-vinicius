// Rodar: node --experimental-strip-types --test src/lib/fiscal/montarNfce.test.ts
//
// Emissor SIMULADO: `fetch` é trocado por um falso que grava o POST e responde
// como a procex-fiscal. Nenhum teste aqui fala com emissor de verdade.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  montarNfce, validarVenda, ratearDesconto, prepararParaNota, totalDaNota,
  type ItemVenda, type VendaParaNota, type EmitenteFiscal,
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
} from './montarNfce.ts'
// @ts-expect-error -- idem
import { emitirNfce, consultarNfce, cancelarNfce, interpretar, assinaturaValida } from './procexFiscal.ts'

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

test('pix: tPag 17 com o grupo card não integrado (a SVRS exige), sem bandeira', () => {
  const v = venda([peca('Colar', 150)], [{ metodo: 'pix', valor: 150, bandeira: 'visa' }])
  assert.deepEqual(validarVenda(v, emitente), [])
  assert.deepEqual(formas(v), [{ forma_pagamento: '17', valor_pagamento: '150.00', tipo_integracao: 2 }])
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
    { forma_pagamento: '17', valor_pagamento: '70.00', tipo_integracao: 2 },
    { forma_pagamento: '21', valor_pagamento: '428.00' },
  ])
})

test('fiado: 100 em pix e 200 a receber, tPag 05', () => {
  const v = venda([peca('Pulseira', 300)], [{ metodo: 'pix', valor: 100 }, { metodo: 'fiado', valor: 200 }])
  assert.deepEqual(validarVenda(v, emitente), [])
  assert.deepEqual(formas(v)[1], { forma_pagamento: '05', valor_pagamento: '200.00' })
})

test('o bug antigo: troca fora dos pagamentos é recusada ANTES do emissor', () => {
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

// ─── A viagem, com a procex-fiscal simulada ───────────────────────────────────

const BASE = 'http://fiscal.teste:3333'
const CHAVE = '53261012137229000151650030000000011000000017'

function simular(respostas: { status: number; corpo: unknown }[]) {
  const chamadas: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    chamadas.push({ url: String(url), init })
    const r = respostas.shift() ?? { status: 500, corpo: {} }
    return new Response(JSON.stringify(r.corpo), { status: r.status })
  }) as typeof fetch
  process.env.PROCEX_FISCAL_URL = BASE + '/'
  process.env.PROCEX_FISCAL_TOKEN = 'token-falso'
  return { chamadas, restaurar: () => { globalThis.fetch = original } }
}

test('emissão: POST /v2/nfce?ref na URL configurada, Basic token:, links relativos completados', async () => {
  const s = simular([{ status: 201, corpo: {
    cnpj_emitente: '12137229000151', ref: 'venda-v1', status: 'autorizado', status_sefaz: '100',
    mensagem_sefaz: 'Autorizado o uso da NF-e', chave_nfe: 'NFe' + CHAVE, numero: '1', serie: '3', modelo: '65',
    caminho_xml_nota_fiscal: `/arquivos/${CHAVE}/abc/nfe.xml`, caminho_danfe: `/arquivos/${CHAVE}/def/danfe.pdf`,
    qrcode_url: `https://www.fazenda.df.gov.br/nfce/qrcode?p=${CHAVE}|3|2`,
    url_consulta_nf: 'www.fazenda.df.gov.br/nfce/consulta',
  } }])
  try {
    const v = venda([peca('Colar', 200), conserto(50)],
      [{ metodo: 'pix', valor: 100 }, { metodo: 'troca', valor: 100 }, { metodo: 'fiado', valor: 50 }],
      { cpf_destinatario: '12345678909' })
    const p = prepararParaNota(v)
    assert.deepEqual(validarVenda(p.venda, emitente), [])
    const r = await emitirNfce('venda-v1', montarNfce(p.venda, emitente))

    assert.equal(s.chamadas.length, 1)
    assert.equal(s.chamadas[0].url, `${BASE}/v2/nfce?ref=venda-v1`)
    assert.equal(s.chamadas[0].init.method, 'POST')
    const auth = (s.chamadas[0].init.headers as Record<string, string>).Authorization
    assert.equal(auth, 'Basic ' + Buffer.from('token-falso:').toString('base64'))
    const corpo = JSON.parse(String(s.chamadas[0].init.body))
    assert.equal(corpo.cnpj_emitente, '12137229000151')
    assert.equal(corpo.items.length, 1)
    assert.equal(corpo.cpf_destinatario, '12345678909')
    assert.deepEqual(corpo.formas_pagamento.map((f: { forma_pagamento: string }) => f.forma_pagamento), ['17', '21', '05'])
    assert.equal(corpo.formas_pagamento.reduce((s: number, f: { valor_pagamento: string }) => s + Number(f.valor_pagamento), 0).toFixed(2), '200.00')

    assert.equal(r.ok, true)
    assert.equal(r.ref, 'venda-v1')
    assert.equal(r.chave, 'NFe' + CHAVE)
    assert.match(r.qrcodeUrl ?? '', /qrcode\?p=/)
    assert.equal(r.danfeUrl, `${BASE}/arquivos/${CHAVE}/def/danfe.pdf`)
    assert.equal(r.xmlUrl, `${BASE}/arquivos/${CHAVE}/abc/nfe.xml`)
  } finally { s.restaurar() }
})

test('rejeição da SEFAZ (422) vira status erro_autorizacao com cStat e motivo', async () => {
  const s = simular([{ status: 422, corpo: { ref: 'venda-v2', status: 'erro_autorizacao', status_sefaz: '391', mensagem_sefaz: 'Rejeição: Não informados os dados do cartão' } }])
  try {
    const r = await emitirNfce('venda-v2', {})
    assert.equal(r.ok, false)
    assert.equal(r.status, 'erro_autorizacao')
    assert.equal(r.mensagem, '391 Rejeição: Não informados os dados do cartão')
  } finally { s.restaurar() }
})

test('erro de validação (400) junta os campos; 202 é processando, não erro', async () => {
  const s = simular([
    { status: 400, corpo: { codigo: 'requisicao_invalida', erro: 'dados_invalidos', mensagem: 'Dados inválidos', erros: [{ campo: 'items[0].codigo_ncm', mensagem: 'NCM com 8 dígitos' }] } },
    { status: 202, corpo: { ref: 'venda-v3', status: 'processando_autorizacao' } },
  ])
  try {
    const r1 = await emitirNfce('venda-v3', {})
    assert.equal(r1.status, 'erro_autorizacao')
    assert.equal(r1.mensagem, 'items[0].codigo_ncm: NCM com 8 dígitos')
    const r2 = await emitirNfce('venda-v3', {})
    assert.equal(r2.status, 'processando_autorizacao')
    assert.equal(r2.ok, false)
  } finally { s.restaurar() }
})

test('consulta completa com ?cnpj (sem ref ambígua) traz o XML; 404 é nao_encontrado', async () => {
  const s = simular([
    { status: 200, corpo: { ref: 'venda-v4', status: 'autorizado', chave_nfe: 'NFe' + CHAVE, xml_nota_fiscal: '<nfeProc/>', protocolo_nota_fiscal: { numero_protocolo: '353260000000001' } } },
    { status: 404, corpo: { codigo: 'nao_encontrado', mensagem: 'Nota fiscal não encontrada' } },
  ])
  try {
    const r = await consultarNfce('venda-v4', true, '12.137.229/0001-51')
    assert.equal(s.chamadas[0].url, `${BASE}/v2/nfce/venda-v4?completa=1&cnpj=12137229000151`)
    assert.equal(r.xml, '<nfeProc/>')
    assert.equal(r.protocolo, '353260000000001')
    const n = await consultarNfce('venda-x')
    assert.equal(n.status, 'nao_encontrado')
  } finally { s.restaurar() }
})

test('cancelamento: DELETE com justificativa e cnpj; curta é barrada antes da viagem', async () => {
  const s = simular([
    { status: 200, corpo: { status: 'cancelado', status_sefaz: '135', mensagem_sefaz: 'Evento registrado e vinculado a NF-e' } },
    { status: 200, corpo: { status: 'erro_cancelamento', status_sefaz: '501', mensagem_sefaz: 'Rejeição: Prazo de cancelamento superior ao previsto' } },
  ])
  try {
    const curta = await cancelarNfce('venda-v5', 'curta')
    assert.equal(curta.status, 'erro_cancelamento')
    assert.equal(s.chamadas.length, 0)

    const r = await cancelarNfce('venda-v5', 'Cliente desistiu da compra no caixa', '12137229000151')
    assert.equal(s.chamadas[0].init.method, 'DELETE')
    assert.equal(s.chamadas[0].url, `${BASE}/v2/nfce/venda-v5?cnpj=12137229000151`)
    assert.deepEqual(JSON.parse(String(s.chamadas[0].init.body)), { justificativa: 'Cliente desistiu da compra no caixa' })
    assert.equal(r.status, 'cancelado')

    const fora = await cancelarNfce('venda-v5', 'Cliente desistiu da compra no caixa')
    assert.equal(fora.status, 'erro_cancelamento')
    assert.match(fora.mensagem ?? '', /501/)
  } finally { s.restaurar() }
})

test('sem PROCEX_FISCAL_URL/TOKEN: não viaja e diz o que falta', async () => {
  const s = simular([])
  delete process.env.PROCEX_FISCAL_TOKEN
  try {
    const r = await emitirNfce('venda-v6', {})
    assert.equal(s.chamadas.length, 0)
    assert.match(r.mensagem ?? '', /PROCEX_FISCAL_TOKEN/)
  } finally { s.restaurar() }
})

test('webhook: assinatura HMAC do corpo cru confere; corpo alterado ou segredo vazio não', async () => {
  const { createHmac } = await import('node:crypto')
  const corpo = JSON.stringify({ ref: 'venda-v7', status: 'autorizado' })
  const assinatura = 'sha256=' + createHmac('sha256', 'segredo-x').update(corpo).digest('hex')
  assert.equal(await assinaturaValida(corpo, assinatura, 'segredo-x'), true)
  assert.equal(await assinaturaValida(corpo + ' ', assinatura, 'segredo-x'), false)
  assert.equal(await assinaturaValida(corpo, assinatura, ''), false)
  assert.equal(await assinaturaValida(corpo, null, 'segredo-x'), false)
  assert.equal(await assinaturaValida(corpo, assinatura.replace('sha256=', ''), 'segredo-x'), false)
  // corpo do webhook = o do GET: lido pelo mesmo interpretar
  const r = interpretar(200, { ref: 'venda-v7', cnpj_emitente: '12.137.229/0001-51', status: 'cancelado' }, BASE)
  assert.equal(r.status, 'cancelado')
  assert.equal(r.cnpjEmitente, '12137229000151')
})
