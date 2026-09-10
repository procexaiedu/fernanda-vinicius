'use client'

import { useState } from 'react'
import { Plus, Trash2, AlertTriangle, Check } from 'lucide-react'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import {
  listarConsertos, registrarConserto, mudarStatus, removerConserto,
  type Conserto, type StatusConserto,
} from './actions'
import { formatarDinheiro } from '@/lib/dinheiro'
import styles from './Consertos.module.css'
import DatePicker from '@/components/ui/DatePicker'

interface Cliente { id: string; name: string; phone: string | null }

/**
 * O caminho da peça, na ordem em que ela anda.
 *
 * Mora aqui e não no arquivo de ações porque `'use server'` só exporta função
 * assíncrona — e faz sentido: é vocabulário de tela, não regra de servidor.
 * `acao` é o que o botão diz; `rotulo` é onde a peça está agora.
 */
const FLUXO: { valor: StatusConserto; rotulo: string; acao: string }[] = [
  { valor: 'recebido',   rotulo: 'Na loja',    acao: 'Recebi a peça' },
  { valor: 'no_ourives', rotulo: 'No ourives', acao: 'Mandei pro ourives' },
  { valor: 'pronto',     rotulo: 'Pronta',     acao: 'Voltou pronta' },
  { valor: 'entregue',   rotulo: 'Entregue',   acao: 'Cliente levou' },
]

