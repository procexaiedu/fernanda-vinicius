'use client'

import { useEffect } from 'react'
import { Printer } from 'lucide-react'
import Button from '@/components/ui/Button'
import { formatarDinheiro } from '@/lib/dinheiro'
import type { Romaneio as RomaneioT } from './page'
import ParaImprimir from '@/components/ui/ParaImprimir'
import styles from './Romaneio.module.css'
import { TITULO_ROMANEIO } from '@/lib/consignacaoEntreLojas'

/**
 * O romaneio impresso — o papel que vai dentro da caixa.
 *
 * Sai por `window.print()` e CSS `@media print`, não pelo agente de impressão
 * local: aquele fala PPLA com a impressora térmica de etiqueta. Isto é folha A4
 * na impressora comum.
 *
 * Os números vêm de `totals`, congelado no envio, e o nome/preço de cada peça
 * vem da linha do item, não de um join com `products`. É o que garante que o
 * papel dentro da caixa e a tela de quem confere digam a mesma coisa mesmo que
 * a peça seja renomeada ou reprecificada no meio do caminho.
 *
 * SEM CUSTO E SEM CÓDIGO, para ninguém (05/10/2026): o papel vai para a outra
 * loja e quem confere é funcionária. O código saiu junto porque nas peças de
 * fornecedor ele carrega o custo (FEF09110 = custo R$ 110). Etiqueta + nome
 * bastam para conferir. O custo continua na lista, só para admin.
 */
export default function Romaneio({ r, onFechar, recemEnviado = false }: {
  r: RomaneioT
  onFechar: () => void
  /* Aberto sozinho logo após fechar a remessa: já chama a impressão. */
  recemEnviado?: boolean
}) {
  /* Pedido da Eleandra (05/10/2026): fechou o consignado, o papel já aparece
     para imprimir e ir na caixa. O atraso deixa o portal de impressão montar. */
  useEffect(() => {
    if (!recemEnviado) return
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [recemEnviado])

  const enviados = r.itens.filter(i => i.quantity_sent > 0)
  const pecas = r.totals?.pecas ?? enviados.reduce((s, i) => s + i.quantity_sent, 0)
  /* Sem fallback de propósito: o preço de venda daquele dia não foi guardado
     nos romaneios antigos e não dá para reconstruir. Ver page.tsx. */
  const venda = r.totals?.venda_total
  const reetiquetar = enviados.filter(i => i.reetiquetar)

  // Desfecho: depois de conferida (recebida/divergente), o papel mostra o que
  // VOLTOU (recebido) e o que FICOU (faltou) por peça — não um quadrado em branco.
  const conferido = r.status === 'recebida' || r.status === 'divergente'
  const totalRecebido = enviados.reduce((s, i) => s + (i.quantity_received ?? 0), 0)
  const totalFaltou = pecas - totalRecebido

  return (
    <div className={styles.wrapper}>
      {/* Some na impressão: é controle de tela, não parte do documento. */}
      <div className={styles.acoes}>
        {recemEnviado && (
          <span className={styles.recemEnviado}>Remessa enviada. Imprima e coloque o romaneio na caixa.</span>
        )}
        <Button size="sm" variant="ghost" onClick={onFechar}>Fechar</Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Imprimir romaneio
        </Button>
      </div>

      <ParaImprimir>
      <div className={styles.folha}>
        <header className={styles.cabecalho}>
          <div>
            <h2 className={styles.titulo}>{TITULO_ROMANEIO[r.kind] ?? 'Romaneio de Transferência'}</h2>
            <p className={styles.rota}>
              {r.de} <span className={styles.seta}>→</span> {r.para}
            </p>
          </div>
          <div className={styles.identificacao}>
            {/* Os 8 primeiros caracteres do uuid bastam para casar papel e tela. */}
            <span className={styles.numero}>Nº {r.id.slice(0, 8).toUpperCase()}</span>
            <span className={styles.dataEnvio}>
              {new Date(r.sent_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
            <span className={styles.responsavel}>Enviado por {r.enviou}</span>
            {conferido && r.received_at && (
              <span className={styles.responsavel}>
                Recebido {new Date(r.received_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por {r.recebeu ?? '—'}
              </span>
            )}
          </div>
        </header>

        {/* Peças e venda. O custo saiu em 05/10 (ver o topo do arquivo). */}
        <div className={styles.resumo}>
          <div><span>Peças</span><strong>{pecas}</strong></div>
          <div>
            <span>Venda total</span>
            <strong>{venda === undefined ? '—' : formatarDinheiro(venda)}</strong>
          </div>
        </div>

        {reetiquetar.length > 0 && (
          <p className={styles.avisoEtiqueta}>
            <strong>{reetiquetar.length} peça{reetiquetar.length > 1 ? 's' : ''} precisa
            {reetiquetar.length > 1 ? 'm' : ''} de etiqueta nova na chegada.</strong> No
            destino elas ganharam um código de barras próprio, e sem reimprimir a etiqueta o
            leitor não acha a peça em {r.para}.
          </p>
        )}

        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>#</th>
              <th>Etiqueta</th>
              <th>Peça</th>
              <th className={`${styles.num} col-num`}>Qtd.</th>
              <th className={`${styles.num} col-num`}>Venda un.</th>
              <th className={`${styles.num} col-num`}>Total venda</th>
              {conferido ? (
                <>
                  <th className={`${styles.num} col-num`}>Recebido</th>
                  <th className={`${styles.num} col-num`}>Faltou</th>
                </>
              ) : (
                <th className={styles.conferido}>Conferido</th>
              )}
            </tr>
          </thead>
          <tbody>
            {enviados.map((i, n) => (
              <tr key={i.id}>
                <td className={styles.ordem}>{n + 1}</td>
                <td className={styles.etiqueta}>
                  {i.barcode_number}
                  {i.reetiquetar && <span className={styles.tagReetiquetar}>nova no destino</span>}
                </td>
                <td>{i.product_name}</td>
                <td className={`${styles.num} col-num`}>{i.quantity_sent}</td>
                {/* "—" nos itens anteriores a 15/09: o preço do dia não foi guardado. */}
                <td className={`${styles.num} col-num`}>
                  {i.unit_sale_price == null ? '—' : formatarDinheiro(i.unit_sale_price)}
                </td>
                <td className={`${styles.num} col-num`}>
                  {i.unit_sale_price == null ? '—' : formatarDinheiro(i.unit_sale_price * i.quantity_sent)}
                </td>
                {conferido ? (
                  <>
                    <td className={`${styles.num} col-num`}>{i.quantity_received ?? 0}</td>
                    <td className={`${styles.num} col-num`}>{i.quantity_sent - (i.quantity_received ?? 0)}</td>
                  </>
                ) : (
                  /* Quadradinho para a conferência no papel, quando o leitor não está à mão. */
                  <td className={styles.conferido}><span className={styles.quadrado} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {conferido && (
          <p className={styles.desfecho}>
            Enviado <strong>{pecas}</strong> · Recebido (voltou) <strong>{totalRecebido}</strong>
            {' · '}Faltou (ficou) <strong>{totalFaltou}</strong>
          </p>
        )}

        {r.notes && <p className={styles.observacao}><strong>Observação:</strong> {r.notes}</p>}

        <div className={styles.assinaturas}>
          <div><span className={styles.linha} />Conferente na saída — {r.de}</div>
          <div><span className={styles.linha} />Conferente na chegada — {r.para}</div>
        </div>
      </div>
      </ParaImprimir>
    </div>
  )
}
