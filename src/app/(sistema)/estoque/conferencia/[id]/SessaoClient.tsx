'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine, Check, RotateCcw, AlertTriangle, Gem, Undo2, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import {
  registrarBipe, desfazerUltimoBipe, carregarReconciliacao,
  fecharConferencia, cancelarConferencia, reabrirConferencia,
  type Reconciliacao, type LinhaReconciliacao, type AjusteConferencia,
} from '../actions'
import type { BipeRegistrado } from './page'
/* Dinheiro: um formatador só para o sistema — ver src/lib/dinheiro.ts */
import { formatarDinheiro as fmt } from '@/lib/dinheiro'
import styles from './SessaoClient.module.css'

interface SessaoInfo {
  id: string
  scope_type: 'categoria' | 'loja'
  scope_value: string | null
  status: 'contando' | 'fechada' | 'cancelada'
  started_at: string
  closed_at: string | null
  totals: Record<string, number> | null
  em_escopo: number
  loja: string
  quem: string
}

interface Props {
  sessao: SessaoInfo
  bipesIniciais: BipeRegistrado[]
  totalBipesInicial: number
}

/** Leitura dupla do Elgin chega em milissegundos; peça de verdade, não. */
const MS_LEITURA_DUPLA = 1500

const MOTIVOS: { valor: string; rotulo: string }[] = [
  /* Primeira contagem de uma base que nunca foi conferida: a divergência não é
     perda nem erro, é o estoque nunca ter sido medido. Sem esta opção, 752
     peças entrariam no histórico como "erro de cadastro" e a série ficaria
     mentindo já no primeiro ponto. */
  { valor: 'carga_inicial',         rotulo: 'Primeira contagem (carga inicial)' },
  { valor: 'furto_perda',           rotulo: 'Furto ou perda' },
  { valor: 'venda_nao_lancada',     rotulo: 'Venda não lançada' },
  { valor: 'estava_em_outro_lugar', rotulo: 'Estava em outro lugar' },
  { valor: 'erro_de_cadastro',      rotulo: 'Erro de cadastro' },
]

function hhmmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const seg = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}`
    : `${m}:${String(seg).padStart(2, '0')}`
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function SessaoClient({ sessao, bipesIniciais, totalBipesInicial }: Props) {
  const router = useRouter()
  const escopoNome = sessao.scope_type === 'loja' ? 'Loja inteira' : (sessao.scope_value ?? '')

  const [fase, setFase] = useState<'contando' | 'reconciliando' | 'fechada'>(
    sessao.status === 'contando' ? 'contando' : 'fechada'
  )
  const [bipes, setBipes] = useState<BipeRegistrado[]>(bipesIniciais)
  const [total, setTotal] = useState(totalBipesInicial)
  const [ultimo, setUltimo] = useState<{
    nome: string; code: string; repetido: boolean; achado: boolean
    preco: number; promo: boolean
  } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  const ultimoCodigo = useRef<{ codigo: string; ts: number } | null>(null)

  // Relógio da sessão. É o único número que a tela mostra além da contagem crua.
  useEffect(() => {
    if (fase !== 'contando') return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [fase])

  const aoBipar = useCallback(async (codigo: string) => {
    if (fase !== 'contando') return

    // Leitura dupla do leitor: mesmo código em menos de 1,5s não é peça nova.
    const anterior = ultimoCodigo.current
    if (anterior && anterior.codigo === codigo && Date.now() - anterior.ts < MS_LEITURA_DUPLA) return
    ultimoCodigo.current = { codigo, ts: Date.now() }

    setErro(null)
    setOcupado(true)
    const res = await registrarBipe(sessao.id, codigo)
    setOcupado(false)

    if (!res.success) { setErro(res.error ?? 'Não deu para registrar o bipe.'); return }

    setUltimo({
      nome:     res.produto?.name ?? 'Não cadastrado',
      code:     res.produto?.code ?? codigo,
      repetido: !!res.repetido,
      achado:   !!res.produto,
      preco:    res.produto?.preco ?? 0,
      promo:    !!res.produto?.promo,
    })
    setTotal(t => t + 1)
    setBipes(b => [{
      id:             `tmp-${Date.now()}`,
      barcode_number: codigo,
      product_id:     res.produto?.id ?? null,
      scanned_at:     new Date().toISOString(),
      produto:        res.produto ? { name: res.produto.name, code: res.produto.code } : null,
    }, ...b].slice(0, 60))
  }, [fase, sessao.id])

  useBarcodeScanner({ onScan: aoBipar, ativo: fase === 'contando' })

  async function desfazer() {
    setOcupado(true)
    const res = await desfazerUltimoBipe(sessao.id)
    setOcupado(false)
    if (!res.success) { setErro(res.error ?? 'Nada para desfazer.'); return }
    setTotal(t => Math.max(0, t - 1))
    setBipes(b => b.slice(1))
    setUltimo(null)
    ultimoCodigo.current = null
  }

  // ── Reconciliação ─────────────────────────────────────────────────────────
  const [rec, setRec] = useState<Reconciliacao | null>(null)
  const [carregandoRec, setCarregandoRec] = useState(false)
  const [fechando, setFechando] = useState(false)

  /*
   * Motivo por BALDE, exceção por linha.
   *
   * A primeira versão pedia um motivo em cada linha. Numa conferência real de
   * loja inteira isso deu 752 faltas — 752 cliques antes de poder fechar, o que
   * na prática significa não fechar. E o motivo quase sempre é o mesmo para o
   * balde inteiro: numa recontagem de reconstrução, tudo que não foi bipado
   * saiu pelo mesmo caminho.
   *
   * A exceção continua existindo por linha, porque é ela que tem valor: a peça
   * que está na mão de uma cliente provando não pode virar falta.
   */
  const [motivoFalta, setMotivoFalta] = useState('')
  const [motivoSobra, setMotivoSobra] = useState('')
  const [excecoes, setExcecoes] = useState<Set<string>>(new Set())

  function alternarExcecao(id: string) {
    setExcecoes(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  async function encerrarEConferir() {
    setErro(null)
    setCarregandoRec(true)
    const res = await carregarReconciliacao(sessao.id)
    setCarregandoRec(false)
    if (!res.success || !res.dados) { setErro(res.error ?? 'Erro ao montar a conferência.'); return }

    setExcecoes(new Set())
    setRec(res.dados)
    setFase('reconciliando')
  }

  const paraAplicar = useMemo(() => {
    if (!rec) return { falta: [], sobra: [] }
    return {
      falta: rec.falta.filter(l => !excecoes.has(l.product_id)),
      sobra: rec.sobra.filter(l => !excecoes.has(l.product_id)),
    }
  }, [rec, excecoes])

  const totalAplicar = paraAplicar.falta.length + paraAplicar.sobra.length

  // Balde que vai aplicar alguma coisa precisa de motivo. Balde vazio, não.
  const motivosFaltando =
    (paraAplicar.falta.length > 0 && !motivoFalta ? 1 : 0) +
    (paraAplicar.sobra.length > 0 && !motivoSobra ? 1 : 0)

  async function aplicarEFechar() {
    if (!rec) return
    if (motivosFaltando) { setErro('Escolha o motivo de cada grupo que vai ser ajustado.'); return }
    setErro(null)
    setFechando(true)
    const lista: AjusteConferencia[] = [
      ...paraAplicar.falta.map(l => ({ product_id: l.product_id, new_quantity: l.contado, reason: motivoFalta })),
      ...paraAplicar.sobra.map(l => ({ product_id: l.product_id, new_quantity: l.contado, reason: motivoSobra })),
    ]
    const res = await fecharConferencia(sessao.id, lista, {
      bate:            rec.bate.length,
      falta:           rec.falta.length,
      sobra:           rec.sobra.length,
      nao_cadastrado:  rec.naoCadastrado.length,
      bipes:           total,
    })
    setFechando(false)
    if (!res.success) { setErro(res.error ?? 'Erro ao fechar.'); return }
    router.push('/estoque/conferencia')
    router.refresh()
  }

  async function reabrir() {
    setErro(null)
    setFechando(true)
    const res = await reabrirConferencia(sessao.id)
    setFechando(false)
    if (!res.success) { setErro(res.error ?? 'Não foi possível reabrir.'); return }
    router.refresh()
  }

  async function cancelar() {
    setFechando(true)
    await cancelarConferencia(sessao.id)
    setFechando(false)
    router.push('/estoque/conferencia')
    router.refresh()
  }

  // ── Sessão já fechada: só o resumo ────────────────────────────────────────
  if (fase === 'fechada') {
    const t = sessao.totals ?? {}
    return (
      <div className={styles.fechada}>
        <h1 className={styles.fechadaTitulo}>
          Conferência de <span className={styles.cap}>{escopoNome}</span>
        </h1>
        <p className={styles.fechadaMeta}>
          {sessao.loja} · {sessao.quem} · {new Date(sessao.started_at).toLocaleString('pt-BR')}
          {sessao.status === 'cancelada' && <> · <Badge variant="muted">Cancelada</Badge></>}
        </p>
        <div className={styles.baldes}>
          <Balde titulo="Bate"           valor={t.bate ?? 0} />
          <Balde titulo="Falta"          valor={t.falta ?? 0} tom="falta" />
          <Balde titulo="Sobra"          valor={t.sobra ?? 0} tom="sobra" />
          <Balde titulo="Sem cadastro"   valor={t.nao_cadastrado ?? 0} />
          <Balde titulo="Ajustes feitos" valor={t.ajustes_aplicados ?? 0} />
        </div>

        {/* Fechou sem aplicar nada e tem bipes gravados: a contagem não se
            perdeu, só a reconciliação falhou. Reabrir evita refazer o trabalho
            de chão de loja. */}
        {(t.ajustes_aplicados ?? 0) === 0 && totalBipesInicial > 0 && (
          <div className={styles.avisoReabrir}>
            <AlertTriangle size={16} />
            <span>
              Esta conferência fechou <strong>sem aplicar nenhum ajuste</strong>, mas tem{' '}
              <strong>{totalBipesInicial} bipes</strong> gravados. A contagem está intacta —
              dá para reabrir e reconciliar de novo, sem recontar nada.
            </span>
            <Button size="sm" loading={fechando} onClick={reabrir}>Reabrir</Button>
          </div>
        )}

        {erro && <div className={styles.erro}>{erro}</div>}
        <Button variant="ghost" onClick={() => router.push('/estoque/conferencia')}>Voltar</Button>
      </div>
    )
  }

  // ── Contagem ──────────────────────────────────────────────────────────────
  if (fase === 'contando') {
    return (
      <div className={styles.contagem}>
        <div className={styles.barra}>
          <span className={styles.pulso} aria-hidden />
          <span className={styles.barraEscopo}>Conferindo · <span className={styles.cap}>{escopoNome}</span></span>
          <span className={styles.barraTempo}>{hhmmss(agora - new Date(sessao.started_at).getTime())}</span>
          <Button size="sm" variant="ghost" onClick={() => router.push('/estoque/conferencia')}>
            Pausar
          </Button>
        </div>

        <div className={styles.palco}>
          {ultimo ? (
            <div className={`${styles.ultimo} ${!ultimo.achado ? styles.ultimoDesconhecido : ''}`}>
              <div className={styles.ultimoIcone}>
                {ultimo.achado ? <Gem size={30} /> : <AlertTriangle size={30} />}
              </div>
              <div>
                <div className={styles.ultimoNome}>{ultimo.nome}</div>
                <div className={styles.ultimoCode}>{ultimo.code}</div>
                {/* Para conferir contra o preço impresso no papel. Etiqueta feita
                    antes de uma mudança de preço mostra valor velho — e é o papel
                    que a cliente lê. A contagem é o único momento em que alguém
                    pega peça por peça na mão. */}
                {ultimo.achado && (
                  <div className={styles.ultimoPreco}>
                    {fmt(ultimo.preco)}
                    {ultimo.promo && <span className={styles.tagPromo}>promo</span>}
                  </div>
                )}
              </div>
              <div className={styles.ultimoTag}>
                {!ultimo.achado
                  ? <span className={styles.tagAlerta}><AlertTriangle size={13} /> não cadastrado</span>
                  : ultimo.repetido
                    ? <span className={styles.tagRepetido}><RotateCcw size={13} /> 2ª vez</span>
                    : <span className={styles.tagOk}><Check size={13} /> contado</span>}
              </div>
            </div>
          ) : (
            <div className={styles.aguardando}>
              <ScanLine size={26} />
              <span>Bipe a primeira peça</span>
            </div>
          )}

          {/*
            Contagem crua e nada mais. Sem "248 de 365", sem barra de progresso,
            sem a quantidade esperada: se a tela conta quanto era pra ter, a
            pessoa para no número certo e a divergência some.
          */}
          <div className={styles.contador}>
            <span className={styles.contadorValor}>{total}</span>
            <span className={styles.contadorRotulo}>peça{total !== 1 ? 's' : ''} bipada{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {erro && <div className={styles.erro}>{erro}</div>}

        <div className={styles.historicoBipes}>
          {bipes.slice(0, 12).map(b => (
            <div key={b.id} className={styles.linhaBipe}>
              <span className={styles.bipeHora}>{hora(b.scanned_at)}</span>
              <span className={styles.bipeCode}>{b.produto?.code ?? b.barcode_number}</span>
              <span className={styles.bipeNome}>{b.produto?.name ?? 'não cadastrado'}</span>
              {b.produto
                ? <Check size={14} className={styles.iconeOk} />
                : <AlertTriangle size={14} className={styles.iconeAlerta} />}
            </div>
          ))}
        </div>

        <div className={styles.rodape}>
          <Button size="sm" variant="ghost" onClick={desfazer} disabled={ocupado || total === 0}>
            <Undo2 size={14} /> Desfazer último
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelar} disabled={fechando}>
            <X size={14} /> Cancelar conferência
          </Button>
          <Button onClick={encerrarEConferir} loading={carregandoRec} disabled={ocupado}>
            Encerrar e conferir
          </Button>
        </div>
      </div>
    )
  }

  // ── Reconciliação ─────────────────────────────────────────────────────────
  if (!rec) return null

  return (
    <div className={styles.reconc}>
      <h1 className={styles.recTitulo}>
        Conferência de <span className={styles.cap}>{escopoNome}</span>
      </h1>
      <p className={styles.recMeta}>{sessao.loja} · {sessao.quem} · {total} peças bipadas</p>

      <div className={styles.baldes}>
        <Balde titulo="Bate"         valor={rec.bate.length} />
        <Balde titulo="Falta"        valor={rec.falta.length} tom="falta" />
        <Balde titulo="Sobra"        valor={rec.sobra.length} tom="sobra" />
        <Balde titulo="Sem cadastro" valor={rec.naoCadastrado.length} />
      </div>

      <GrupoDivergencia
        titulo="Falta"
        descricao="Está no sistema, não apareceu na gaveta — vai sair do estoque"
        linhas={rec.falta}
        motivo={motivoFalta}
        setMotivo={setMotivoFalta}
        excecoes={excecoes}
        alternar={alternarExcecao}
      />

      <GrupoDivergencia
        titulo="Sobra"
        descricao="Apareceu mais do que o sistema diz"
        linhas={rec.sobra}
        motivo={motivoSobra}
        setMotivo={setMotivoSobra}
        excecoes={excecoes}
        alternar={alternarExcecao}
      />

      {rec.naoCadastrado.length > 0 && (
        <section className={styles.grupo}>
          <h2 className={styles.grupoTitulo}>Não cadastrado</h2>
          <p className={styles.grupoDesc}>Etiqueta lida, produto não existe no sistema</p>
          <div className={styles.semCadastro}>
            {rec.naoCadastrado.map(n => (
              <div key={n.barcode_number} className={styles.semCadastroLinha}>
                <span className={styles.bipeCode}>{n.barcode_number}</span>
                <span className={styles.muted}>×{n.vezes}</span>
              </div>
            ))}
          </div>
          <p className={styles.grupoNota}>
            Estas etiquetas ficam registradas na conferência. O cadastro delas é feito em Produtos —
            a contagem não é lugar de parar para cadastrar peça.
          </p>
        </section>
      )}

      {erro && <div className={styles.erro}>{erro}</div>}

      <div className={styles.rodape}>
        <Button size="sm" variant="ghost" onClick={() => setFase('contando')} disabled={fechando}>
          Voltar a contar
        </Button>
        <Button onClick={aplicarEFechar} loading={fechando} disabled={motivosFaltando > 0}>
          {totalAplicar === 0
            ? 'Fechar sem ajustes'
            : `Aplicar ${totalAplicar} ajuste${totalAplicar > 1 ? 's' : ''} e fechar`}
        </Button>
      </div>
    </div>
  )
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────

function Balde({ titulo, valor, tom }: { titulo: string; valor: number; tom?: 'falta' | 'sobra' }) {
  return (
    <div className={styles.balde}>
      <span className={styles.baldeTitulo}>{titulo}</span>
      <span className={`${styles.baldeValor} ${tom ? styles[`balde_${tom}`] : ''}`}>{valor}</span>
    </div>
  )
}

const POR_PAGINA = 20

function GrupoDivergencia({ titulo, descricao, linhas, motivo, setMotivo, excecoes, alternar }: {
  titulo: string
  descricao: string
  linhas: LinhaReconciliacao[]
  motivo: string
  setMotivo: (v: string) => void
  excecoes: Set<string>
  alternar: (id: string) => void
}) {
  const [tudo, setTudo] = useState(false)
  if (!linhas.length) return null

  const aplicando = linhas.filter(l => !excecoes.has(l.product_id)).length
  const visiveis = tudo ? linhas : linhas.slice(0, POR_PAGINA)

  return (
    <section className={styles.grupo}>
      <div className={styles.grupoCabeca}>
        <div>
          <h2 className={styles.grupoTitulo}>{titulo} · {linhas.length}</h2>
          <p className={styles.grupoDesc}>{descricao}</p>
        </div>
        <div className={styles.grupoMotivo}>
          <label className={styles.grupoMotivoRotulo}>
            Motivo {aplicando > 0 && <span className={styles.obrigatorio}>obrigatório</span>}
          </label>
          <select
            className={styles.select}
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
          >
            <option value="">Escolha…</option>
            {MOTIVOS.map(m => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
          </select>
          <span className={styles.grupoResumo}>
            {aplicando} de {linhas.length} vão ser ajustadas
          </span>
        </div>
      </div>

      <div className={styles.listaDiv}>
        {visiveis.map(l => {
          const deixar = excecoes.has(l.product_id)
          return (
            <div key={l.product_id} className={`${styles.linhaDiv} ${deixar ? styles.linhaIgnorada : ''}`}>
              <span className={styles.bipeCode}>{l.code}</span>
              <span className={styles.linhaNome}>{l.name}</span>
              <span className={styles.linhaNumeros}>
                <strong>{l.esperado}</strong> → <strong>{l.contado}</strong>
              </span>
              {/* A exceção que importa: a peça pode estar na mão de uma cliente
                  provando, e ajustar criaria falta falsa hoje e sobra amanhã. */}
              <label className={styles.deixar}>
                <input type="checkbox" checked={deixar} onChange={() => alternar(l.product_id)} />
                deixar como está
              </label>
            </div>
          )
        })}
      </div>

      {linhas.length > POR_PAGINA && (
        <button className={styles.verTodas} onClick={() => setTudo(t => !t)}>
          {tudo ? 'Mostrar menos' : `Mostrar todas as ${linhas.length}`}
        </button>
      )}
    </section>
  )
}
