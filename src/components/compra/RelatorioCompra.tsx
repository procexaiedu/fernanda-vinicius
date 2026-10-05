'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'
import Button from '@/components/ui/Button'
import { formatarDinheiro } from '@/lib/dinheiro'
import type { PurchaseDetail } from '@/app/(sistema)/compras/actions'
import ParaImprimir from '@/components/ui/ParaImprimir'
import styles from './RelatorioCompra.module.css'

/**
 * A compra impressa — a folha que ela confere na mão, contra o fornecedor.
 *
 * Pedido de 15/09, quando ela abriu o consignado e achou só o botão de
 * etiqueta:
 *
 *   — "Eu não quero imprimir na etiqueta, eu quero imprimir a tela."
 *   — "Como se fosse imprimir relatório, sabe?"
 *
 * São duas impressões diferentes e o sistema só tinha uma. Etiqueta é a
 * térmica, falando PPLA, uma peça por vez. Isto é A4 na impressora comum, pela
 * `window.print()` do navegador — mesmo caminho do romaneio de transferência.
 *
 * "Tem que ser branco, senão coitado da minha impressora": a folha é branca com
 * texto preto mesmo no tema escuro do sistema. Ver o CSS.
 *
 * "Para a loja" (05/10/2026): a mesma folha sem custo, sem código, sem acerto e
 * sem pagamentos, com etiqueta e preço de venda. É a que acompanha o lote até a
 * loja que vai conferir ("essa informação não pode aparecer para elas"). O
 * código sai porque nas peças de fornecedor ele carrega o custo (FEF09110 =
 * custo R$ 110).
 */
export default function RelatorioCompra({ detail, consignacao, onFechar }: {
  detail: PurchaseDetail
  /** Só quando o lote é consignado: o que já foi pago e o que falta. */
  consignacao?: { acertado: number; falta: number; status: string } | null
  onFechar: () => void
}) {
  const fornecedores = [...new Set(detail.items.map(i => i.supplier_name).filter(Boolean))]
  const lojas = [...new Set(detail.items.map(i => i.store_name).filter(Boolean))]
  const totalVenda = detail.items.reduce((s, i) => s + i.sale_price * i.quantity, 0)
  const [paraLoja, setParaLoja] = useState(false)

  return (
    <div className={styles.wrapper}>
      {/* Some na impressão: é controle de tela, não parte do documento. */}
      <div className={styles.acoes}>
        <Button size="sm" variant="ghost" onClick={onFechar}>Fechar</Button>
        <Button size="sm" variant="ghost" onClick={() => setParaLoja(v => !v)}>
          {paraLoja ? 'Versão completa (com custo)' : 'Versão para a loja (sem custo)'}
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Imprimir
        </Button>
      </div>

      <ParaImprimir>
      <div className={styles.folha}>
        <header className={styles.cabecalho}>
          <div>
            <h2 className={styles.titulo}>
              {detail.consignment_id ? 'Lote Consignado' : 'Compra'}
            </h2>
            <p className={styles.fornecedor}>
              {fornecedores.join(' · ') || '—'}
            </p>
          </div>
          <div className={styles.identificacao}>
            <span className={styles.numero}>Nº {detail.id.slice(0, 8).toUpperCase()}</span>
            <span className={styles.data}>
              {detail.purchase_date.slice(8, 10)}/{detail.purchase_date.slice(5, 7)}/{detail.purchase_date.slice(0, 4)}
            </span>
            {detail.nf_number && <span className={styles.nf}>NF {detail.nf_number}</span>}
            {lojas.length > 0 && <span className={styles.nf}>{lojas.join(' · ')}</span>}
          </div>
        </header>

        <div className={styles.resumo}>
          <div><span>Peças</span><strong>{detail.total_items}</strong></div>
          {!paraLoja && <div><span>Custo total</span><strong>{formatarDinheiro(detail.total_cost)}</strong></div>}
          <div><span>Venda total</span><strong>{formatarDinheiro(totalVenda)}</strong></div>
        </div>

        {/* O acerto é o que ela confere com a fornecedora — vem antes das peças,
            pela mesma razão que no modal: é a linha mais procurada da folha. */}
        {consignacao && !paraLoja && (
          <div className={styles.acerto}>
            <span>Já acertado <strong>{formatarDinheiro(consignacao.acertado)}</strong></span>
            <span>Falta <strong>{formatarDinheiro(consignacao.falta)}</strong></span>
            <span className={styles.statusLote}>{consignacao.status}</span>
          </div>
        )}

        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>#</th>
              {paraLoja && <th>Etiqueta</th>}
              <th>Peça</th>
              {!paraLoja && <th>Código</th>}
              <th>Fornecedor</th>
              <th className={styles.num}>Qtd.</th>
              <th className={styles.num}>{paraLoja ? 'Venda un.' : 'Custo un.'}</th>
              <th className={styles.num}>{paraLoja ? 'Total venda' : 'Subtotal'}</th>
              <th className={styles.conferido}>Conferido</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((i, n) => (
              <tr key={i.id}>
                <td className={styles.ordem}>{n + 1}</td>
                {paraLoja && <td className={styles.codigo}>{i.barcode_number ?? '—'}</td>}
                <td>{i.product_name}</td>
                {!paraLoja && <td className={styles.codigo}>{i.code}</td>}
                <td>{i.supplier_name}</td>
                <td className={styles.num}>{i.quantity}</td>
                <td className={styles.num}>{formatarDinheiro(paraLoja ? i.sale_price : i.unit_cost)}</td>
                <td className={styles.num}>
                  {formatarDinheiro(paraLoja ? i.sale_price * i.quantity : i.subtotal)}
                </td>
                {/* Quadradinho para conferir no papel, como no romaneio. */}
                <td className={styles.conferido}><span className={styles.quadrado} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total</td>
              <td className={styles.num}>{detail.total_items}</td>
              <td />
              <td className={styles.num}>{formatarDinheiro(paraLoja ? totalVenda : detail.total_cost)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {detail.payments.length > 0 && !paraLoja && (
          <>
            <h3 className={styles.subtitulo}>Pagamentos</h3>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Forma</th>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th>Situação</th>
                  <th className={styles.num}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {detail.payments.map(p => (
                  <tr key={p.id}>
                    <td>{
                      ({ pix: 'PIX', cash: 'Dinheiro', transfer: 'Transferência',
                         credit: 'Crédito', debit: 'Débito', check: 'Cheque' } as Record<string, string>)[p.payment_method]
                      ?? p.payment_method
                    }</td>
                    <td>{p.installment_number ?? '—'}</td>
                    <td>{p.due_date
                      ? `${p.due_date.slice(8, 10)}/${p.due_date.slice(5, 7)}/${p.due_date.slice(0, 4)}`
                      : '—'}</td>
                    <td>{p.status === 'paid' ? 'Pago' : 'Em aberto'}</td>
                    <td className={styles.num}>{formatarDinheiro(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {detail.notes && (
          <p className={styles.observacao}><strong>Observação:</strong> {detail.notes}</p>
        )}

        <div className={styles.assinaturas}>
          <div><span className={styles.linha} />Conferente{paraLoja && ' na loja · data'}</div>
          <div><span className={styles.linha} />{paraLoja ? 'Assinatura' : 'Fornecedor'}</div>
        </div>
      </div>
      </ParaImprimir>
    </div>
  )
}
