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
  /** `products.is_service` (conserto). Serviço não é mercadoria — ver `SERVICO_NA_NFCE`. */
  servico?: boolean
}

/**
 * As quatro primeiras são o `payment_method` de `fv.sale_payments`. As duas
 * últimas NÃO existem lá — são montadas em fiscal.ts:
 * - `troca`: o valor da peça devolvida (`exchange_items` returned), que paga
 *   parte da venda como mercadoria;
 * - `fiado`: o que a cliente ficou devendo (total − pagos − troca).
 */
export type MetodoPagamento = 'cash' | 'pix' | 'debit' | 'credit' | 'troca' | 'fiado'

export interface PagamentoVenda {
  metodo: MetodoPagamento
  valor: number
  /** `sale_payments.card_brand` (visa, mastercard, elo...), só cartão. */
  bandeira?: string | null
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
 *
 * TROCA e FIADO (06/10), pela tabela da Focus (campos.focusnfe.com.br/nfe/
 * FormaPagamentoXML, já com a NT 2023.004): `21` é "Crédito em Loja" — o
 * crédito que a peça devolvida gerou; `05` virou "Cartão da Loja (Private
 * Label), Crediário Digital, Outros Crediários" — é o crediário próprio, que é
 * o fiado. Descartados: `90` (sem pagamento, só cabe em nota de ajuste ou
 * devolução, não em venda) e `91` (pagamento posterior, código novo que o DF
 * pode ainda não aceitar em NFC-e). ⚠️ Os dois ainda NÃO foram testados em
 * homologação nem confirmados pela contadora; se o DF recusar, troque aqui
 * (o fiado por `91`, ou os dois por `99` com `descricao_pagamento`).
 */
export const TPAG: Record<MetodoPagamento, string> = {
  cash:   '01',  // Dinheiro
  credit: '03',  // Cartão de crédito
  debit:  '04',  // Cartão de débito
  pix:    '17',  // Pagamento instantâneo (PIX) — confirmado em homologação 02/09
  troca:  '21',  // Crédito em loja — a peça devolvida. A testar em homologação
  fiado:  '05',  // Crediário próprio ("Outros crediários"). A testar em homologação
}

/** Texto do `xPag`, obrigatório só quando o código é `99` (Outros). */
const DESCRICAO_99: Partial<Record<MetodoPagamento, string>> = {
  troca: 'Troca de mercadoria',
  fiado: 'Venda a receber (fiado)',
}

/**
 * `tBand` da NFC-e para a bandeira que o PDV grava. Bandeira que não está aqui
 * vai sem o campo (ele é opcional; `tpIntegra` é o que o SEFAZ cobra).
 */
const BANDEIRA: Record<string, string> = {
  visa: '01', mastercard: '02', amex: '03', elo: '06', hipercard: '07',
}

/**
 * O que fazer com o CONSERTO (linha `is_service`) na NFC-e.
 *
 * Conserto é serviço (ISS, NFS-e), não mercadoria: não tem NCM e não cabe no
 * modelo 65. Até 06/10 ele derrubava a nota da venda inteira.
 *
 * - `'fora_da_nota'` (padrão): a nota sai só com as peças; o conserto fica de
 *   fora, com aviso, e os pagamentos são reduzidos na mesma proporção para a
 *   soma fechar com o total da nota.
 * - `'recusar'`: venda com conserto não emite (o comportamento antigo).
 *
 * ⚠️ Decisão provisória: a contadora ainda vai dizer como o conserto sai.
 */
export const SERVICO_NA_NFCE: 'fora_da_nota' | 'recusar' = 'fora_da_nota'

