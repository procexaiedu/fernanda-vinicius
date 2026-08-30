'use client'

import { Printer } from 'lucide-react'
import Button from '@/components/ui/Button'
import { formatarDinheiro } from '@/lib/dinheiro'
import type { Romaneio as RomaneioT } from './page'
import styles from './Romaneio.module.css'

/**
 * O romaneio impresso — o papel que vai dentro da caixa.
 *
 * Sai por `window.print()` e CSS `@media print`, não pelo agente de impressão
 * local: aquele fala PPLA com a impressora térmica de etiqueta. Isto é folha A4
 * na impressora comum.
 *
 * Os números vêm de `totals`, congelado no envio, e o nome/custo de cada peça
 * vem da linha do item, não de um join com `products`. É o que garante que o
 * papel dentro da caixa e a tela de quem confere digam a mesma coisa mesmo que
 * a peça seja renomeada ou reprecificada no meio do caminho.
 */
export default function Romaneio({ r, onFechar }: { r: RomaneioT; onFechar: () => void }) {
  const enviados = r.itens.filter(i => i.quantity_sent > 0)
  const pecas = r.totals?.pecas ?? enviados.reduce((s, i) => s + i.quantity_sent, 0)
  const custo = r.totals?.custo_total ?? enviados.reduce((s, i) => s + i.unit_cost * i.quantity_sent, 0)
  const reetiquetar = enviados.filter(i => i.reetiquetar)

  return (
    <div className={styles.wrapper}>
      {/* Some na impressão: é controle de tela, não parte do documento. */}
      <div className={styles.acoes}>
        <Button size="sm" variant="ghost" onClick={onFechar}>Fechar</Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Imprimir romaneio
        </Button>
      </div>

      <div className={styles.folha} id="romaneio-impressao">
        <header className={styles.cabecalho}>
          <div>
            <h2 className={styles.titulo}>Romaneio de Transferência</h2>
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
          </div>
        </header>

        <div className={styles.resumo}>
          <div><span>Peças</span><strong>{pecas}</strong></div>
          <div><span>Itens</span><strong>{enviados.length}</strong></div>
          <div><span>Custo total</span><strong>{formatarDinheiro(custo)}</strong></div>
        </div>

        {reetiquetar.length > 0 && (
          <p className={styles.avisoEtiqueta}>
            <strong>{reetiquetar.length} peça{reetiquetar.length > 1 ? 's' : ''} precisa
            {reetiquetar.length > 1 ? 'm' : ''} de etiqueta nova na chegada.</strong> São envios
            parciais: no destino elas ganham um código de barras próprio, e sem reimprimir a
            etiqueta o leitor não acha a peça em {r.para}.
          </p>
        )}

        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>#</th>
              <th>Etiqueta</th>
              <th>Peça</th>
              <th>Código</th>
              <th className={styles.num}>Qtd.</th>
              <th className={styles.num}>Custo un.</th>
              <th className={styles.conferido}>Conferido</th>
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
                <td className={styles.codigo}>{i.product_code}</td>
                <td className={styles.num}>{i.quantity_sent}</td>
                <td className={styles.num}>{formatarDinheiro(i.unit_cost)}</td>
                {/* Quadradinho para a conferência no papel, quando o leitor não está à mão. */}
                <td className={styles.conferido}><span className={styles.quadrado} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        {r.notes && <p className={styles.observacao}><strong>Observação:</strong> {r.notes}</p>}

        <div className={styles.assinaturas}>
          <div><span className={styles.linha} />Conferente na saída — {r.de}</div>
          <div><span className={styles.linha} />Conferente na chegada — {r.para}</div>
        </div>
      </div>
    </div>
  )
}
