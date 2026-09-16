'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, AlertTriangle, CheckCircle, Clock, Trash2, X, Package, CreditCard, Pencil, Printer } from 'lucide-react'
import { buscarDetalheCompra, deletarCompra, type PurchaseDetail } from '@/app/(sistema)/compras/actions'
import { buscarConsignacao } from '@/app/(sistema)/compras/acertos'
import styles from '@/app/(sistema)/compras/ComprasClient.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'
import BlocoAcertos from './BlocoAcertos'
import RelatorioCompra from './RelatorioCompra'

/* Dinheiro: um formatador só para o sistema — ver src/lib/dinheiro.ts */
const fmt = formatarDinheiro

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

  /*
   * A folha de conferência. Ela pediu em 15/09 e o sistema só tinha o botão de
   * ETIQUETA, que é outra impressora e outro documento: "eu não quero imprimir
   * na etiqueta, eu quero imprimir a tela".
   */
  const [imprimindo, setImprimindo] = useState(false)
  const [lote, setLote] = useState<{ acertado: number; falta: number; status: string } | null>(null)

  useEffect(() => {
    buscarDetalheCompra(purchaseId).then(({ data }) => {
      setDetail(data)
      setLoading(false)
    })
  }, [purchaseId])

  /* O acerto do lote consignado entra na folha — é o número que ela confere
     com a fornecedora. Só busca quando é consignado; compra normal não tem. */
  useEffect(() => {
    const id = detail?.consignment_id
    if (!id) return
    let vivo = true
    buscarConsignacao(id).then(c => {
      if (vivo && c) setLote({ acertado: c.acertado, falta: c.falta, status: c.status })
    })
    return () => { vivo = false }
  }, [detail?.consignment_id])

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {detail && !imprimindo && (
              <button
                className={styles.closeBtn}
                onClick={() => setImprimindo(true)}
                title="Imprimir a folha de conferência (papel A4, não é a etiqueta)"
              >
                <Printer size={16} />
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* `lote` só vale para compra consignada — a guarda mora no JSX, e não
            num setState dentro do efeito, que dispara render em cascata. */}
        {imprimindo && detail ? (
          <RelatorioCompra
            detail={detail}
            consignacao={detail.consignment_id ? lote : null}
            onFechar={() => setImprimindo(false)}
          />
        ) : loading ? (
          <div className={styles.modalLoading}>Carregando...</div>
        ) : !detail ? (
          <div className={styles.modalLoading}>Erro ao carregar.</div>
        ) : (
          <>
            {detail.notes && (
              <div className={styles.notesBox}>{detail.notes}</div>
            )}

            {/*
              Lote consignado: o acerto vem ANTES dos itens, de propósito.
              São 46 linhas de peça neste lote; deixar o pagamento embaixo delas
              obrigava a rolar a lista inteira toda vez que ela fosse acertar
              com a fornecedora — que é a ação mais repetida do lote, não a mais
              rara. Usa `modalSection` para respeitar o respiro lateral das
              demais seções.
            */}
            {detail.consignment_id && (
              <div className={styles.modalSection}>
                <BlocoAcertos id={detail.consignment_id} onMudou={() => router.refresh()} />
              </div>
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
                        <td className={`${styles.muted} col-date`}>{fmtDate(pay.due_date)}</td>
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
