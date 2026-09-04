'use client'

import { useState, useEffect } from 'react'
import { ArrowLeftRight, AlertTriangle, X, Trash2, Receipt, FileText, RefreshCw, Download, MessageCircle } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { emitirNotaDaVenda, sincronizarNota, cancelarNotaDaVenda } from '@/app/(sistema)/vendas/fiscal'
import { buscarDetalheVenda, deletarVenda, type VendaDetail } from '@/app/(sistema)/vendas/actions'
import styles from '@/app/(sistema)/vendas/VendasClient.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'
import { linkDaNotaNoWhatsApp } from '@/lib/fiscal/enviarDanfe'

/* Dinheiro: um formatador só para o sistema — ver src/lib/dinheiro.ts */
const fmt = formatarDinheiro

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
  /**
   * Abre já na confirmação de exclusão.
   *
   * É o que o lixinho da LISTA usa. Assim o caminho encurta sem pular etapa: a
   * confirmação continua sendo esta, que já mostra o que vai ser revertido —
   * peças que voltam ao estoque, valor, cliente.
   */
  abrirNaExclusao?: boolean
}

export default function VendaDetalheModal({ saleId, onClose, onDeleted, canDelete = true, abrirNaExclusao = false }: Props) {
  const [venda, setVenda]           = useState<VendaDetail | null>(null)
  const [loading, setLoading]       = useState(true)
  const [confirmDel, setConfirmDel] = useState(abrirNaExclusao)
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
                      <span><span className="nome-cliente">{venda.customer_name}</span></span>
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

              {/*
                A NOTA FISCAL.
                Fica aqui, no detalhe, e não no fechamento da venda: emitir é
                ato separado, que pode falhar sem derrubar a venda, e que
                alguém precisa poder repetir depois. Ver src/app/(sistema)/
                vendas/fiscal.ts.
              */}
              <BlocoFiscal
                saleId={venda.id}
                nfce={venda.nfce}
                cpf={venda.destinatario_cpf}
                cliente={venda.customer_name}
                telefone={venda.customer_phone}
                loja={venda.store_name}
                podeEmitir={canDelete}
                onMudou={() => buscarDetalheVenda(saleId).then(r => r.data && setVenda(r.data))}
              />

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

// ─── Bloco fiscal ─────────────────────────────────────────────────────────────

const ROTULO_STATUS: Record<string, string> = {
  autorizada: 'Nota autorizada',
  pendente:   'Emissão em andamento',
  rejeitada:  'Nota rejeitada',
  cancelada:  'Nota cancelada',
  erro:       'Não foi possível emitir',
}

/**
 * A nota da venda: estado, emitir, reconsultar, cancelar.
 *
 * O que dita o desenho é que **emitir é uma ação que falha**. O SEFAZ recusa,
 * a rede cai, um campo está errado. Então o bloco tem de mostrar o MOTIVO com
 * a mesma clareza que mostra o sucesso — quem está no balcão precisa saber o
 * que fazer, não que "deu erro".
 */
function BlocoFiscal({ saleId, nfce, cpf, cliente, telefone, loja, podeEmitir, onMudou }: {
  saleId: string
  nfce: VendaDetail['nfce']
  cpf: string | null
  cliente: string | null
  telefone: string | null
  loja: string | null
  podeEmitir: boolean
  onMudou: () => void
}) {
  /*
   * O link é montado NA RENDERIZAÇÃO, não no clique.
   *
   * Abrir o WhatsApp depois de um `await` é o que o navegador barra como
   * pop-up — foi a armadilha que apareceu no comprovante do SM Imports. Com o
   * link pronto em mãos, o clique é síncrono e passa.
   *
   * `null` quando a cliente não tem telefone ou a nota não saiu: aí o botão
   * simplesmente não existe, em vez de abrir o WhatsApp em branco.
   */
  const linkWhats = linkDaNotaNoWhatsApp({
    telefone,
    danfeUrl: nfce.danfe_url,
    nomeDaCliente: cliente,
    loja,
  })
  const [ocupado, setOcupado] = useState<'emitir' | 'sincronizar' | 'cancelar' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [recusas, setRecusas] = useState<{ campo: string; motivo: string }[]>([])
  const [pedindoJustificativa, setPedindoJustificativa] = useState(false)
  const [justificativa, setJustificativa] = useState('')

  async function rodar(qual: 'emitir' | 'sincronizar' | 'cancelar') {
    setOcupado(qual); setErro(null); setRecusas([])
    const r = qual === 'emitir'      ? await emitirNotaDaVenda(saleId)
            : qual === 'sincronizar' ? await sincronizarNota(saleId)
            :                          await cancelarNotaDaVenda(saleId, justificativa)
    setOcupado(null)
    if (!r.success) {
      setErro(r.error ?? 'Falhou.')
      setRecusas(r.recusas ?? [])
    } else {
      setPedindoJustificativa(false); setJustificativa('')
    }
    onMudou()
  }

  const status = nfce.status
  const autorizada = status === 'autorizada'

  return (
    <div className={styles.detailSection}>
      <div className={styles.detailSectionTitle}>Nota fiscal</div>

      {!status && (
        <div className={styles.fiscalVazio}>
          Esta venda não tem nota.
          {cpf && <> A cliente pediu no CPF <strong>{cpf}</strong>.</>}
        </div>
      )}

      {status && (
        <div className={styles.fiscalLinha}>
          <span className={`${styles.fiscalSelo} ${styles[`fiscal_${status}`] ?? ''}`}>
            {ROTULO_STATUS[status] ?? status}
          </span>
          {nfce.numero && <span className={styles.fiscalNumero}>nº {nfce.numero}/série {nfce.serie}</span>}
        </div>
      )}

      {/* A chave é o que a contadora pede. Quebrada em blocos de 4 para dar
          para ler e conferir sem perder a conta. */}
      {nfce.chave && (
        <div className={styles.fiscalChave}>{nfce.chave.replace(/(\d{4})(?=\d)/g, '$1 ')}</div>
      )}

      {nfce.motivo_rejeicao && !autorizada && (
        <div className={styles.fiscalMotivo}>{nfce.motivo_rejeicao}</div>
      )}

      {erro && <div className={styles.fiscalErro}>{erro}</div>}
      {recusas.length > 0 && (
        <ul className={styles.fiscalRecusas}>
          {recusas.map((r, i) => <li key={i}><strong>{r.campo}</strong>: {r.motivo}</li>)}
        </ul>
      )}

      {podeEmitir && (
        <div className={styles.fiscalAcoes}>
          {!autorizada && status !== 'cancelada' && (
            <Button size="sm" variant="outline" onClick={() => rodar('emitir')} loading={ocupado === 'emitir'}>
              <FileText size={13} /> {status ? 'Tentar de novo' : 'Emitir nota'}
            </Button>
          )}

          {/* Só faz sentido reconsultar quando a emissão ficou no meio do
              caminho — é o caso "a rede caiu e não sei se a nota saiu". */}
          {status === 'pendente' && (
            <Button size="sm" variant="ghost" onClick={() => rodar('sincronizar')} loading={ocupado === 'sincronizar'}>
              <RefreshCw size={13} /> Consultar na Receita
            </Button>
          )}

          {nfce.danfe_url && (
            <a className={styles.fiscalDanfe} href={nfce.danfe_url} target="_blank" rel="noopener noreferrer">
              <Download size={13} /> Baixar DANFE
            </a>
          )}

          {/* Abre a conversa com o texto pronto — quem envia é a vendedora. */}
          {linkWhats && (
            <a className={styles.fiscalWhats} href={linkWhats} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={13} /> Mandar no WhatsApp
            </a>
          )}

          {autorizada && !pedindoJustificativa && (
            <Button size="sm" variant="ghost" onClick={() => setPedindoJustificativa(true)}>
              Cancelar nota
            </Button>
          )}
        </div>
      )}

      {pedindoJustificativa && (
        <div className={styles.fiscalCancelar}>
          {/* 15 caracteres é exigência do SEFAZ, não nossa. O contador vai ler
              esta justificativa, então ela precisa dizer algo de verdade. */}
          <input
            className={styles.fiscalJustificativa}
            value={justificativa}
            onChange={e => setJustificativa(e.target.value)}
            placeholder="Motivo do cancelamento (mínimo 15 letras)"
            maxLength={255}
          />
          <div className={styles.fiscalCancelarAcoes}>
            <Button size="sm" variant="ghost" onClick={() => setPedindoJustificativa(false)}>Voltar</Button>
            <Button
              size="sm" variant="danger"
              disabled={justificativa.trim().length < 15}
              loading={ocupado === 'cancelar'}
              onClick={() => rodar('cancelar')}
            >
              Cancelar a nota
            </Button>
          </div>
          <span className={styles.fiscalAviso}>
            Cancelar a nota não desfaz a venda. O SEFAZ aceita cancelamento por 30 minutos.
          </span>
        </div>
      )}
    </div>
  )
}
