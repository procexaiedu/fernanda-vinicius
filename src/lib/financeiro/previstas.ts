/**
 * Recorrentes dos meses futuros (pedido da Eleandra, 05/11/2026): abrir dezembro
 * já mostra o que vai sair, sem clicar em nada.
 *
 * São calculadas na leitura e NÃO gravam nada: editar ou desativar a recorrente
 * muda a previsão, e a conta real continua nascendo no dia 1º pelo cron. O mês
 * corrente fica de fora porque a conta dele já é real.
 */

export interface RecorrenteAtiva {
  id: string
  description: string
  amount: number
  category: string
  cost_type: string | null
  day_of_month: number | null
  store_id: string | null
}

export interface Prevista {
  recorrente: RecorrenteAtiva
  /** Dia 1º do mês, como o `transaction_date` da conta real. */
  lancamento: string
  vencimento: string
}

/** Teto de segurança para um filtro de período muito longo. */
const MAX_MESES = 24

const doisDigitos = (n: number) => String(n).padStart(2, '0')

/**
 * @param hoje AAAA-MM-DD no fuso de Brasília.
 * @param jaLancadas `${recorrenteId}:${AAAA-MM}` das contas reais: é a mesma trava
 *   por recorrente + mês das funções do banco.
 */
export function calcularPrevistas(
  recorrentes: RecorrenteAtiva[],
  hoje: string,
  de: string | null,
  ate: string,
  jaLancadas: Set<string>,
): Prevista[] {
  const previstas: Prevista[] = []
  let ano = Number(hoje.slice(0, 4))
  let mes = Number(hoje.slice(5, 7))

  for (let i = 0; i < MAX_MESES; i++) {
    mes += 1
    if (mes > 12) { mes = 1; ano += 1 }
    const chaveMes = `${ano}-${doisDigitos(mes)}`
    const lancamento = `${chaveMes}-01`
    if (lancamento > ate) break

    for (const recorrente of recorrentes) {
      if (jaLancadas.has(`${recorrente.id}:${chaveMes}`)) continue
      // Igual às funções do banco: sem dia = 10, e no máximo 28.
      const dia = Math.min(recorrente.day_of_month ?? 10, 28)
      const vencimento = `${chaveMes}-${doisDigitos(dia)}`
      const lancamentoNoPeriodo = !de || lancamento >= de
      const vencimentoNoPeriodo = (!de || vencimento >= de) && vencimento <= ate
      if (lancamentoNoPeriodo || vencimentoNoPeriodo) previstas.push({ recorrente, lancamento, vencimento })
    }
  }
  return previstas
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export async function buscarPrevistas(admin: any, loja: string | null, de: string | null, ate: string): Promise<Prevista[]> {
  let q = admin
    .from('recurring_expenses')
    .select('id, description, amount, category, cost_type, day_of_month, store_id')
    .eq('is_active', true)
    .eq('recurrence', 'monthly')
  if (loja) q = q.eq('store_id', loja)
  const { data: recorrentes, error } = await q
  if (error) throw new Error(error.message)
  if (!recorrentes?.length) return []

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data: reais, error: reaisErr } = await admin
    .from('transactions')
    .select('recurring_expense_id, transaction_date')
    .in('recurring_expense_id', recorrentes.map((r: RecorrenteAtiva) => r.id))
    .gt('transaction_date', hoje)
  if (reaisErr) throw new Error(reaisErr.message)

  const jaLancadas = new Set<string>(
    (reais ?? []).map((t: { recurring_expense_id: string; transaction_date: string }) =>
      `${t.recurring_expense_id}:${String(t.transaction_date).slice(0, 7)}`),
  )
  return calcularPrevistas(
    recorrentes.map((r: RecorrenteAtiva) => ({ ...r, amount: Number(r.amount) })),
    hoje, de, ate, jaLancadas,
  )
}
