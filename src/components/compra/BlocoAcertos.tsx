'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, CheckCircle, AlertTriangle } from 'lucide-react'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import {
  buscarConsignacao, registrarAcerto, removerAcerto,
  type ConsignacaoDetalhe,
} from '@/app/(sistema)/compras/acertos'
import { formatarDinheiro } from '@/lib/dinheiro'
import styles from './BlocoAcertos.module.css'
import DatePicker from '@/components/ui/DatePicker'

/**
 * Os acertos do lote consignado, dentro do detalhe da compra.
 *
 * Mora AQUI e não numa tela própria porque consignação é uma compra — a lista
 * mostra uma linha só. Quando o acerto vivia num modal separado, ele ficou
 * inalcançável no dia em que o lote passou a criar a compra: a linha da
 * consignação saiu da lista e levou o único caminho até ele junto.
 *
 * O acerto é PARCIAL e se repete — ela vende algumas peças, paga aquelas, e
 * assim por diante até fechar. Por isso os três números que importam na
 * conversa com o fornecedor (total, já pago, falta) e o histórico com data.
 */

const FORMAS = [
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'check', label: 'Cheque' },
]

const ROTULO: Record<string, string> = Object.fromEntries(FORMAS.map(f => [f.value, f.label]))

function hoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtData(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export default function BlocoAcertos({ id, onMudou }: {
  id: string
  onMudou?: () => void
}) {
  const [lote, setLote] = useState<ConsignacaoDetalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [aberto, setAberto] = useState(false)
  const [data, setData] = useState(hoje())
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState('pix')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setLote(await buscarConsignacao(id))
    setCarregando(false)
  }, [id])

  useEffect(() => { carregar() }, [carregar])

  async function salvar() {
    setErro(null)
    setSalvando(true)
    /* try/finally pelo mesmo motivo do salvar da compra: sem ele, um erro
     * deixaria o botão girando para sempre e sem mensagem. */
    try {
      const r = await registrarAcerto({
        consignmentId: id,
        data,
        valor: parseFloat(valor.replace(',', '.')) || 0,
        formaPagamento: forma,
        observacao: obs,
      })
      if (!r.success) { setErro(r.error ?? 'Não foi possível registrar.'); return }
      setAberto(false); setValor(''); setObs('')
      await carregar()
      onMudou?.()
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não foi possível registrar o acerto.')
    } finally {
      setSalvando(false)
    }
  }

  async function remover(acertoId: string) {
    setErro(null)
    const r = await removerAcerto(acertoId)
    if (!r.success) { setErro(r.error ?? 'Não foi possível remover.'); return }
    await carregar()
    onMudou?.()
  }

  if (carregando) return <div className={styles.vazio}>Carregando acertos…</div>
  if (!lote) return null

  const quitado = lote.falta <= 0.01
  const atrasado = !!lote.return_deadline && lote.return_deadline < hoje() && lote.status === 'active'

  return (
    <div className={styles.bloco}>

      <div className={styles.secaoTopo}>
        <h3 className={styles.secaoTitulo}>Acerto com o fornecedor</h3>
        {!quitado && !aberto && (
          <Button size="sm" onClick={() => setAberto(true)}>
            <Plus size={13} /> Registrar acerto
          </Button>
        )}
      </div>

      {/* Os três números da conversa com o fornecedor. */}
      <div className={styles.placar}>
        <div className={styles.placarItem}>
          <span className={styles.placarRotulo}>Total do lote</span>
          <strong className={styles.placarValor}>{formatarDinheiro(lote.total)}</strong>
          <span className={styles.placarNota}>{lote.total_pieces} peças</span>
        </div>
        <div className={styles.placarItem}>
          <span className={styles.placarRotulo}>Já acertado</span>
          <strong className={`${styles.placarValor} ${styles.pos}`}>{formatarDinheiro(lote.acertado)}</strong>
          <span className={styles.placarNota}>
            {lote.acertos.length === 0
              ? 'nenhum pagamento ainda'
              : `${lote.acertos.length} ${lote.acertos.length === 1 ? 'pagamento' : 'pagamentos'}`}
          </span>
        </div>
        <div className={styles.placarItem}>
          <span className={styles.placarRotulo}>Falta</span>
          <strong className={`${styles.placarValor} ${quitado ? styles.pos : styles.neg}`}>
            {formatarDinheiro(Math.max(0, lote.falta))}
          </strong>
          <span className={styles.placarNota}>
            {quitado ? 'lote quitado' : 'a pagar ao fornecedor'}
          </span>
        </div>
      </div>

      {/* Em zero a barra vazia virava um bloco cinza atravessado, lido como
          divisor quebrado. Só aparece quando há o que mostrar. */}
      {lote.acertado > 0 && (
        <div className={styles.barra}>
          <div
            className={styles.barraCheia}
            style={{ width: `${Math.min(100, (lote.acertado / (lote.total || 1)) * 100)}%` }}
          />
        </div>
      )}

      {atrasado && (
        <div className={styles.aviso}>
          <AlertTriangle size={13} />
          Prazo de devolução venceu em {fmtData(lote.return_deadline!)} e o lote ainda não fechou.
        </div>
      )}

      {quitado && lote.status === 'settled' && (
        <div className={styles.avisoOk}>
          <CheckCircle size={13} /> Lote acertado por completo.
        </div>
      )}

      {erro && <div className={styles.erro}>{erro}</div>}

      {aberto && (
        <div className={styles.form}>
          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span className={styles.rotulo}>Data</span>
              <DatePicker value={data} onChange={setData} />
            </label>
            <label className={styles.campo}>
              <span className={styles.rotulo}>Valor</span>
              <input
                className={styles.input}
                inputMode="decimal"
                placeholder={`até ${formatarDinheiro(lote.falta)}`}
                value={valor}
                onChange={e => setValor(e.target.value)}
              />
            </label>
            <label className={styles.campo}>
              <span className={styles.rotulo}>Forma</span>
              <SearchableSelect
                value={forma}
                onChange={setForma}
                options={FORMAS}
                placeholder="Forma"
                searchable={false}
                permitirLimpar={false}
              />
            </label>
          </div>
          <label className={styles.campo}>
            <span className={styles.rotulo}>Observação</span>
            <input
              className={styles.input}
              placeholder="Opcional — ex: referente às 4 peças vendidas"
              value={obs}
              onChange={e => setObs(e.target.value)}
            />
          </label>
          <div className={styles.formAcoes}>
            <Button size="sm" variant="ghost" onClick={() => { setAberto(false); setErro(null) }}>
              Cancelar
            </Button>
            <Button size="sm" onClick={salvar} loading={salvando}>Salvar acerto</Button>
          </div>
        </div>
      )}

      {lote.acertos.length === 0 && !aberto && (
        <div className={styles.vazio}>
          Nenhum acerto ainda. As peças são do fornecedor até serem pagas.
        </div>
      )}

      {lote.acertos.length > 0 && (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th className="col-date">Data</th>
              <th>Forma</th>
              <th>Observação</th>
              <th className="col-num">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lote.acertos.map(a => (
              <tr key={a.id}>
                <td className="col-date">{fmtData(a.acerto_date)}</td>
                <td>{a.payment_method ? (ROTULO[a.payment_method] ?? a.payment_method) : '—'}</td>
                <td className={styles.obs}>{a.notes ?? '—'}</td>
                <td className={`col-num ${styles.valor}`}>{formatarDinheiro(a.amount)}</td>
                <td>
                  <button
                    className={styles.remover}
                    onClick={() => remover(a.id)}
                    title="Remover este acerto e a despesa que ele lançou"
                    aria-label="Remover acerto"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
