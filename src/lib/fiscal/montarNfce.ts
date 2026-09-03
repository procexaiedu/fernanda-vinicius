/**
 * Monta o JSON da NFC-e a partir de uma venda nossa.
 *
 * Fica separado do cliente HTTP (`focus.ts`) de propósito: esta é a parte que
 * tem regra fiscal e que dá para testar **sem token e sem rede**. Erro de
 * montagem é o que mais custa numa integração fiscal — o SEFAZ recusa com
 * códigos como "rejeição 610" e cabe a alguém descobrir qual campo era.
 *
 * Doc dos campos: https://doc.focusnfe.com.br/reference/emitir_nfce.md
 */

import type { AmbienteFiscal } from './focus'

// ─── Entrada: o que o nosso banco tem ─────────────────────────────────────────

export interface EmitenteFiscal {
  cnpj: string
  serie_nfce: number
  ambiente: AmbienteFiscal
}

export interface ItemVenda {
  product_id: string
  /** Código interno da peça (FJU0995). Vai como `codigo_produto`. */
  codigo: string
  descricao: string
  quantidade: number
  valor_unitario: number
  /** Rateio do desconto da venda nesta linha. */
  desconto: number
  /** Vem de `fv.fiscal_do_produto` — nulo significa categoria não classificada. */
  codigo_ncm: string | null
  cfop: string | null
  unidade: string | null
  icms_origem: string | null
  csosn: string | null
}

export type MetodoPagamento = 'cash' | 'pix' | 'debit' | 'credit'

export interface PagamentoVenda {
  metodo: MetodoPagamento
  valor: number
}

export interface VendaParaNota {
  /** Id da venda — vira a `ref` idempotente na Focus. */
  id: string
  /** ISO. A NFC-e aceita no máximo 5 min de defasagem. */
  data: string
  itens: ItemVenda[]
  pagamentos: PagamentoVenda[]
  /** CPF do destinatário, quando a cliente pede a nota no CPF dela ou de outro. */
  cpf_destinatario?: string | null
  observacao?: string | null
}

// ─── Formas de pagamento ──────────────────────────────────────────────────────

/**
 * Código `tPag` do layout 4.00.
 *
 * O PIX como `17` foi **CONFIRMADO em homologação** em 02/09: nota autorizada
 * pela SEFAZ-DF (status 100), chave
 * `NFe5326091213722900015165003000000001115757248 5`, com pagamento único em
 * PIX. A dúvida era legítima — a doc da Focus não lista o código e houve NT
 * separando PIX dinâmico de estático —, e o teste resolveu.
 *
 * Os outros três são estáveis desde sempre e não têm ambiguidade.
 */
export const TPAG: Record<MetodoPagamento, string> = {
  cash:   '01',  // Dinheiro
  credit: '03',  // Cartão de crédito
  debit:  '04',  // Cartão de débito
  pix:    '17',  // Pagamento instantâneo (PIX) — confirmado em homologação 02/09
}

/**
 * ⚠️ CSOSN 203 NÃO PASSA NO SCHEMA — descoberto em homologação, 02/09.
 *
 * O 203 que extraímos do Hiper significa "isenção do ICMS no Simples **com
 * cobrança do ICMS por substituição tributária**". Ao usá-lo, o SEFAZ recusa
 * antes de olhar a nota:
 *
 *   erro_validacao_schema — Element 'vBCST': This element is not expected.
 *   Expected is ( modBCST )
 *
 * Ou seja: declarar 203 obriga a mandar também os campos de ST (`modBCST`,
 * `pICMSST`, `vICMSST`). Com CSOSN **102** a mesma nota foi AUTORIZADA
 * (status 100), o que prova que o resto do payload está correto e isola o
 * problema no código de situação tributária.
 *
 * São duas hipóteses e quem responde é a contadora, não nós:
 *   a) o 203 está certo e faltam os campos de ST; ou
 *   b) para venda no balcão o código é outro — 102, ou 500 (ICMS já cobrado
 *      antes por ST), que é o comum no varejo que compra de quem recolheu.
 *
 * Até ela responder, o valor semeado em `fv.fiscal_categorias` segue 203 —
 * mudar por conta própria seria escolher regime tributário no lugar dela.
 */

