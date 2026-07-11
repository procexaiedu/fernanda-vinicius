'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, AlertTriangle, CheckCircle, Clock, Trash2, X, Package, CreditCard, Pencil } from 'lucide-react'
import { buscarDetalheCompra, deletarCompra, type PurchaseDetail } from '@/app/(sistema)/compras/actions'
import styles from '@/app/(sistema)/compras/ComprasClient.module.css'

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4)
}

function methodLabel(m: string) {
  return { pix: 'PIX', cash: 'Dinheiro', transfer: 'Transferência', credit: 'Crédito', debit: 'Débito', check: 'Cheque' }[m] ?? m
}

interface Props {
  purchaseId: string
  onClose: () => void
  onDeleted?: () => void
  canDelete?: boolean
}

export default function CompraDetalheModal({ purchaseId, onClose, onDeleted, canDelete = true }: Props) {
  const router = useRouter()
  const [detail, setDetail]               = useState<PurchaseDetail | null>(null)
  const [loading, setLoading]             = useState(true)
  const [deleting, setDeleting]           = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    buscarDetalheCompra(purchaseId).then(({ data }) => {
      setDetail(data)
      setLoading(false)
    })
  }, [purchaseId])

  async function handleDelete() {
    setDeleting(true)
    const r = await deletarCompra(purchaseId)
    setDeleting(false)
    if (r.success) { onDeleted?.(); onClose() }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h2 className={styles.modalTitle}>Detalhe da Compra</h2>
            {detail && (
              <p className={styles.modalSubtitle}>
                {fmtDate(detail.purchase_date)}
                {detail.nf_number && <> · NF {detail.nf_number}</>}
                {detail.nf_url && (
                  <a href={detail.nf_url} target="_blank" rel="noreferrer" className={styles.nfLink} style={{ marginLeft: 6 }}>
                    <ExternalLink size={11} /> Ver NF
                  </a>
                )}
              </p>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? (
          <div className={styles.modalLoading}>Carregando...</div>
        ) : !detail ? (
          <div className={styles.modalLoading}>Erro ao carregar.</div>
        ) : (
          <>
            {detail.notes && (
              <div className={styles.notesBox}>{detail.notes}</div>
            )}

            <div className={styles.modalSection}>
              <div className={styles.modalSectionTitle}><Package size={13} /> Itens ({detail.items.length})</div>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Fornecedor</th>
                    <th>Categoria</th>
                    <th>Material</th>
                    <th>Loja</th>
                    <th>Código</th>
                    <th>Etiq.</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Custo unit.</th>
                    <th style={{ textAlign: 'right' }}>Venda unit.</th>
                    <th style={{ textAlign: 'right' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map(item => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 500 }}>{item.product_name}</td>
                      <td className={styles.muted}>{item.supplier_name}</td>
                      <td className={styles.muted} style={{ textTransform: 'capitalize' }}>{item.category}</td>
                      <td className={styles.muted} style={{ textTransform: 'capitalize' }}>{item.material}</td>
                      <td className={styles.muted}>{item.store_name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{item.code}</td>
                      <td className={styles.muted}>{item.label_format}</td>
                      <td style={{ textAlign: 'right' }} className={styles.muted}>{item.quantity}</td>
                      <td style={{ textAlign: 'right' }} className={styles.muted}>{fmt(item.unit_cost)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(item.sale_price)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11, padding: '8px 12px', fontWeight: 600 }}>CUSTO TOTAL</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, padding: '8px 12px', color: 'var(--accent)' }}>{fmt(detail.total_cost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {detail.payments.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionTitle}><CreditCard size={13} /> Pagamentos</div>
                <table className={styles.detailTable}>
                  <thead>
                    <tr>
                      <th>Método</th>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th style={{ textAlign: 'right' }}>Valor</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.map(pay => (
                      <tr key={pay.id}>
                        <td>{methodLabel(pay.payment_method)}</td>
                        <td className={styles.muted}>{pay.installment_number ? `${pay.installment_number}x` : '—'}</td>
                        <td className={styles.muted}>{fmtDate(pay.due_date)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(pay.amount)}</td>
                        <td>
                          {pay.status === 'completed'
                            ? <span className={styles.statusPaid}><CheckCircle size={11} /> Pago</span>
                            : <span className={styles.statusPending}><Clock size={11} /> Pendente</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                className={styles.editBtn}
                onClick={() => { onClose(); router.push(`/compras/${purchaseId}/editar`) }}
              >
                <Pencil size={13} /> Editar compra
              </button>

              {canDelete && (
                <>
                  {!confirmDelete ? (
                    <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>
                      <Trash2 size={13} /> Excluir compra
                    </button>
                  ) : (
                    <div className={styles.confirmDelete}>
                      <AlertTriangle size={13} />
                      <span>Excluir também reverte o estoque. Confirma?</span>
                      <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                        {deleting ? 'Excluindo...' : 'Sim, excluir'}
                      </button>
                      <button className={styles.cancelBtn} onClick={() => setConfirmDelete(false)}>Cancelar</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
