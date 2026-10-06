import { Fragment } from 'react'
import bwipjs from 'bwip-js/node'
import {
  formatarCnpj, formatarDocumento, formatarChave, reais, dataHora, type CupomNfce,
} from '@/lib/fiscal/cupom'
import BotaoImprimir from './BotaoImprimir'
import styles from './cupom.module.css'

/**
 * O papel do cupom, a partir dos dados do XML autorizado (`lerXmlNfce`).
 *
 * Segue a ordem do DANFE NFC-e: emitente, título, itens, totais, pagamentos,
 * tributos, consulta pela chave, consumidor, número/protocolo, QR Code. Sem o
 * código da peça e sem custo (custo nunca está no XML).
 */
export default function CupomNfceView({ c }: { c: CupomNfce }) {
  const qrSvg = c.qrCode
    ? bwipjs.toSVG({ bcid: 'qrcode', text: c.qrCode, scale: 2 })
    : null
  const qtdItens = c.itens.reduce((s, i) => s + i.quantidade, 0)

  return (
    <main className={styles.pagina}>
      <BotaoImprimir />

      <article className={styles.cupom}>
        <header className={styles.centro}>
          <strong className={styles.nome}>{c.emitente.nomeFantasia || c.emitente.razaoSocial}</strong>
          {c.emitente.nomeFantasia && <div>{c.emitente.razaoSocial}</div>}
          <div>CNPJ {formatarCnpj(c.emitente.cnpj)}{c.emitente.ie && <> · IE {c.emitente.ie}</>}</div>
          <div>{c.emitente.endereco}</div>
        </header>

        <div className={styles.titulo}>
          DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
        </div>

        {c.homologacao && (
          <div className={styles.homologacao}>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</div>
        )}

        <table className={styles.itens}>
          <thead>
            <tr><th className={styles.desc}>Descrição</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr>
          </thead>
          <tbody>
            {c.itens.map((i, n) => (
              <tr key={n}>
                <td className={styles.desc}>{i.descricao}</td>
                <td>{i.quantidade.toLocaleString('pt-BR')} {i.unidade}</td>
                <td>{reais(i.valorUnitario)}</td>
                <td>{reais(i.valorTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className={styles.totais}>
          <dt>Qtde. total de itens</dt><dd>{qtdItens.toLocaleString('pt-BR')}</dd>
          <dt>Valor total R$</dt><dd>{reais(c.totalProdutos)}</dd>
          {c.desconto > 0 && <><dt>Desconto R$</dt><dd>-{reais(c.desconto)}</dd></>}
          <dt className={styles.forte}>Valor a pagar R$</dt><dd className={styles.forte}>{reais(c.totalNota)}</dd>
        </dl>

        <dl className={styles.totais}>
          <dt className={styles.cab}>FORMA DE PAGAMENTO</dt><dd className={styles.cab}>VALOR PAGO R$</dd>
          {c.pagamentos.map((p, n) => (
            <Fragment key={n}><dt>{p.forma}</dt><dd>{reais(p.valor)}</dd></Fragment>
          ))}
          {c.troco > 0 && <><dt>Troco R$</dt><dd>{reais(c.troco)}</dd></>}
        </dl>

        {c.tributos !== null && (
          <div className={styles.centro}>Tributos totais incidentes (Lei 12.741/2012) R$ {reais(c.tributos)}</div>
        )}

        <section className={styles.centro}>
          {c.urlConsulta && <div>Consulte pela Chave de Acesso em<br />{c.urlConsulta}</div>}
          <div className={styles.chave}>{formatarChave(c.chave)}</div>
        </section>

        <section className={styles.centro}>
          {c.consumidor
            ? <div>CONSUMIDOR {c.consumidor.documento.length === 11 ? 'CPF' : 'CNPJ'} {formatarDocumento(c.consumidor.documento)}{c.consumidor.nome && <> - {c.consumidor.nome}</>}</div>
            : <div>CONSUMIDOR NÃO IDENTIFICADO</div>}
        </section>

        <section className={styles.centro}>
          <div><strong>NFC-e nº {c.numero} Série {c.serie}</strong> {dataHora(c.emitidaEm)}</div>
          {c.protocolo && <div>Protocolo de autorização: {c.protocolo}</div>}
          {c.autorizadaEm && <div>Data de autorização: {dataHora(c.autorizadaEm)}</div>}
        </section>

        {qrSvg && (
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qrSvg }} />
        )}

        {c.homologacao && (
          <div className={styles.homologacao}>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</div>
        )}

        {c.informacoes && <div className={styles.centro}>{c.informacoes}</div>}
      </article>
    </main>
  )
}