// ─── Validação ────────────────────────────────────────────────────────────────

export interface Recusa {
  campo: string
  motivo: string
}

/**
 * O que impede a nota de sair, verificado ANTES de gastar uma viagem.
 *
 * A regra que mais importa aqui: **peça sem classificação fiscal não vira
 * nota**. Hoje 6 peças estão assim (caixas, conserto, cinto, ourives). Emitir
 * com NCM chutado é pior do que não emitir — a nota sai autorizada, errada, e
 * o problema só aparece na fiscalização.
 */
export function validarVenda(venda: VendaParaNota, emitente: EmitenteFiscal): Recusa[] {
  const recusas: Recusa[] = []

  if (!venda.itens.length) {
    recusas.push({ campo: 'items', motivo: 'Venda sem itens.' })
  }

  for (const item of venda.itens) {
    const faltando = (['codigo_ncm', 'cfop', 'csosn', 'icms_origem', 'unidade'] as const)
      .filter(c => !item[c])
    if (faltando.length) {
      recusas.push({
        campo: `item ${item.codigo}`,
        motivo: `Sem classificação fiscal (${faltando.join(', ')}). Classifique a categoria em fv.fiscal_categorias.`,
      })
    }
    if (item.quantidade <= 0) {
      recusas.push({ campo: `item ${item.codigo}`, motivo: 'Quantidade tem de ser maior que zero.' })
    }
  }

  if (!venda.pagamentos.length) {
    recusas.push({ campo: 'formas_pagamento', motivo: 'Venda sem forma de pagamento.' })
  }

  /*
   * A janela de 5 minutos é do SEFAZ, não nossa.
   *
   * É a mudança de operação que a Fernanda aceitou em 31/08: a nota sai no
   * balcão. Hoje 25 das 27 vendas foram lançadas com data retroativa — todas
   * elas seriam recusadas. Barrar aqui, com o motivo escrito, é melhor do que
   * deixar o SEFAZ recusar com um código numérico.
   */
  const atraso = Date.now() - new Date(venda.data).getTime()
  if (atraso > 5 * 60_000) {
    const min = Math.round(atraso / 60_000)
    recusas.push({
      campo: 'data_emissao',
      motivo: `Venda de ${min} min atrás. A NFC-e só aceita 5 minutos — esta venda precisa ser lançada na hora.`,
    })
  }

  if (venda.cpf_destinatario) {
    const cpf = venda.cpf_destinatario.replace(/\D/g, '')
    if (cpf.length !== 11) {
      recusas.push({ campo: 'cpf_destinatario', motivo: `CPF com ${cpf.length} dígitos.` })
    }
  }

  if (!emitente.cnpj?.replace(/\D/g, '')) {
    recusas.push({ campo: 'cnpj_emitente', motivo: 'Loja sem CNPJ cadastrado.' })
  }

  return recusas
}

// ─── Rateio do desconto ───────────────────────────────────────────────────────

/**
 * Distribui o desconto da VENDA entre os itens.
 *
 * O nosso desconto é um valor único sobre o total; a NFC-e quer o desconto
 * linha a linha. E o SEFAZ confere: a soma dos `valor_desconto` tem de bater
 * com o desconto do total, **no centavo**.
 *
 * Ratear proporcionalmente e arredondar cada linha não fecha — três itens de
 * R$122, R$108 e R$138 com R$128 de desconto dão 42,43 + 37,57 + 47,99 =
 * 127,99, e a nota é recusada por um centavo.
 *
 * Por isso o ÚLTIMO ITEM ABSORVE O RESTO. Não é elegante e é o que fecha: o
 * erro de arredondamento tem de morar em algum lugar, e concentrá-lo numa
 * linha é melhor que espalhá-lo por todas.
 *
 * Devolve na mesma ordem que entrou.
 */
