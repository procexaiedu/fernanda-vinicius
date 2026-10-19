'use client'

import { useState } from 'react'
import { Plus, Trash2, AlertTriangle, Check, Phone, Clock } from 'lucide-react'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import {
  listarConsertos, registrarConserto, mudarStatus, removerConserto, marcarClienteAvisada,
  type Conserto, type StatusConserto,
} from './actions'
import { formatarDinheiro } from '@/lib/dinheiro'
import styles from './Consertos.module.css'
import DatePicker from '@/components/ui/DatePicker'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'
import { tempoMedioConserto } from '@/lib/consertoTempo'

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

/** Hoje menos N dias, em YYYY-MM-DD local. */
function diasAtras(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* A lista vem com 120 dias (actions.ts): o maior período não pode passar disso. */
const PERIODOS = [30, 90, 120] as const

function fmtDias(d: number | null) {
  if (d == null) return '—'
  const t = String(d).replace('.', ',')
  return `${t} dia${d === 1 ? '' : 's'}`
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
  /* Já vem com hoje: quase sempre a peça entra no dia em que é registrada. */
  const [entrada, setEntrada] = useState(hoje)
  const [prazo, setPrazo] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]>(30)

  /*
   * Recarregar falhando NÃO é o salvar falhando. Sem o try próprio, o erro
   * caía no catch de quem chamou e a tela dizia "não foi possível salvar"
   * sobre um conserto que JÁ estava gravado — e ela registrava de novo.
   */
  async function recarregar() {
    try {
      setLista(await listarConsertos())
    } catch {
      setErro('A alteração foi salva, mas a lista não atualizou. Aperte F5 para ver a lista certa.')
    }
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
        recebidoEm: entrada || null,
        prometidoPara: prazo || null,
        notes: obs,
      })
      if (!r.success) { setErro(r.error ?? 'Não foi possível registrar.'); return }
      setAberto(false); setCliente(''); setPeca(''); setServico(''); setEntrada(hoje()); setPrazo(''); setObs('')
      await recarregar()
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
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
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
    } finally {
      setOcupado(null)
    }
  }

  async function avisada(c: Conserto) {
    setErro(null)
    setOcupado(c.id)
    try {
      const r = await marcarClienteAvisada(c.id)
      if (!r.success) { setErro(r.error ?? 'Não foi possível salvar o aviso.'); return }
      await recarregar()
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
    } finally {
      setOcupado(null)
    }
  }

  async function apagar(id: string) {
    setErro(null)
    /* Sem o try, falha de rede ou sessão vencida rejeitava em silêncio: o
       clique não dava em nada e ela não sabia se tinha apagado. */
    let r: Awaited<ReturnType<typeof removerConserto>>
    try {
      r = await removerConserto(id)
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
      return
    }
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

  /* Peça que voltou pronta e ninguém ligou ainda: é o que não pode ser esquecido. */
  const aAvisar = lista.filter(c => c.status === 'pronto' && !c.clienteAvisadaEm)
  const tempo = tempoMedioConserto(lista, diasAtras(periodo))

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

      {/*
        Tempo médio: o que ela responde quando a cliente pergunta "fica pronto
        quando?". Calculado sobre a lista que já está na tela.
      */}
      <div className={styles.tempoMedio}>
        <Clock size={14} />
        <span>Tempo médio:</span>
        <span>até voltar pronta <strong>{fmtDias(tempo.ateProntos.dias)}</strong>
          {tempo.ateProntos.amostra > 0 && <span className={styles.suave}> ({tempo.ateProntos.amostra} peça{tempo.ateProntos.amostra > 1 ? 's' : ''})</span>}
        </span>
        <span>até a cliente levar <strong>{fmtDias(tempo.ateEntregue.dias)}</strong>
          {tempo.ateEntregue.amostra > 0 && <span className={styles.suave}> ({tempo.ateEntregue.amostra} peça{tempo.ateEntregue.amostra > 1 ? 's' : ''})</span>}
        </span>
        <span className={styles.periodos}>
          {PERIODOS.map(p => (
            <button
              key={p}
              className={`${styles.periodo} ${periodo === p ? styles.periodoAtivo : ''}`}
              onClick={() => setPeriodo(p)}
            >
              {p} dias
            </button>
          ))}
        </span>
      </div>

      {aAvisar.length > 0 && (
        <div className={styles.avisoPronta}>
          <div className={styles.avisoTitulo}>
            <Phone size={14} /> {aAvisar.length === 1 ? 'Uma peça voltou pronta' : `${aAvisar.length} peças voltaram prontas`}: ligar para a cliente
          </div>
          <ul className={styles.avisoLista}>
            {aAvisar.map(c => (
              <li key={c.id}>
                <span><strong>{c.cliente}</strong> · {c.peca}{c.clienteTelefone ? ` · ${c.clienteTelefone}` : ' · sem telefone'}</span>
                <button className={styles.avancar} onClick={() => avisada(c)} disabled={ocupado === c.id}>
                  {ocupado === c.id ? '…' : <><Check size={12} /> Avisei a cliente</>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
            <label className={styles.campo} data-novidade="conserto-entrada">
              <span className={styles.rotulo}>Entrada na loja</span>
              <DatePicker value={entrada} onChange={setEntrada} />
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
              <th className="col-date">Entrada</th>
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
                    {c.status === 'pronto' && (
                      c.clienteAvisadaEm
                        ? <span className={styles.suave}> · cliente avisada</span>
                        : <span className={styles.atrasado}> · avisar cliente</span>
                    )}
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