function hoje() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtData(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** O próximo passo do fluxo — é o único botão que a linha precisa mostrar. */
function proximo(status: StatusConserto): { valor: StatusConserto; acao: string } | null {
  const i = FLUXO.findIndex(f => f.valor === status)
  const seguinte = FLUXO[i + 1]
  return seguinte ? { valor: seguinte.valor, acao: seguinte.acao } : null
}

/**
 * A lista do que está na loja.
 *
 * Mostra só o que está aberto por padrão: peça entregue já cumpriu seu papel e
 * só atrapalha quem procura onde está a peça da fulana. O histórico fica a um
 * clique.
 *
 * Cada linha tem UM botão — o próximo passo do fluxo. Um seletor com quatro
 * estados obrigaria a pensar; "Mandei pro ourives" não obriga.
 */
export default function ConsertosClient({ inicial, clientes, podeApagar }: {
  inicial: Conserto[]
  clientes: Cliente[]
  podeApagar: boolean
}) {
  const [lista, setLista] = useState(inicial)
  const [verEntregues, setVerEntregues] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const [aberto, setAberto] = useState(false)
  const [cliente, setCliente] = useState('')
  const [peca, setPeca] = useState('')
  const [servico, setServico] = useState('')
  const [prazo, setPrazo] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function recarregar() {
    setLista(await listarConsertos())
  }

  async function salvar() {
    setErro(null)
    setSalvando(true)
    /* try/finally: sem ele um erro deixaria o botão girando para sempre. */
    try {
      const r = await registrarConserto({
        customerId: cliente,
        peca,
        servico,
        prometidoPara: prazo || null,
        notes: obs,
      })
      if (!r.success) { setErro(r.error ?? 'Não foi possível registrar.'); return }
      setAberto(false); setCliente(''); setPeca(''); setServico(''); setPrazo(''); setObs('')
      await recarregar()
    } catch {
      setErro('Não foi possível registrar o conserto.')
    } finally {
      setSalvando(false)
    }
  }

  async function avancar(c: Conserto) {
    const passo = proximo(c.status)
    if (!passo) return
    setErro(null)
    setOcupado(c.id)
    try {
      const r = await mudarStatus(c.id, passo.valor)
      if (!r.success) { setErro(r.error ?? 'Não foi possível atualizar.'); return }
      await recarregar()
    } finally {
      setOcupado(null)
    }
  }

  async function apagar(id: string) {
    setErro(null)
    const r = await removerConserto(id)
    if (!r.success) { setErro(r.error ?? 'Não foi possível remover.'); return }
    await recarregar()
  }

  /*
   * A tela separa; o servidor traz tudo. Assim ela pode dizer quantos entregues
   * existem em vez de sumir com eles em silêncio — que foi como um conserto
   * cobrado no PDV parecia ter se perdido: nasce entregue e desaparecia no
   * mesmo instante em que era criado.
   */
  const abertos   = lista.filter(c => c.status !== 'entregue')
  const entregues = lista.filter(c => c.status === 'entregue')
  const visiveis  = verEntregues ? lista : abertos

  const atrasados = abertos.filter(c => c.prometidoPara && c.prometidoPara < hoje()).length

  return (
    <div className={styles.tela}>

      <div className={styles.topo}>
        <div className={styles.resumo}>
          <strong>{abertos.length}</strong> na loja ou com o ourives
          {atrasados > 0 && (
            <span className={styles.atrasoAviso}>
              <AlertTriangle size={12} /> {atrasados} passou do prazo
            </span>
          )}
        </div>

        <div className={styles.acoesTopo}>
          {entregues.length > 0 && (
            <button className={styles.link} onClick={() => setVerEntregues(v => !v)}>
              {verEntregues ? 'Esconder entregues' : `Ver ${entregues.length} entregue${entregues.length > 1 ? 's' : ''}`}
            </button>
          )}
          {!aberto && (
            <Button size="sm" onClick={() => setAberto(true)}>
              <Plus size={13} /> Receber peça
            </Button>
          )}
        </div>
      </div>

      {erro && <div className={styles.erro}>{erro}</div>}

      {aberto && (
        <div className={styles.form}>
          <div className={styles.formLinha}>
            <label className={styles.campo}>
              <span className={styles.rotulo}>Cliente</span>
              <SearchableSelect
                value={cliente}
                onChange={setCliente}
                options={clientes.map(c => ({ value: c.id, label: c.name }))}
                placeholder="De quem é a peça?"
                permitirLimpar={false}
              />
            </label>
            <label className={styles.campo}>
              <span className={styles.rotulo}>Peça</span>
              <input
                className={styles.input}
                placeholder="Ex: anel de ouro"
                value={peca}
                onChange={e => setPeca(e.target.value)}
              />
            </label>
            <label className={styles.campo}>
              <span className={styles.rotulo}>Serviço</span>
              <input
                className={styles.input}
                placeholder="Ex: solda, aumentar aro"
                value={servico}
                onChange={e => setServico(e.target.value)}
              />
            </label>
            <label className={styles.campo}>
              <span className={styles.rotulo}>Prometido para</span>
              {/* O mesmo seletor das outras telas: o nativo abre em inglês no
                  Windows e não segue o tema escuro. */}
              <DatePicker value={prazo} onChange={setPrazo} />
            </label>
          </div>
          <label className={styles.campo}>
            <span className={styles.rotulo}>Observação</span>
            <input
              className={styles.input}
              placeholder="Opcional"
              value={obs}
              onChange={e => setObs(e.target.value)}
            />
          </label>
          <div className={styles.formAcoes}>
            <Button size="sm" variant="ghost" onClick={() => { setAberto(false); setErro(null) }}>Cancelar</Button>
            <Button size="sm" onClick={salvar} loading={salvando}>Registrar</Button>
          </div>
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className={styles.vazio}>
          {/*
            A mensagem não pode mentir. Havendo entregues escondidos, dizer
            "nenhuma peça em conserto" faz parecer que o registro se perdeu —
            e é exatamente o que acontecia com o conserto cobrado no PDV.
          */}
          {entregues.length > 0
            ? <>Nenhuma peça aguardando. <button className={styles.link} onClick={() => setVerEntregues(true)}>
                Ver {entregues.length} já entregue{entregues.length > 1 ? 's' : ''}
              </button></>
            : 'Nenhuma peça em conserto. Use "Receber peça" quando a cliente trouxer uma.'}
        </div>
      ) : (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Peça</th>
              <th>Serviço</th>
              <th className="col-date">Recebida</th>
              <th className="col-date">Prometida</th>
              <th>Onde está</th>
              <th>Pagamento</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map(c => {
              const passo = proximo(c.status)
              const atrasado = !!c.prometidoPara && c.prometidoPara < hoje() && c.status !== 'entregue'
              return (
                <tr key={c.id} className={atrasado ? styles.linhaAtrasada : ''}>
                  <td className={styles.forte}>{c.cliente}</td>
                  <td>{c.peca}</td>
                  <td className={styles.suave}>{c.servico ?? '—'}</td>
                  <td className="col-date">{fmtData(c.recebidoEm)}</td>
                  <td className="col-date">
                    {c.prometidoPara
                      ? <span className={atrasado ? styles.atrasado : ''}>
                          {atrasado && <AlertTriangle size={11} />} {fmtData(c.prometidoPara)}
                        </span>
                      : <span className={styles.suave}>—</span>}
                  </td>
                  <td>
                    <span className={`${styles.selo} ${styles['selo_' + c.status]}`}>
                      {FLUXO.find(f => f.valor === c.status)?.rotulo}
                    </span>
                  </td>
                  {/*
                    Pago ou não é o que ela precisa ver de relance: se a cliente
                    já passou pelo caixa ou se ainda vai passar. O valor vem
                    junto quando existe, porque é a prova de que passou.
                  */}
                  <td>
                    {c.pago
                      ? <span className={`${styles.selo} ${styles.selo_pago}`}>
                          Pago{c.valorCobrado != null ? ` · ${formatarDinheiro(c.valorCobrado)}` : ''}
                        </span>
                      : <span className={`${styles.selo} ${styles.selo_aCobrar}`}>A cobrar</span>}
                  </td>
                  <td className={styles.acoes}>
                    {passo && (
                      <button
                        className={styles.avancar}
                        onClick={() => avancar(c)}
                        disabled={ocupado === c.id}
                      >
                        {ocupado === c.id ? '…' : <><Check size={12} /> {passo.acao}</>}
                      </button>
                    )}
                    {podeApagar && (
                      <button
                        className={styles.remover}
                        onClick={() => apagar(c.id)}
                        title="Remover este registro"
                        aria-label="Remover"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
