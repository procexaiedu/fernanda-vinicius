// Rodar: node --experimental-strip-types --test src/lib/fiscal/cupom.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error -- o node (strip-types) exige a extensão; o tsc do projeto não a aceita
import { lerXmlNfce, formatarChave, formatarDocumento } from './cupom.ts'

/** XML no formato do `caminho_xml_nota_fiscal` da Focus (nfeProc), dados de exemplo. */
export const XML_EXEMPLO = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe53261012137229000151650030000000011000000017" versao="4.00">
<ide><cUF>53</cUF><natOp>Venda de mercadoria</natOp><mod>65</mod><serie>3</serie><nNF>1</nNF><dhEmi>2026-10-06T14:03:00-03:00</dhEmi><tpAmb>2</tpAmb></ide>
<emit><CNPJ>12137229000151</CNPJ><xNome>FERNANDA DE OLIVEIRA VINICIUS FARJALLAT COMERCIO DE JOIAS</xNome><xFant>FERNANDA VINICIUS</xFant>
<enderEmit><xLgr>SHIS QI 5 Bloco F Sala 322</xLgr><nro>SN</nro><xBairro>Setor de Habitacoes Individuais Sul</xBairro><xMun>Brasilia</xMun><UF>DF</UF><CEP>71600500</CEP></enderEmit><IE>0754249400107</IE><CRT>1</CRT></emit>
<dest><CPF>12345678909</CPF></dest>
<det nItem="1"><prod><cProd>FJU0995</cProd><xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd><NCM>71179000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>498.00</vUnCom><vProd>498.00</vProd></prod></det>
<det nItem="2"><prod><cProd>FJU1001</cProd><xProd>BRINCO ARGOLA &amp; CRISTAL</xProd><NCM>71179000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>60.00</vUnCom><vProd>120.00</vProd><vDesc>18.00</vDesc></prod></det>
<total><ICMSTot><vProd>618.00</vProd><vDesc>18.00</vDesc><vNF>600.00</vNF></ICMSTot></total>
<pag><detPag><tPag>17</tPag><vPag>100.00</vPag></detPag><detPag><tPag>21</tPag><vPag>428.00</vPag></detPag><detPag><tPag>01</tPag><vPag>80.00</vPag></detPag><vTroco>8.00</vTroco></pag>
<infAdic><infCpl>Obrigada pela preferencia!</infCpl></infAdic>
</infNFe><infNFeSupl><qrCode><![CDATA[http://dec.fazenda.df.gov.br/ConsultarNFCe.aspx?p=53261012137229000151650030000000011000000017|3|2]]></qrCode><urlChave>www.fazenda.df.gov.br/nfce/consulta</urlChave></infNFeSupl></NFe>
<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>53261012137229000151650030000000011000000017</chNFe><dhRecbto>2026-10-06T14:03:02-03:00</dhRecbto><nProt>353260000012345</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`

test('lê emitente, itens, totais, pagamentos, troco, chave, protocolo e QR', () => {
  const c = lerXmlNfce(XML_EXEMPLO)
  assert.ok(c)
  assert.equal(c.emitente.nomeFantasia, 'FERNANDA VINICIUS')
  assert.equal(c.emitente.cnpj, '12137229000151')
  assert.equal(c.emitente.ie, '0754249400107')
  assert.match(c.emitente.endereco, /SHIS QI 5 .*Brasilia\/DF/)
  assert.equal(c.homologacao, true)
  assert.equal(c.numero, '1')
  assert.equal(c.serie, '3')
  assert.equal(c.itens.length, 2)
  assert.equal(c.itens[1].descricao, 'BRINCO ARGOLA & CRISTAL')
  assert.equal(c.itens[1].quantidade, 2)
  assert.equal(c.itens[1].desconto, 18)
  assert.equal(c.totalNota, 600)
  assert.equal(c.desconto, 18)
  assert.deepEqual(c.pagamentos.map(p => p.forma), ['PIX', 'Crédito em Loja (troca)', 'Dinheiro'])
  assert.equal(c.troco, 8)
  assert.equal(c.consumidor?.documento, '12345678909')
  assert.equal(c.chave, '53261012137229000151650030000000011000000017')
  assert.equal(c.protocolo, '353260000012345')
  assert.match(c.qrCode ?? '', /^http:\/\/dec\.fazenda\.df\.gov\.br\/ConsultarNFCe\.aspx\?p=\d{44}\|3\|2$/)
  assert.equal(c.urlConsulta, 'www.fazenda.df.gov.br/nfce/consulta')
})

test('o cupom não carrega o código da peça (cProd)', () => {
  const c = lerXmlNfce(XML_EXEMPLO)
  assert.ok(!JSON.stringify(c).includes('FJU0995'))
})

test('sem XML ou XML que não é NFC-e: null', () => {
  assert.equal(lerXmlNfce(null), null)
  assert.equal(lerXmlNfce('<html>erro</html>'), null)
})

test('formatação: chave em blocos de 4, CPF mascarado', () => {
  assert.equal(formatarChave('53261012137229000151650030000000011000000017').split(' ').length, 11)
  assert.equal(formatarDocumento('12345678909'), '123.***.***-09')
})
