/**
 * A conta das parcelas de cartão — espelho em TypeScript de
 * `fv.calcular_recebimentos` (migration 20261015). Quem GRAVA é o banco; isto
 * serve à simulação da tela de taxas e aos testes. Mudou um, mude o outro (o
 * teste SQL usa os mesmos casos).
 *
 * Regras (14/10/2026):
 *   - parcela k cai em venda + prazoDias + intervaloDias*(k-1); com diaUtil,
 *     sábado/domingo passam para segunda (feriado não). O prazo vem de
 *     fv.card_prazos (por loja e bandeira); sem prazo = padrão da planilha:
 *     débito 1/0/dia útil, crédito 31/31/corrido;
 *   - taxa TOTAL = round(bruto × taxa, 2) e líquido = bruto − taxa; bruto e líquido divididos em
 *     n partes iguais e a sobra de centavos vai na 1ª parcela;
 *   - taxa null = sem taxa: líquido = bruto.
 */

export interface Prazo {
  prazoDias: number
  intervaloDias: number
  diaUtil: boolean
}

export function prazoPadrao(tipo: 'debit' | 'credit'): Prazo {
  return tipo === 'debit'
    ? { prazoDias: 1, intervaloDias: 0, diaUtil: true }
    : { prazoDias: 31, intervaloDias: 31, diaUtil: false }
}

export interface Parcela {
  parcela: number
  dataPrevista: string // YYYY-MM-DD
  bruto: number
  taxa: number
  liquido: number
}

function somarDias(iso: string, dias: number): Date {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

export function calcularRecebimentos(
  valor: number,
  parcelas: number,
  taxaPct: number | null,
  dataVenda: string,
  tipo: 'debit' | 'credit',
  prazo: Prazo = prazoPadrao(tipo),
): Parcela[] {
  const n = tipo === 'debit' ? 1 : Math.max(1, Math.trunc(parcelas || 1))
  const brutoC = Math.round(valor * 100)
  // Em inteiros (centavos × taxa em 1/10000 de %) para arredondar igual ao numeric do banco.
  const taxaTotalC = Math.round((brutoC * Math.round((taxaPct ?? 0) * 10000)) / 1_000_000)
  const liqTotalC = brutoC - taxaTotalC
  const brutoParcC = Math.floor(brutoC / n)
  const liqParcC = Math.floor(liqTotalC / n)

  const out: Parcela[] = []
  for (let k = 1; k <= n; k++) {
    let data = somarDias(dataVenda, prazo.prazoDias + prazo.intervaloDias * (k - 1))
    if (prazo.diaUtil) {
      while (data.getUTCDay() === 0 || data.getUTCDay() === 6) data = somarDias(iso(data), 1)
    }
    const b = k === 1 ? brutoC - brutoParcC * (n - 1) : brutoParcC
    const l = k === 1 ? liqTotalC - liqParcC * (n - 1) : liqParcC
    out.push({ parcela: k, dataPrevista: iso(data), bruto: b / 100, liquido: l / 100, taxa: (b - l) / 100 })
  }
  return out
}
