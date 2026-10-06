/**
 * Os dados do cupom 80mm (DANFE NFC-e), lidos do XML AUTORIZADO.
 *
 * Por que do XML e não da venda: o cupom tem de mostrar o que a SEFAZ
 * autorizou, não o que o sistema acha que mandou. Se a nota saiu sem o
 * conserto, com o pagamento reduzido na proporção ou com o texto de
 * homologação no primeiro item, é isso que está no XML — e é isso que o
 * papel precisa dizer. O XML é o que a Focus devolve (`caminho_xml_nota_fiscal`)
 * e que `gravarResultado` guarda em `sales.nfce_xml`.
 *
 * Função pura, sem dependência: dá para testar com um XML de exemplo
 * (src/lib/fiscal/cupom.test.ts). Leitura por expressão regular de propósito —
 * o XML da NFC-e é fixo pelo layout 4.00 e um parser inteiro seria uma
 * dependência a mais para ler meia dúzia de tags.
 *
 * O que NÃO vai no cupom: custo (nunca esteve no XML) e o código da peça
 * (`cProd`): a loja pediu só a descrição. O código continua na nota, onde é
 * obrigatório.
 */

export interface ItemCupom {
  descricao: string
  quantidade: number
  unidade: string
  valorUnitario: number
  valorTotal: number
  desconto: number
}

export interface PagamentoCupom {
  forma: string
  valor: number
}

export interface CupomNfce {
  emitente: {
    razaoSocial: string
    nomeFantasia: string | null
    cnpj: string
    ie: string | null
    endereco: string
  }
  numero: string
  serie: string
  emitidaEm: string | null
  homologacao: boolean
  itens: ItemCupom[]
  totalProdutos: number
  desconto: number
  totalNota: number
  pagamentos: PagamentoCupom[]
  troco: number
  /** Lei 12.741 (vTotTrib), quando a nota trouxer. */
  tributos: number | null
  consumidor: { documento: string; nome: string | null } | null
  chave: string
  protocolo: string | null
  autorizadaEm: string | null
  qrCode: string | null
  urlConsulta: string | null
  informacoes: string | null
}

/** Nome da forma de pagamento pelo `tPag` (tabela da NT 2023.004). */
export const FORMA_PAGAMENTO: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito',
  '05': 'Crediário', '10': 'Vale Alimentação', '11': 'Vale Refeição', '12': 'Vale Presente',
  '13': 'Vale Combustível', '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência',
  '19': 'Cashback', '20': 'PIX', '21': 'Crédito em Loja (troca)', '90': 'Sem pagamento',
  '91': 'Pagamento Posterior', '99': 'Outros',
}

// ─── Leitura ──────────────────────────────────────────────────────────────────

function semCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()
}

function decodificar(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/** Conteúdo da primeira `<tag>` (com ou sem prefixo de namespace). */
function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`))
  return m ? decodificar(semCdata(m[1])) : null
}

/** Todos os blocos `<tag>...</tag>`, crus, para ler o que tem dentro. */
function blocos(xml: string, nome: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, 'g')
  return [...xml.matchAll(re)].map(m => m[1])
}

const num = (s: string | null) => (s ? Number(s) : 0)

export function lerXmlNfce(xml: string | null | undefined): CupomNfce | null {
  if (!xml || !/<(?:\w+:)?infNFe[\s>]/.test(xml)) return null

  const emit = blocos(xml, 'emit')[0] ?? ''
  const ender = blocos(emit, 'enderEmit')[0] ?? ''
  const ide = blocos(xml, 'ide')[0] ?? ''
  const tot = blocos(xml, 'ICMSTot')[0] ?? ''
  const dest = blocos(xml, 'dest')[0] ?? null
  const prot = blocos(xml, 'infProt')[0] ?? ''

  const endereco = [
    [tag(ender, 'xLgr'), tag(ender, 'nro')].filter(Boolean).join(', '),
    tag(ender, 'xCpl'),
    tag(ender, 'xBairro'),
    [tag(ender, 'xMun'), tag(ender, 'UF')].filter(Boolean).join('/'),
  ].filter(Boolean).join(' - ')

  const itens: ItemCupom[] = blocos(xml, 'det').map(det => {
    const prod = blocos(det, 'prod')[0] ?? det
    return {
      descricao:     tag(prod, 'xProd') ?? '',
      quantidade:    num(tag(prod, 'qCom')),
      unidade:       tag(prod, 'uCom') ?? 'UN',
      valorUnitario: num(tag(prod, 'vUnCom')),
      valorTotal:    num(tag(prod, 'vProd')),
      desconto:      num(tag(prod, 'vDesc')),
    }
  })

  const pag = blocos(xml, 'pag')[0] ?? ''
  const pagamentos: PagamentoCupom[] = blocos(pag, 'detPag').map(d => {
    const t = tag(d, 'tPag') ?? '99'
    return { forma: (t === '99' && tag(d, 'xPag')) || FORMA_PAGAMENTO[t] || `Forma ${t}`, valor: num(tag(d, 'vPag')) }
  })

  const documento = dest ? (tag(dest, 'CPF') ?? tag(dest, 'CNPJ')) : null
  const idInfNFe = xml.match(/<(?:\w+:)?infNFe[^>]*\sId="NFe(\d{44})"/)?.[1] ?? ''

  return {
    emitente: {
      razaoSocial:  tag(emit, 'xNome') ?? '',
      nomeFantasia: tag(emit, 'xFant'),
      cnpj:         tag(emit, 'CNPJ') ?? '',
      ie:           tag(emit, 'IE'),
      endereco,
    },
    numero:      tag(ide, 'nNF') ?? '',
    serie:       tag(ide, 'serie') ?? '',
    emitidaEm:   tag(ide, 'dhEmi'),
    homologacao: tag(ide, 'tpAmb') === '2',
    itens,
    totalProdutos: num(tag(tot, 'vProd')),
    desconto:      num(tag(tot, 'vDesc')),
    totalNota:     num(tag(tot, 'vNF')),
    pagamentos,
    troco:         num(tag(pag, 'vTroco')),
    tributos:      tag(tot, 'vTotTrib') ? num(tag(tot, 'vTotTrib')) : null,
    consumidor:    documento ? { documento, nome: dest ? tag(dest, 'xNome') : null } : null,
    chave:         tag(prot, 'chNFe') ?? idInfNFe,
    protocolo:     tag(prot, 'nProt'),
    autorizadaEm:  tag(prot, 'dhRecbto'),
    qrCode:        tag(xml, 'qrCode'),
    urlConsulta:   tag(xml, 'urlChave'),
    informacoes:   tag(xml, 'infCpl'),
  }
}

// ─── Formatação ───────────────────────────────────────────────────────────────

export const formatarCnpj = (c: string) =>
  c.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

/** CPF mascarado no meio, como os PDVs imprimem: 123.***.***-09. */
export const formatarDocumento = (d: string) => {
  const s = d.replace(/\D/g, '')
  if (s.length === 11) return `${s.slice(0, 3)}.***.***-${s.slice(9)}`
  return formatarCnpj(s)
}

/** A chave em 11 blocos de 4, como pede o manual do DANFE NFC-e. */
export const formatarChave = (c: string) => c.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')

export const reais = (n: number) => n.toFixed(2).replace('.', ',')

/** "2026-10-06T14:03:00-03:00" → "06/10/2026 14:03:00", no fuso de Brasília. */
export function dataHora(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(',', '')
}
