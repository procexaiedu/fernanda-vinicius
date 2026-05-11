'use client'

import { useState, useEffect } from 'react'
import { ArrowLeftRight, AlertTriangle, X, Trash2, Receipt } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { buscarDetalheVenda, deletarVenda, type VendaDetail } from '@/app/(sistema)/vendas/actions'
import styles from '@/app/(sistema)/vendas/VendasClient.module.css'

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  const date = s.slice(0, 10)
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito',
}

interface Props {
  saleId: string
  onClose: () => void
  onDeleted?: () => void
  canDelete?: boolean
}

export default function VendaDetalheModal({ saleId, onClose, onDeleted, canDelete = true }: Props) {
  const [venda, setVenda]           = useState<VendaDetail | null>(null)
  const [loading, setLoading]       = useState(true)
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [deleteErr, setDeleteErr]   = useState('')

  useEffect(() => {
    buscarDetalheVenda(saleId).then(r => {
      setVenda(r.data)
      setLoading(false)
    })
  }, [saleId])

  async function handleDelete() {
    setDeleting(true)
    setDeleteErr('')
    const res = await deletarVenda(saleId)
    setDeleting(false)
    if (!res.success) { setDeleteErr(res.error ?? 'Erro ao deletar.'); return }
    onDeleted?.()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <Receipt size={16} />
            Detalhe da Venda
          </div>
          <div className={styles.modalHeaderActions}>
            {canDelete && !confirmDel && (
              <button className={styles.deleteBtn} onClick={() => setConfirmDel(true)} title="Excluir venda">
                <Trash2 size={14} />
              </button>
            )}
            {canDelete && confirmDel && (
              <div className={styles.deleteConfirm}>
                <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />
                <span>Reverter estoque e excluir?</span>
                <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                  {deleting ? '...' : 'Sim'}
                </button>
                <button className={styles.deleteBtnCancel} onClick={() => setConfirmDel(false)}>Não</button>
              </div>
            )}
            {deleteErr && <span className={styles.deleteError}>{deleteErr}</span>}
            <button className={styles.closeBtn} onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className={styles.modalBody}>
          {loading ? (
            <div className={styles.loadingState}>Carregando...</div>
          ) : !venda ? (
            <div className={styles.loadingState}>Venda não encontrada.</div>
          ) : (
            <>
              <div className={styles.detailHeader}>
                <div className={styles.detailMeta}>
                  <span className={styles.detailDate}>{fmtDate(venda.sale_date)}</span>
                  <span className={styles.detailSep}>·</span>
                  <span>{venda.store_name}</span>
                  {venda.customer_name && (
                    <>
                      <span className={styles.detailSep}>·</span>
                      <span>{venda.customer_name}</span>
                    </>
                  )}
                  {venda.seller_name && (
                    <>
                      <span className={styles.detailSep}>·</span>
                      <span className={styles.sellerTag}>Vendedora: {venda.seller_name}</span>
                    </>
                  )}
                </div>
                <Badge variant={venda.status === 'completed' ? 'success' : 'muted'}>
                  {venda.status === 'completed' ? 'Concluída' : venda.status}
                </Badge>
              </div>

              <div className={styles.detailSection}>
                <div className={styles.detailSectionTitle}>Itens</div>
                <table className={styles.detailTable}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Código</th>
                      <th style={{ textAlign: 'right' }}>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Preço unit.</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venda.items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.product_name}</td>
                        <td className={styles.codeCell}>{item.product_code}</td>
                        <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(item.unit_price)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.detailSummary}>
                <div className={styles.summaryLine}>
                  <span>Subtotal</span>
                  <span>{fmt(venda.subtotal)}</span>
                </div>
                {venda.discount_amount > 0 && (
                  <div className={`${styles.summaryLine} ${styles.summaryDiscount}`}>
                    <span>
                      Desconto
                      {venda.discount_type && ` (${venda.discount_type.split(',').map(d =>
                        d === 'pix' ? 'PIX' : d === 'birthday' ? 'Aniversário' : 'Manual'
                      ).join(' + ')})`}
                    </span>
                    <span>− {fmt(venda.discount_amount)}</span>
                  </div>
                )}
                <div className={`${styles.summaryLine} ${styles.summaryTotal}`}>
                  <span>Total</span>
                  <strong>{fmt(venda.total)}</strong>
                </div>
              </div>

              {venda.payments.length > 0 && (
                <div className={styles.detailSection}>
                  <div className={styles.detailSectionTitle}>Pagamentos</div>
                  <div className={styles.paymentsList}>
                    {venda.payments.map((p, i) => (
                      <div key={i} className={styles.paymentItem}>
                        <span>{METHOD_LABELS[p.payment_method] ?? p.payment_method}</span>
                        {p.installments > 1 && (
                          <span className={styles.installmentBadge}>{p.installments}x de {fmt(p.amount / p.installments)}</span>
                        )}
                        <span className={styles.paymentAmount}>{fmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {venda.exchange && (
                <div className={styles.detailSection}>
                  <div className={styles.exchangeHeader}>
                    <ArrowLeftRight size={13} />
                    <div className={styles.detailSectionTitle} style={{ marginBottom: 0 }}>Troca</div>
                  </div>

                  {venda.exchange.returned_items.length > 0 && (
                    <>
                      <div className={styles.exchangeSubtitle}>Devolvidos pelo cliente</div>
                      {venda.exchange.returned_items.map((item, i) => (
                        <div key={i} className={styles.exchangeItemRow}>
                          <span>{item.product_name}</span>
                          <span className={styles.codeCell}>{item.product_code}</span>
                          <span>{item.quantity}x</span>
                          <span className={styles.paymentAmount}>{fmt(item.unit_price)}</span>
                        </div>
                      ))}
                    </>
                  )}

                  {venda.exchange.given_items.length > 0 && (
                    <>
                      <div className={styles.exchangeSubtitle} style={{ marginTop: 8 }}>Recebidos pelo cliente</div>
                      {venda.exchange.given_items.map((item, i) => (
                        <div key={i} className={styles.exchangeItemRow}>
                          <span>{item.product_name}</span>
                          <span className={styles.codeCell}>{item.product_code}</span>
                          <span>{item.quantity}x</span>
                          <span className={styles.paymentAmount}>{fmt(item.unit_price)}</span>
                        </div>
                      ))}
                    </>
                  )}

                  <div className={styles.exchangeDiff}>
                    {venda.exchange.price_difference > 0
                      ? `Cliente pagou diferença: ${fmt(venda.exchange.price_difference)}`
                      : venda.exchange.price_difference < 0
                        ? `Crédito sobrando: ${fmt(Math.abs(venda.exchange.price_difference))}`
                        : 'Troca sem diferença de valor'}
                  </div>
                </div>
              )}

              {venda.notes && (
                <div className={styles.detailNotes}>{venda.notes}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