/**
 * CSOSN 102 — DEFINIDO PELA CONTADORA EM 04/09. Não mude sem falar com ela.
 *
 * Extraímos 203 do Hiper em 31/08 e semeamos com ele. Em homologação, 02/09, o
 * SEFAZ recusou antes de olhar a nota:
 *
 *   erro_validacao_schema — Element 'vBCST': This element is not expected.
 *   Expected is ( modBCST )
 *
 * O 203 é "isenção do ICMS no Simples para faixa de receita bruta COM
 * substituição tributária": declará-lo obriga a mandar junto os campos de ST
 * (`modBCST`, `pICMSST`, `vICMSST`). A venda de balcão não tem ST, os campos
 * iam vazios, e o schema recusava. Com 102 a mesma nota foi AUTORIZADA
 * (status 100, série 3 nº 1), o que já isolava o problema no código de
 * situação tributária.
 *
 * O valor NÃO foi trocado na hora de propósito: qual CSOSN usar é decisão de
 * regime tributário, não escolha de quem escreve o código. A pergunta foi para
 * a contadora, e a resposta veio em 04/09 — "optante pelo Simples Nacional [...]
 * 102 - Tributada pelo Simples Nacional sem permissão de crédito".
 *
 * Migration: `supabase/migrations/20260904_csosn_102.sql`. O valor vive em
 * `fv.fiscal_categorias` (11 linhas) e em `fiscal_emitentes.csosn_padrao`, com
 * override opcional por peça em `products.csosn` — hoje nulo em todas.
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
    /* Só chega aqui com `SERVICO_NA_NFCE = 'recusar'`: no padrão,
     * `prepararParaNota` já tirou o conserto da nota. */
    if (item.servico) {
      recusas.push({
        campo: item.descricao || 'Conserto',
        motivo: 'Conserto é serviço e não entra na NFC-e. A venda está registrada normalmente.',
      })
      continue
    }
    const faltando = (['codigo_ncm', 'cfop', 'csosn', 'icms_origem', 'unidade'] as const)
      .filter(c => !item[c])
    if (faltando.length) {
      /*
       * A mensagem é para QUEM ESTÁ NO BALCÃO, não para quem programa.
       *
       * Dizia "Sem classificação fiscal (codigo_ncm, cfop, csosn). Classifique
       * a categoria em fv.fiscal_categorias" — nome de tabela do banco, na
       * cara da dona, com a cliente esperando. Ela não tem o que fazer com
       * isso, e a venda não pode travar por causa da nota.
       *
       * Em 04/09 o dono decidiu deixar as 7 peças sem classificação como
       * estão (caixas de embalagem, conserto, ourives, um colar cadastrado em
       * "cinto" e um lenço de seda). Ou seja: esta recusa não é transitória,
       * vai acontecer de verdade — o lenço tem estoque. Merece uma frase que
       * diga o que fazer.
       */
      recusas.push({
        campo: item.descricao || item.codigo,
        motivo: 'Esta peça não tem classificação fiscal e não pode entrar na nota. '
              + 'A venda está registrada normalmente — só a nota não sai com ela.',
      })
    }
    if (item.quantidade <= 0) {
      recusas.push({ campo: `item ${item.codigo}`, motivo: 'Quantidade tem de ser maior que zero.' })
    }
  }

  if (!venda.pagamentos.length) {
    recusas.push({ campo: 'formas_pagamento', motivo: 'Venda sem forma de pagamento.' })
  } else {
    /*
     * O SEFAZ confere: a soma dos `vPag` tem de cobrir o total da nota, e o
     * que passa só pode ser troco de DINHEIRO. Antes de 06/10 troca e fiado
     * ficavam de fora e a soma vinha menor que o total.
     */
    const totalNota = totalDaNota(venda.itens)
    const pago = soma(venda.pagamentos.map(p => p.valor))
    const dinheiro = soma(venda.pagamentos.filter(p => p.metodo === 'cash').map(p => p.valor))
    if (pago < totalNota - 0.009) {
      recusas.push({
        campo: 'formas_pagamento',
        motivo: `Os pagamentos (${brl(pago)}) não cobrem o total da nota (${brl(totalNota)}).`,
      })
    } else if (pago - totalNota > dinheiro + 0.009) {
      recusas.push({
        campo: 'formas_pagamento',
        motivo: `Os pagamentos (${brl(pago)}) passam do total da nota (${brl(totalNota)}) e só dinheiro pode ter troco.`,
      })
    }
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

// ─── Conserto fora da nota ────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100
const soma = (ns: number[]) => r2(ns.reduce((s, n) => s + n, 0))
const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`
const liquido = (i: ItemVenda) => i.quantidade * i.valor_unitario - i.desconto

/** Total da nota: soma dos itens já com o desconto rateado. */
export function totalDaNota(itens: ItemVenda[]): number {
  return soma(itens.map(liquido))
}

/** Troco: o que os pagamentos passam do total. Só vale para dinheiro (validado). */
export function trocoDaNota(venda: VendaParaNota): number {
  const t = r2(soma(venda.pagamentos.map(p => p.valor)) - totalDaNota(venda.itens))
  return t > 0 ? t : 0
}

export interface PreparoDaNota {
  /** A venda como vai para a nota (sem os consertos, quando é o caso). */
  venda: VendaParaNota
  /** Para a tela: o que ficou fora da nota e por quê. */
  avisos: string[]
  /** Preenchido quando a venda não gera nota nenhuma (só conserto). */
  semNota?: string
}

/**
 * Tira o conserto da nota e ajusta os pagamentos para fechar com o que sobrou.
 *
 * Os pagamentos são reduzidos NA MESMA PROPORÇÃO (total das peças ÷ total da
 * venda), cada forma no seu tamanho: não há como saber se o Pix da cliente
 * pagou a peça ou o conserto, e a proporção é a única divisão que não escolhe
 * um lado. O troco sai antes (a nota reduzida não tem troco), e o centavo do
 * arredondamento fica no MAIOR pagamento, para nunca deixar uma linha negativa.
 *
 * Venda só de conserto não gera nota: devolve `semNota` com a frase pronta.
 */
export function prepararParaNota(venda: VendaParaNota): PreparoDaNota {
  const servicos = venda.itens.filter(i => i.servico)
  if (!servicos.length || SERVICO_NA_NFCE === 'recusar') return { venda, avisos: [] }

  const pecas = venda.itens.filter(i => !i.servico)
  if (!pecas.length) {
    return {
      venda, avisos: [],
      semNota: 'Esta venda é só de conserto. Conserto é serviço e não sai em NFC-e (cupom fiscal de mercadoria). A venda está registrada normalmente.',
    }
  }

  const totalVenda = totalDaNota(venda.itens)
  const totalPecas = totalDaNota(pecas)
  const totalServico = r2(totalVenda - totalPecas)

  // 1) Sem o troco: tira do dinheiro o que passou do total.
  let troco = trocoDaNota(venda)
  const efetivos = venda.pagamentos.map(p => {
    if (p.metodo !== 'cash' || troco <= 0) return { ...p }
    const tira = Math.min(troco, p.valor)
    troco = r2(troco - tira)
    return { ...p, valor: r2(p.valor - tira) }
  })

  // 2) Proporção. Alvo = total das peças quando a venda estava fechada.
  const coberto = soma(efetivos.map(p => p.valor))
  const alvo = Math.abs(coberto - totalVenda) < 0.01 || totalVenda <= 0
    ? totalPecas
    : r2(coberto * totalPecas / totalVenda)
  const fator = coberto > 0 ? alvo / coberto : 0
  const reduzidos = efetivos.map(p => ({ ...p, valor: r2(p.valor * fator) }))
  const resto = r2(alvo - soma(reduzidos.map(p => p.valor)))
  if (resto !== 0 && reduzidos.length) {
    const maior = reduzidos.reduce((m, p, i) => (p.valor > reduzidos[m].valor ? i : m), 0)
    reduzidos[maior].valor = r2(reduzidos[maior].valor + resto)
  }

  return {
    venda: { ...venda, itens: pecas, pagamentos: reduzidos.filter(p => p.valor > 0) },
    avisos: [
      `Conserto fora da nota (${brl(totalServico)}): é serviço e não entra no cupom fiscal. `
      + `A nota sai só com as peças (${brl(totalPecas)}), e os pagamentos foram ajustados na mesma proporção.`,
    ],
  }
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

        /* Simples Nacional: o CSOSN substitui o CST, e o 102 da loja é
         * "tributada pelo Simples sem permissão de crédito". Não há base,
         * alíquota nem ST a declarar — é o que torna o item fiscalmente
         * simples aqui. Ver o bloco do CSOSN no topo do arquivo. */
        icms_origem: Number(item.icms_origem),
        icms_situacao_tributaria: item.csosn!,
      }
    }),

    formas_pagamento: venda.pagamentos.map(p => {
      const tPag = TPAG[p.metodo]
      const bandeira = p.bandeira ? BANDEIRA[p.bandeira] : undefined
      return {
        forma_pagamento: tPag,
        valor_pagamento: v2(p.valor),
        ...(tPag === '99' ? { descricao_pagamento: DESCRICAO_99[p.metodo] ?? 'Outros' } : {}),
        /* Cartão exige o grupo `card` (rejeição 391 sem ele). A maquininha
         * não fala com o sistema: `tpIntegra = 2` (não integrado), que
         * dispensa o CNPJ da credenciadora e o número de autorização. */
        ...(tPag === '03' || tPag === '04'
          ? { tipo_integracao: 2, ...(bandeira ? { bandeira_operadora: bandeira } : {}) }
          : {}),
      }
    }),

    /* vTroco: dinheiro acima do total. O PDV hoje não deixa gravar pagamento
     * maior que o total, então na prática vem zero e o campo não vai. */
    ...(trocoDaNota(venda) > 0 ? { valor_troco: v2(trocoDaNota(venda)) } : {}),
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
