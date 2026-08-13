'use client'

import { useState, useEffect } from 'react'
import { Lock, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { buscarCaixaDoDia, finalizarCaixa, type CaixaDoDia as CaixaData } from './actions'
import VendaDetalheModal from '@/components/venda/VendaDetalheModal'
import styles from './pdv.module.css'

interface StoreOpt { id: string; name: string; city: string }

interface Props {
  stores: StoreOpt[]
  isAdmin: boolean
  date: string
  caixa: CaixaData
  onCaixaChange: (c: CaixaData) => void
}

function fmt(v: number) {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function parseBRL(v: string) {
  return parseFloat((v || '0').replace(/\./g, '').replace(',', '.')) || 0
}
function fmtDateBR(s: string) {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

const METHODS = [
  { key: 'cash',   label: 'Dinheiro', cls: styles.sCash },
  { key: 'debit',  label: 'Débito',   cls: styles.sDebit },
  { key: 'credit', label: 'Crédito',  cls: styles.sCredit },
  { key: 'pix',    label: 'Pix',      cls: styles.sPix },
] as const

/** Resumo do fechamento que acabou de ser feito (para a vendedora ver o dia dela). */
interface JustClosed {
  totalSales: number
  salesCount: number
  counted: number
  difference: number
}

export default function CaixaDoDia({ stores, isAdmin, date, caixa, onCaixaChange }: Props) {
  const [counted, setCounted]       = useState('')
  const [notes, setNotes]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError]           = useState('')
  const [detalheId, setDetalheId]   = useState<string | null>(null)
  const [justClosed, setJustClosed] = useState<JustClosed | null>(null)

  // Sincroniza o "dinheiro contado" com o esperado ao trocar de loja/dia.
  useEffect(() => {
    setCounted(caixa.totals.cash.toFixed(2).replace('.', ','))
    setNotes('')
    setError('')
    setJustClosed(null)
  }, [caixa.storeId, caixa.date])

  async function changeStore(storeId: string) {
    setLoading(true)
    onCaixaChange(await buscarCaixaDoDia(storeId, date))
    setLoading(false)
  }

  async function handleFinalizar() {
    setError('')
    setFinalizing(true)
    // Guarda o que está sendo fechado para mostrar o resumo depois de zerar
    const snapshot: JustClosed = {
      totalSales: caixa.totalSales,
      salesCount: caixa.salesCount,
      counted:    parseBRL(counted),
      difference: parseBRL(counted) - caixa.totals.cash,
    }
    const res = await finalizarCaixa(caixa.storeId, date, parseBRL(counted), notes)
    if (res.success) {
      onCaixaChange(await buscarCaixaDoDia(caixa.storeId, date))  // a visão zera
      setJustClosed(snapshot)
      setCounted('0,00')
      setNotes('')
    } else {
      setError(res.error ?? 'Erro ao fechar o caixa.')
    }
    setFinalizing(false)
  }

  const expectedCash = caixa.totals.cash
  const diff = parseBRL(counted) - expectedCash
  const pct = (v: number) => (caixa.totalSales > 0 ? Math.round((v / caixa.totalSales) * 100) : 0)
  const semVendas = caixa.salesCount === 0

  return (
    <div className={styles.caixaWrap}>

      {/* Cabeçalho: loja + dia + último fechamento */}
      <div className={styles.caixaHead}>
        {isAdmin ? (
          <select className={styles.storeSel} value={caixa.storeId} onChange={e => changeStore(e.target.value)} disabled={loading}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : (
          <span className={styles.storeFixed}>{stores.find(s => s.id === caixa.storeId)?.name ?? 'Loja'}</span>
        )}
        <span className={styles.caixaDate}>{fmtDateBR(date)}</span>
        <div className={styles.spacer} />
        {caixa.lastClosing && (
          <span className={`${styles.statusChip} ${styles.statusClosed}`}>
            Último fechamento às {caixa.lastClosing.atLabel}
          </span>
        )}
      </div>

      {/* Resumo do fechamento recém-feito */}
      {justClosed && (
        <div className={styles.closedBanner}>
          <CheckCircle2 size={18} />
          <div className={styles.closedBannerText}>
            <strong>Caixa fechado — este foi o seu período:</strong>
            <span>
              {justClosed.salesCount} {justClosed.salesCount === 1 ? 'venda' : 'vendas'} · {fmt(justClosed.totalSales)}
              {' · '}dinheiro contado {fmt(justClosed.counted)}
              {' · '}diferença {(justClosed.difference > 0 ? '+' : '') + fmt(justClosed.difference)}
            </span>
          </div>
          <button className={styles.closedBannerX} onClick={() => setJustClosed(null)} title="Fechar aviso">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Totais da janela atual */}
      <div className={styles.strip}>
        <div className={`${styles.kpi} ${styles.kpiTotal}`}>
          <div className={styles.cap}>Total do período</div>
          <div className={styles.val}>{fmt(caixa.totalSales)}</div>
          <div className={styles.sub}>
            {caixa.salesCount} {caixa.salesCount === 1 ? 'venda' : 'vendas'}
            {caixa.salesCount > 0 && ` · ticket médio ${fmt(caixa.totalSales / caixa.salesCount)}`}
          </div>
        </div>
        {METHODS.map(m => (
          <div key={m.key} className={styles.kpi}>
            <div className={styles.cap}><span className={`${styles.swatch} ${m.cls}`} /> {m.label}</div>
            <div className={styles.val}>{fmt(caixa.totals[m.key])}</div>
            <div className={styles.sub}>{pct(caixa.totals[m.key])}%</div>
          </div>
        ))}
      </div>

      <div className={styles.caixaMain}>
        {/* Lançamentos */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Lançamentos</h2>
            <span className={styles.count}>{caixa.salesCount} {caixa.salesCount === 1 ? 'venda' : 'vendas'}</span>
          </div>
          {semVendas ? (
            <div className={styles.empty}>
              {caixa.lastClosing
                ? `Nenhuma venda desde o fechamento das ${caixa.lastClosing.atLabel}.`
                : 'Nenhuma venda registrada hoje ainda.'}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr><th>Hora</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th className={styles.r}>Valor</th></tr>
              </thead>
              <tbody>
                {caixa.lancamentos.map(l => (
                  <tr
                    key={l.id}
                    className={styles.rowClickable}
                    onClick={() => setDetalheId(l.id)}
                    title="Ver detalhe da venda"
                  >
                    <td className={styles.time}>{l.time}</td>
                    <td className={l.customerName ? '' : styles.anon}>{l.customerName ?? 'Sem cliente'}</td>
                    <td className={styles.muted}>{l.itemsCount} {l.itemsCount === 1 ? 'item' : 'itens'}</td>
                    <td className={styles.muted}>{l.paymentSummary ?? '—'}</td>
                    <td className={styles.amt}>{fmt(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Fechamento */}
        <aside className={styles.card}>
          <div className={styles.cardHead}><h2><Lock size={16} /> Fechar caixa</h2></div>

          <div className={styles.breakdown}>
            {METHODS.map(m => (
              <div key={m.key} className={styles.brow}>
                <div className={styles.browM}><span className={`${styles.swatch} ${m.cls}`} /> {m.label}</div>
                <span className={styles.browV}>{fmt(caixa.totals[m.key])}</span>
              </div>
            ))}
          </div>
          <div className={styles.totalLine}><span>Total apurado</span><strong>{fmt(caixa.totalSales)}</strong></div>

          <div className={styles.conf}>
            <h3>Conferência da gaveta</h3>
            <div className={styles.confRow}><span className={styles.muted}>Dinheiro esperado</span><strong>{fmt(expectedCash)}</strong></div>
            <div className={styles.confRow}>
              <span className={styles.muted}>Dinheiro contado</span>
              <span className={styles.cashin}><span>R$</span>
                <input value={counted} onChange={e => setCounted(e.target.value)} inputMode="decimal" />
              </span>
            </div>
            <div className={`${styles.diff} ${Math.abs(diff) < 0.005 ? styles.diffOk : styles.diffBad}`}>
              <span>Diferença</span><span>{(diff > 0 ? '+' : '') + fmt(diff)}</span>
            </div>
            <textarea className={styles.obs} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observações do período (opcional)…" />
          </div>

          {error && <div className={styles.err}><AlertTriangle size={13} /> {error}</div>}

          <button className={styles.finalize} onClick={handleFinalizar} disabled={finalizing || semVendas}>
            <Lock size={16} /> {finalizing ? 'Fechando…' : 'Fechar caixa'}
          </button>
          <p className={styles.hint}>
            Registra o resumo deste período (totais, dinheiro contado e diferença) e <strong>zera a visão</strong>.
            As vendas seguem normalmente — fechar não trava nada.
          </p>
        </aside>
      </div>

      {/* Detalhe da venda — abre ao clicar no lançamento (somente leitura no PDV) */}
      {detalheId && (
        <VendaDetalheModal
          saleId={detalheId}
          onClose={() => setDetalheId(null)}
          canDelete={false}
        />
      )}
    </div>
  )
}
