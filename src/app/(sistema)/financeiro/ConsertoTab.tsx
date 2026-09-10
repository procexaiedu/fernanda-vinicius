'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, ChevronLeft, ChevronRight, Wrench } from 'lucide-react'
import Button from '@/components/ui/Button'
import {
  buscarBalancoConserto, buscarConsertosDoMes, declararGastoOurives, removerGastoOurives,
  type BalancoConserto, type ConsertoCobrado,
} from './conserto'
import DetalheListaModal from '@/components/dashboard/DetalheListaModal'
import { formatarDinheiro } from '@/lib/dinheiro'
import styles from './ConsertoTab.module.css'

/**
 * O balanço do conserto, mês a mês.
 *
 * O conserto entra venda a venda, no PDV; o pagamento ao Ourives sai de uma vez
 * só, no fim do mês. Esta tela junta os dois.
 *
 * OS DOIS LADOS QUASE NUNCA CAEM NO MESMO MÊS — "nunca entra no mesmo mês
 * porque a gente avisa o cliente que está lá, às vezes ela demora para buscar".
 * Por isso o acumulado aparece ao lado do mês: um mês fechado torto não é erro,
 * é peça que ainda não foi buscada. Sem o acumulado, ela olharia um mês
 * negativo e acharia que perdeu dinheiro.
 */

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function mesAtual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function hoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtData(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export default function ConsertoTab() {
  const [mes, setMes] = useState(mesAtual())
  const [dados, setDados] = useState<BalancoConserto | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [aberto, setAberto] = useState(false)
  const [data, setData] = useState(hoje())
  const [valor, setValor] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  /* O detalhe do que foi cobrado. Existe porque o saldo sozinho não responde à
   * pergunta que ela faz olhando para ele: "cobrei isso tudo de conserto
   * mesmo?" — e é conferindo atendimento por atendimento que uma cobrança
   * esquecida ou digitada errada aparece. */
  const [detalhe, setDetalhe] = useState<ConsertoCobrado[] | null>(null)
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false)

  async function abrirDetalhe() {
    setCarregandoDetalhe(true)
    setDetalhe([])
    setDetalhe(await buscarConsertosDoMes(mes))
    setCarregandoDetalhe(false)
  }

  const carregar = useCallback(async () => {
    setCarregando(true)
    setDados(await buscarBalancoConserto(mes))
    setCarregando(false)
  }, [mes])

  useEffect(() => { carregar() }, [carregar])

  async function salvar() {
    setErro(null)
    setSalvando(true)
    /* try/finally: sem ele um erro deixaria o botão girando para sempre. */
    try {
      const r = await declararGastoOurives({
        data,
        valor: parseFloat(valor.replace(',', '.')) || 0,
        observacao: obs,
      })
      if (!r.success) { setErro(r.error ?? 'Não foi possível lançar.'); return }
      setAberto(false); setValor(''); setObs('')
      await carregar()
    } catch {
      setErro('Não foi possível lançar o pagamento.')
    } finally {
      setSalvando(false)
    }
  }

  async function remover(id: string) {
    setErro(null)
    const r = await removerGastoOurives(id)
    if (!r.success) { setErro(r.error ?? 'Não foi possível remover.'); return }
    await carregar()
  }

  function mudarMes(passo: number) {
    const [a, m] = mes.split('-').map(Number)
    const d = new Date(a, m - 1 + passo, 1)
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [ano, mNum] = mes.split('-').map(Number)
  const ehMesAtual = mes === mesAtual()

  return (
    <div className={styles.aba}>

      <div className={styles.topo}>
        <div className={styles.mesNav}>
          <button className={styles.mesBtn} onClick={() => mudarMes(-1)} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </button>
          <span className={styles.mesLabel}>{MESES[mNum - 1]} {ano}</span>
          <button className={styles.mesBtn} onClick={() => mudarMes(1)} disabled={ehMesAtual} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </button>
        </div>

        {!aberto && (
          <Button size="sm" onClick={() => setAberto(true)}>
            <Plus size={13} /> Declarar pagamento ao Ourives
          </Button>
        )}
      </div>

      {carregando && <div className={styles.vazio}>Carregando…</div>}

      {!carregando && dados && (
        <>
          <div className={styles.placar}>
            <button type="button" className={`${styles.item} ${styles.itemClicavel}`} onClick={abrirDetalhe}>
              <span className={styles.rotulo}>Cobrado das clientes</span>
              <strong className={`${styles.valor} ${styles.pos}`}>{formatarDinheiro(dados.receita)}</strong>
              <span className={styles.nota}>
                {dados.quantidade === 0
                  ? 'nenhum conserto no mês'
                  : `${dados.quantidade} ${dados.quantidade === 1 ? 'conserto' : 'consertos'} · ver detalhe`}
              </span>
            </button>

            <div className={styles.item}>
              <span className={styles.rotulo}>Pago ao Ourives</span>
              <strong className={styles.valor}>{formatarDinheiro(dados.pagoAoOurives)}</strong>
              <span className={styles.nota}>
                {dados.lancamentos.length === 0
                  ? 'nada declarado ainda'
                  : `${dados.lancamentos.length} ${dados.lancamentos.length === 1 ? 'pagamento' : 'pagamentos'}`}
              </span>
            </div>

            <button type="button" className={`${styles.item} ${styles.itemClicavel}`} onClick={abrirDetalhe}>
              <span className={styles.rotulo}>Saldo do mês</span>
              <strong className={`${styles.valor} ${dados.saldo < 0 ? styles.neg : styles.pos}`}>
                {formatarDinheiro(dados.saldo)}
              </strong>
              <span className={styles.nota}>
                {dados.saldo < 0 ? 'pagou mais do que cobrou' : 'sobrou do conserto'} · ver detalhe
              </span>
            </button>
          </div>

          {/*
            O acumulado existe porque os dois lados não caem no mesmo mês. Sem
            ele, um mês negativo pareceria prejuízo — quando é só a cliente que
            ainda não voltou para buscar a peça.
          */}
          <div className={styles.acumulado}>
            <Wrench size={13} />
            <span>
              Desde o início: <strong>{formatarDinheiro(dados.acumulado.receita)}</strong> cobrado
              {' · '}<strong>{formatarDinheiro(dados.acumulado.pagoAoOurives)}</strong> pago
              {' · saldo '}
              <strong className={dados.acumulado.saldo < 0 ? styles.neg : styles.pos}>
                {formatarDinheiro(dados.acumulado.saldo)}
              </strong>
            </span>
          </div>

          {erro && <div className={styles.erro}>{erro}</div>}

          {aberto && (
            <div className={styles.form}>
              <div className={styles.formLinha}>
                <label className={styles.campo}>
                  <span className={styles.campoRotulo}>Data do pagamento</span>
                  <input type="date" className={styles.input} value={data} onChange={e => setData(e.target.value)} />
                </label>
                <label className={styles.campo}>
                  <span className={styles.campoRotulo}>Valor pago</span>
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={valor}
                    onChange={e => setValor(e.target.value)}
                  />
                </label>
                <label className={styles.campo}>
                  <span className={styles.campoRotulo}>Observação</span>
                  <input
                    className={styles.input}
                    placeholder="Opcional — ex: fechamento de agosto"
                    value={obs}
                    onChange={e => setObs(e.target.value)}
                  />
                </label>
              </div>
              <div className={styles.formAcoes}>
                <Button size="sm" variant="ghost" onClick={() => { setAberto(false); setErro(null) }}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={salvar} loading={salvando}>Lançar pagamento</Button>
              </div>
            </div>
          )}

          <h3 className={styles.secaoTitulo}>Pagamentos declarados no mês</h3>

          {dados.lancamentos.length === 0 ? (
            <div className={styles.vazio}>
              Nada declarado neste mês. O Ourives costuma fechar o mês de uma vez.
            </div>
          ) : (
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th className="col-date">Data</th>
                  <th>Observação</th>
                  <th className="col-num">Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dados.lancamentos.map(l => (
                  <tr key={l.id}>
                    <td className="col-date">{fmtData(l.data)}</td>
                    <td className={styles.obs}>{l.observacao ?? '—'}</td>
                    <td className={`col-num ${styles.valorLinha}`}>{formatarDinheiro(l.valor)}</td>
                    <td>
                      <button
                        className={styles.remover}
                        onClick={() => remover(l.id)}
                        title="Remover este lançamento"
                        aria-label="Remover"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {detalhe !== null && dados && (
        <DetalheListaModal<ConsertoCobrado>
          titulo="Conserto — de onde vem a diferença"
          subtitulo={`${MESES[mNum - 1]} ${ano} · cada conserto cobrado no mês`}
          linhas={detalhe}
          chave={c => c.id}
          carregando={carregandoDetalhe}
          rotuloItem="conserto"
          rotuloItemPlural="consertos"
          vazio="Nenhum conserto cobrado neste mês."
          /* A conta decomposta: é ela que responde "por que o saldo é esse". */
          resumo={[
            { rotulo: 'Cobrado das clientes', valor: formatarDinheiro(dados.receita), tom: 'pos' },
            { rotulo: 'Pago ao Ourives', valor: formatarDinheiro(dados.pagoAoOurives), tom: 'neg' },
            {
              rotulo: dados.saldo < 0 ? 'Saldo — pagou mais do que cobrou' : 'Saldo do mês',
              valor: formatarDinheiro(dados.saldo),
              total: true,
              tom: dados.saldo < 0 ? 'neg' : 'pos',
            },
          ]}
          colunas={[
            { chave: 'data', rotulo: 'Data', valor: c => fmtData(c.data), busca: c => fmtData(c.data) },
            { chave: 'cliente', rotulo: 'Cliente', forte: true, valor: c => c.cliente, busca: c => c.cliente },
            { chave: 'vend', rotulo: 'Vendedora', secundaria: true, valor: c => c.vendedora, busca: c => c.vendedora },
            { chave: 'valor', rotulo: 'Cobrado', alinhamento: 'dir', forte: true, valor: c => formatarDinheiro(c.valor) },
          ]}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  )
}
