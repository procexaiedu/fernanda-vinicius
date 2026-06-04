'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, Trash2, X, TrendingUp, DollarSign, ShoppingBag } from 'lucide-react'
import { buscarDetalheComissao, deletarComissao, type ComissaoDetail } from '@/app/(sistema)/financeiro/actions'
import styles from '@/app/(sistema)/compras/ComprasClient.module.css'
import modalStyles from './ComissaoDetalheModal.module.css'

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4)
}

function fmtMonth(m: string) {
  const [y, mon] = m.split('-')
  return `${MONTHS_PT[parseInt(mon) - 1]} ${y}`
}

interface Props {
  transactionId: string
  onClose: () => void
  onDeleted?: () => void
}

export default function ComissaoDetalheModal({ transactionId, onClose, onDeleted }: Props) {
  const [detail, setDetail]               = useState<ComissaoDetail | null>(null)
  const [loading, setLoading]             = useState(true)
  const [deleting, setDeleting]           = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    buscarDetalheComissao(transactionId).then(({ data }) => {
      setDetail(data)
      setLoading(false)
    })
  }, [transactionId])

  async function handleDelete() {
    setDeleting(true)
    const r = await deletarComissao(transactionId)
    setDeleting(false)
    if (r.success) { onDeleted?.(); onClose() }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} ${modalStyles.modal}`} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h2 className={styles.modalTitle}>Detalhe da Comissão</h2>
            {detail && (
              <p className={styles.modalSubtitle}>
                {detail.seller_name} · {fmtMonth(detail.month)}
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
            {/* Cards resumo */}
            <div className={modalStyles.cards}>
              <div className={modalStyles.card}>
                <div className={modalStyles.cardIcon} style={{ background: 'rgba(76, 175, 125, 0.12)', color: '#4CAF7D' }}>
                  <ShoppingBag size={16} />
                </div>
                <div className={modalStyles.cardLabel}>Soma de Vendas</div>
                <div className={`${modalStyles.cardValue} ${modalStyles.cardGreen}`}>{fmt(detail.total_vendas)}</div>
                <div className={modalStyles.cardNote}>{detail.sales.length} {detail.sales.length === 1 ? 'venda' : 'vendas'} no mês</div>
              </div>

              <div className={modalStyles.card}>
                <div className={modalStyles.cardIcon} style={{ background: 'rgba(201,168,76,0.12)', color: 'var(--accent)' }}>
                  <TrendingUp size={16} />
                </div>
                <div className={modalStyles.cardLabel}>Lucro Bruto</div>
                <div className={`${modalStyles.cardValue} ${detail.lucro >= 0 ? modalStyles.cardGold : modalStyles.cardRed}`}>
                  {fmt(detail.lucro)}
                </div>
                <div className={modalStyles.cardNote}>Vendas − CMV</div>
              </div>

              <div className={modalStyles.card}>
                <div className={modalStyles.cardIcon} style={{ background: 'rgba(224,82,82,0.12)', color: '#E05252' }}>
                  <DollarSign size={16} />
                </div>
                <div className={modalStyles.cardLabel}>Comissão</div>
                <div className={`${modalStyles.cardValue} ${modalStyles.cardRed}`}>{fmt(detail.commission_amount)}</div>
                <div className={modalStyles.cardNote}>Valor pago à vendedora</div>
              </div>
            </div>

            {/* Tabela de vendas */}
            <div className={styles.modalSection}>
              <div className={styles.modalSectionTitle}><ShoppingBag size={13} /> Vendas participantes</div>
              {detail.sales.length === 0 ? (
                <p className={styles.muted} style={{ padding: '12px 0', fontSize: 13 }}>
                  Nenhuma venda encontrada para esse período.
                </p>
              ) : (
                <table className={styles.detailTable}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Loja</th>
                      <th style={{ textAlign: 'right' }}>Venda</th>
                      <th style={{ textAlign: 'right' }}>CMV</th>
                      <th style={{ textAlign: 'right' }}>Lucro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sales.map(s => (
                      <tr key={s.id}>
                        <td className={styles.muted}>{fmtDate(s.sale_date)}</td>
                        <td style={{ fontWeight: 500 }}>{s.client_name ?? '—'}</td>
                        <td className={styles.muted}>{s.store_name ?? '—'}</td>
                        <td style={{ textAlign: 'right', color: '#4CAF7D', fontWeight: 600 }}>{fmt(s.total)}</td>
                        <td style={{ textAlign: 'right' }} className={styles.muted}>{fmt(s.total_cost)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: s.profit >= 0 ? 'var(--accent)' : '#E05252' }}>
                          {fmt(s.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11, padding: '8px 12px', fontWeight: 600 }}>TOTAL</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, padding: '8px 12px', color: '#4CAF7D' }}>{fmt(detail.total_vendas)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, padding: '8px 12px', color: 'var(--text-muted)' }}>{fmt(detail.total_custo)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, padding: '8px 12px', color: 'var(--accent)' }}>{fmt(detail.lucro)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Botão excluir */}
            <div className={styles.modalActions}>
              {!confirmDelete ? (
                <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={13} /> Excluir comissão
                </button>
              ) : (
                <div className={styles.confirmDelete}>
                  <AlertTriangle size={13} />
                  <span>Isso remove apenas o registro financeiro. Confirma?</span>
                  <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Excluindo...' : 'Sim, excluir'}
                  </button>
                  <button className={styles.cancelBtn} onClick={() => setConfirmDelete(false)}>Cancelar</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
