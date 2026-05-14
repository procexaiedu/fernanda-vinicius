'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, Loader2, FileBarChart2 } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { gerarFechamento, type FechamentoData } from './actions'
import styles from './FechamentoModal.module.css'

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function todayStr() {
  const t = new Date()
  const mm = String(t.getMonth() + 1).padStart(2, '0')
  const dd = String(t.getDate()).padStart(2, '0')
  return `${t.getFullYear()}-${mm}-${dd}`
}

function fmtDateLabel(from: string, to: string) {
  function f(s: string) {
    const [y, m, d] = s.split('-')
    return `${d}/${m}/${y}`
  }
  return from === to ? f(from) : `${f(from)} a ${f(to)}`
}

interface Props {
  sellers: Array<{ id: string; full_name: string }>
  userRole: string
  onClose: () => void
}

export default function FechamentoModal({ sellers, userRole, onClose }: Props) {
  const [mounted, setMounted] = useState(false)
  const [step, setStep] = useState<'filter' | 'result'>('filter')
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [sellerId, setSellerId] = useState<string>('')  // '' = todas
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<FechamentoData | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  async function handleGenerate() {
    if (!dateFrom || !dateTo) return
    setLoading(true)
    setError(null)
    const res = await gerarFechamento({
      dateFrom,
      dateTo,
      sellerId: sellerId || null,
    })
    setLoading(false)
    if (res.error || !res.data) {
      setError(res.error ?? 'Erro ao gerar fechamento.')
      return
    }
    setData(res.data)
    setStep('result')
  }

  if (!mounted) return null

  const selectedSellerName = sellers.find(s => s.id === sellerId)?.full_name ?? 'Todas as vendedoras'

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={`${styles.modal} ${step === 'result' ? styles.modalLg : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {step === 'result' && (
              <button className={styles.backBtn} onClick={() => setStep('filter')}>
                <ChevronLeft size={13} />
                Voltar
              </button>
            )}
            <div>
              <div className={styles.title}>
                <FileBarChart2 size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom', color: 'var(--accent)' }} />
                {step === 'filter' ? 'Fechamento' : `Fechamento — ${fmtDateLabel(dateFrom, dateTo)}`}
              </div>
              {step === 'result' && userRole === 'operator' && (
                <div className={styles.subtitle}>Suas vendas</div>
              )}
              {step === 'result' && userRole === 'admin' && (
                <div className={styles.subtitle}>{selectedSellerName}</div>
              )}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {step === 'filter' && (
            <>
              {/* Período */}
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Período</label>
                <div className={styles.dateRow}>
                  <DatePicker value={dateFrom} onChange={v => { setDateFrom(v); if (v > dateTo) setDateTo(v) }} />
                  <span>até</span>
                  <DatePicker value={dateTo} onChange={v => { setDateTo(v); if (v < dateFrom) setDateFrom(v) }} />
                </div>
              </div>

              {/* Vendedora (admin only) */}
              {userRole === 'admin' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Vendedora</label>
                  <select
                    className={styles.sellerSelect}
                    value={sellerId}
                    onChange={e => setSellerId(e.target.value)}
                  >
                    <option value="">Todas as vendedoras</option>
                    {sellers.map(s => (
                      <option key={s.id} value={s.id}>{s.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {error && <div className={styles.errorMsg}>{error}</div>}

              <button
                className={styles.generateBtn}
                onClick={handleGenerate}
                disabled={loading || !dateFrom || !dateTo}
              >
                {loading ? <Loader2 size={15} className={styles.spin} /> : null}
                {loading ? 'Gerando...' : 'Gerar Fechamento'}
              </button>
            </>
          )}

          {step === 'result' && data && (
            <>
              {/* Stats */}
              <div className={styles.statsRow}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Vendas</span>
                  <span className={styles.statValue}>{data.vendas}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Receita</span>
                  <span className={styles.statValueSm}>{fmt(data.receita)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Ticket Médio</span>
                  <span className={styles.statValueSm}>{fmt(data.ticketMedio)}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Trocas</span>
                  <span className={styles.statValue}>{data.trocas}</span>
                </div>
              </div>

              {data.vendas === 0 && (
                <div className={styles.emptyNote}>
                  Nenhuma venda encontrada neste período.
                </div>
              )}

              {/* Formas de Pagamento */}
              {data.pagamentos.length > 0 && (
                <div className={styles.section}>
                  <span className={styles.sectionTitle}>Formas de Pagamento</span>
                  {data.pagamentos.map(p => (
                    <div key={p.method} className={styles.lineItem}>
                      <span className={styles.lineItemLeft}>{p.label}</span>
                      <span className={styles.lineItemAmount}>{fmt(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Por Categoria */}
              {data.categorias.length > 0 && (
                <div className={styles.section}>
                  <span className={styles.sectionTitle}>Por Categoria</span>
                  {data.categorias.map(c => (
                    <div key={c.category} className={styles.lineItem}>
                      <span className={styles.lineItemLeft}>
                        {c.category}
                        <span className={styles.lineItemQty}>{c.quantidade} pç{c.quantidade !== 1 ? 's' : ''}</span>
                      </span>
                      <span className={styles.lineItemAmount}>{fmt(c.receita)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Por Vendedora (admin, todas) */}
              {data.porVendedora.length > 1 && (
                <div className={styles.section}>
                  <span className={styles.sectionTitle}>Por Vendedora</span>
                  {data.porVendedora.map(v => (
                    <div key={v.id} className={styles.lineItem}>
                      <span className={styles.lineItemLeft}>
                        {v.name}
                        <span className={styles.lineItemQty}>{v.vendas} venda{v.vendas !== 1 ? 's' : ''}</span>
                      </span>
                      <span className={styles.lineItemAmount}>{fmt(v.receita)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