export function ratearDesconto(
  itens: { quantidade: number; valor_unitario: number }[],
  descontoTotal: number,
): number[] {
  if (descontoTotal <= 0 || !itens.length) return itens.map(() => 0)

  const brutos = itens.map(i => i.quantidade * i.valor_unitario)
  const subtotal = brutos.reduce((s, b) => s + b, 0)
  if (subtotal <= 0) return itens.map(() => 0)

  const rateado: number[] = []
  let acumulado = 0
  for (let i = 0; i < itens.length; i++) {
    if (i === itens.length - 1) {
      rateado.push(parseFloat((descontoTotal - acumulado).toFixed(2)))
    } else {
      const parte = parseFloat((descontoTotal * brutos[i] / subtotal).toFixed(2))
      rateado.push(parte)
      acumulado = parseFloat((acumulado + parte).toFixed(2))
    }
  }
  return rateado
}

// ─── Montagem ─────────────────────────────────────────────────────────────────

/** Duas casas, como string — a Focus recusa número com mais casas em campo de valor. */
const v2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/**
 * Quantidade aceita 4 casas no layout, mas a loja vende peça inteira. Manter 4
 * evita recusa em caso de fracionamento futuro sem mudar nada hoje.
 */
const q4 = (n: number) => n.toFixed(4)

export function montarNfce(venda: VendaParaNota, emitente: EmitenteFiscal) {
  return {
    cnpj_emitente: emitente.cnpj.replace(/\D/g, ''),
    /* Sem `numero`: a Focus atribui pela série, e é ela quem tem o controle da
     * sequência. Mandar o número daqui abre espaço para duplicidade quando duas
     * vendas fecham ao mesmo tempo. */
    serie: emitente.serie_nfce,
    data_emissao: new Date(venda.data).toISOString(),

    natureza_operacao: 'Venda de mercadoria',
    /* 1 = operação presencial. É o que uma loja de balcão é, e o que autoriza
     * a NFC-e no lugar da NF-e. */
    presenca_comprador: 1,
    /* 9 = sem frete. A cliente leva a peça. */
    modalidade_frete: 9,
    /* 1 = operação interna (dentro do estado). */
    local_destino: 1,

    ...(venda.cpf_destinatario
      ? { cpf_destinatario: venda.cpf_destinatario.replace(/\D/g, '') }
      : {}),

    ...(venda.observacao ? { informacoes_adicionais_contribuinte: venda.observacao } : {}),

    items: venda.itens.map((item, i) => {
      const bruto = item.quantidade * item.valor_unitario
      return {
        numero_item: i + 1,
        codigo_produto: item.codigo,
        descricao: item.descricao,
        codigo_ncm: item.codigo_ncm!,
        cfop: item.cfop!,

        unidade_comercial:  item.unidade!,
        unidade_tributavel: item.unidade!,
        quantidade_comercial:  q4(item.quantidade),
        quantidade_tributavel: q4(item.quantidade),
        valor_unitario_comercial:  v2(item.valor_unitario),
        valor_unitario_tributavel: v2(item.valor_unitario),
        valor_bruto: v2(bruto),
        ...(item.desconto > 0 ? { valor_desconto: v2(item.desconto) } : {}),

        /* Simples Nacional: o CSOSN substitui o CST, e o 203 da loja significa
         * isenção por faixa de receita. Não há base nem alíquota de ICMS a
         * declarar — é o que torna o item fiscalmente simples aqui. */
        icms_origem: Number(item.icms_origem),
        icms_situacao_tributaria: item.csosn!,
      }
    }),

    formas_pagamento: venda.pagamentos.map(p => ({
      forma_pagamento: TPAG[p.metodo],
      valor_pagamento: v2(p.valor),
    })),
  }
}

/**
 * A referência idempotente da nota.
 *
 * É o id da venda, e é o que garante que clicar duas vezes em "emitir" não
 * gera duas notas: a Focus devolve a existente para a mesma `ref`.
 */
export function refDaVenda(saleId: string): string {
  return `venda-${saleId}`
}
