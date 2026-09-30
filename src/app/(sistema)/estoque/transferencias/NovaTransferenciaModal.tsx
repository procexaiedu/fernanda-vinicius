'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Minus, Plus, RotateCcw, ScanLine, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { formatarDinheiro } from '@/lib/dinheiro'
import { buscarPecaPorCodigo, enviarTransferencia, revalidarRascunho, type PecaBipada } from './actions'
import type { LojaOption } from './page'
import styles from './NovaTransferenciaModal.module.css'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'
import { idDeRequisicaoValido, novoIdDeRequisicao } from '@/lib/idempotencia'

interface Linha extends PecaBipada {
  quantidade: number
}

/** Duas leituras da mesma peça em menos disto é o leitor repetindo, não a pessoa bipando de novo. */
const MS_LEITURA_DUPLA = 1500

/*
 * ─── Rascunho do romaneio ────────────────────────────────────────────────────
 *
 * Em 15/09 a dona bipou as peças, saiu da tela e perdeu tudo:
 *
 *   — "Salva. Não salvou."
 *   — "Perdi tudo?"
 *   — "Perdeu."
 *
 * Ela manda dezenas de peças por vez. Perder a lista por fechar o modal sem
 * querer é o tipo de coisa que faz ela abandonar o sistema e voltar ao papel.
 *
 * Fica em localStorage, e não em tabela: é uma pessoa, uma máquina, e a
 * montagem dura minutos. Tabela custaria migração para resolver um problema
 * que ela não tem (montar romaneio num computador e terminar noutro).
 *
 * O que NÃO fica salvo é a validade das peças — quem responde isso é o
 * servidor, em `revalidarRascunho`, toda vez que o rascunho volta.
 */
/*
 * Uma chave por PESSOA e por LOJA DE ORIGEM.
 *
 * A v1 era uma chave só para a máquina inteira. Duas consequências: no
 * computador da loja, a colega abria a tela e via (ou apagava) o romaneio da
 * outra; e o rascunho de Brasília era APAGADO ao abrir a tela em Campinas —
 * a lista "vazia" da origem nova sobrescrevia a caixa bipada da outra loja.
 * Com a chave separada, cada rascunho só é tocado por quem o montou, na loja
 * de onde ele sai.
 */
const CHAVE_RASCUNHO_V1 = 'fv:transferencia:rascunho:v1'
const chaveRascunho = (usuarioId: string, origem: string) =>
  `fv:transferencia:draft:v2:${usuarioId}:${origem}`

interface Rascunho {
  origem: string
  destino: string
  obs: string
  linhas: Linha[]
  salvoEm: string
  /**
   * uuid deste romaneio para o envio idempotente. Opcional: rascunho gravado
   * antes dele existir não tem, e ganha um novo ao ser retomado.
   */
  idRequisicao?: string
}

function lerChave(chave: string): Rascunho | null {
  try {
    const cru = localStorage.getItem(chave)
    if (!cru) return null
    const r = JSON.parse(cru) as Rascunho
    return Array.isArray(r?.linhas) && r.linhas.length ? r : null
  } catch {
    // Aba anônima, storage bloqueado, JSON corrompido: seguir sem rascunho é
    // sempre melhor que derrubar a tela de transferência.
    return null
  }
}

/**
 * O rascunho desta pessoa para esta origem.
 *
 * Na primeira vez, se não houver v2, tenta a chave antiga — é onde está o
 * romaneio de quem estava no meio de uma caixa quando esta versão subiu. Só
 * migra se a origem da v1 for a pedida: rascunho de outra loja fica onde está,
 * intacto, para quem o montou.
 */
function lerRascunho(usuarioId: string, origem: string): Rascunho | null {
  const atual = lerChave(chaveRascunho(usuarioId, origem))
  if (atual) return atual
  const antigo = lerChave(CHAVE_RASCUNHO_V1)
  if (!antigo || antigo.origem !== origem) return null
  gravarRascunho(usuarioId, antigo)
  try { localStorage.removeItem(CHAVE_RASCUNHO_V1) } catch { /* idem */ }
  return antigo
}

function gravarRascunho(usuarioId: string, r: Rascunho) {
  try { localStorage.setItem(chaveRascunho(usuarioId, r.origem), JSON.stringify(r)) } catch { /* idem */ }
}

function apagarRascunho(usuarioId: string, origem: string) {
  try { localStorage.removeItem(chaveRascunho(usuarioId, origem)) } catch { /* idem */ }
}

export default function NovaTransferenciaModal({ lojas, lojaPadrao, usuarioId, onClose, onEnviado }: {
  lojas: LojaOption[]
  lojaPadrao: string | null
  usuarioId: string
  onClose: () => void
  onEnviado: (transferId: string) => void
}) {
  const router = useRouter()

  /*
   * Quem tem loja não escolhe a origem: ela É a loja dela. O campo continua
   * visível — some, e ninguém entende de onde a peça está saindo —, mas não
   * abre. O servidor recusa de todo jeito (ver actions.ts); isto é só para não
   * oferecer o que vai ser negado.
   */
  const origemTravada = !!lojaPadrao

  const [origem, setOrigem]   = useState(lojaPadrao ?? lojas[0]?.id ?? '')
  const [destino, setDestino] = useState(
    lojas.find(l => l.id !== (lojaPadrao ?? lojas[0]?.id))?.id ?? '',
  )
  const [linhas, setLinhas]   = useState<Linha[]>([])
  const [obs, setObs]         = useState('')
  const [erro, setErro]       = useState<string | null>(null)
  const [ultimo, setUltimo]   = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  /*
   * Depois do envio que deu certo, o botão não volta. Entre o `finally`
   * soltar o `enviando` e o modal fechar havia uma janela em que um segundo
   * clique mandava a caixa inteira de novo — e o envio ainda não é idempotente.
   * O ref cobre o duplo clique antes mesmo de o React re-renderizar.
   */
  const [enviado, setEnviado] = useState(false)
  const travaEnvio = useRef(false)
  /*
   * Um id por ROMANEIO, não por clique. Vai no rascunho: se o envio sai mas a
   * resposta se perde, o reenvio (mesmo depois de fechar e reabrir a tela)
   * leva o mesmo id e o banco devolve o romaneio já gravado em vez de tirar a
   * caixa da origem duas vezes. Só muda quando o romaneio acaba: enviado com
   * sucesso, descartado, ou outra origem (outro rascunho).
   */
  const [idRequisicao, setIdRequisicao] = useState(() => novoIdDeRequisicao())

  /*
   * `restaurando` existe para o efeito que GRAVA não passar na frente do que
   * LÊ. Sem ele, o primeiro render (com `linhas` vazio) apagaria o rascunho
   * antes de ele ser lido — o bug seria idêntico ao que isto veio corrigir.
   */
  const [restaurando, setRestaurando] = useState(true)
  /* Ligado quando a reconferência falha: protege o rascunho de ser apagado. */
  const rascunhoTravado = useRef(false)
  const [retomado, setRetomado] = useState<{ quando: string; perdidas: number } | null>(null)

  const campoRef  = useRef<HTMLInputElement>(null)
  const [digitado, setDigitado] = useState('')

  // Guarda o instante da última leitura de cada código, para filtrar repetição.
  const ultimaLeitura = useRef<Map<string, number>>(new Map())
  /* Cópia da lista para o `registrar` consultar sem virar dependência dele
     (o leitor re-registraria o callback a cada bipe). */
  const linhasRef = useRef<Linha[]>([])
  useEffect(() => { linhasRef.current = linhas }, [linhas])

  /*
   * O bipe entra por aqui venha do leitor ou da digitação. Uma função só,
   * porque a regra (é desta loja? tem saldo? já está na lista?) não pode
   * depender de como o código chegou.
   */
  const registrar = useCallback(async (codigo: string) => {
    const cod = codigo.trim()
    if (!cod) return

    if (!origem) { setErro('Escolha a loja de origem antes de bipar.'); return }

    const agora = Date.now()
    const anterior = ultimaLeitura.current.get(cod) ?? 0
    if (agora - anterior < MS_LEITURA_DUPLA) {
      /*
       * Ignorar em silêncio só é seguro para peça de uma unidade. Com duas ou
       * mais, ela pode ter bipado DUAS peças iguais em sequência rápida — e a
       * segunda sumia sem aviso, indo uma a menos na caixa.
       */
      const naLista = linhasRef.current.find(l => l.barcode_number === cod)
      if (naLista && naLista.quantity_in_stock > 1) {
        setErro('Leitura repetida ignorada — se são duas peças, bipe de novo.')
      }
      return
    }
    ultimaLeitura.current.set(cod, agora)

    setErro(null)

    /* Sem o try, falha de rede rejeitava dentro do leitor: nenhum aviso e a
       peça fora da lista, com ela achando que bipou. A busca só LÊ — bipar de
       novo é seguro, por isso a leitura é liberada para o mesmo código. */
    let r: Awaited<ReturnType<typeof buscarPecaPorCodigo>>
    try {
      r = await buscarPecaPorCodigo(cod, origem)
    } catch (e) {
      ultimaLeitura.current.delete(cod)
      setUltimo(null)
      setErro(`ESTA PEÇA NÃO ENTROU NA LISTA (${cod}) — BIPE DE NOVO. ${mensagemDeErroAoSalvar(e, { temRascunho: true })}`)
      return
    }
    if (!r.success) { setErro(r.error); setUltimo(null); return }

    setLinhas(atual => {
      const i = atual.findIndex(l => l.id === r.peca.id)
      if (i === -1) return [{ ...r.peca, quantidade: 1 }, ...atual]

      // Já está na lista: bipar de novo soma mais uma, até o saldo disponível.
      const copia = [...atual]
      copia[i] = {
        ...copia[i],
        quantidade: Math.min(copia[i].quantidade + 1, copia[i].quantity_in_stock),
      }
      return copia
    })
    setUltimo(`${r.peca.name} · ${r.peca.barcode_number}`)
  }, [origem])

  useBarcodeScanner({ onScan: registrar, ativo: !enviando && !enviado })

  useEffect(() => { campoRef.current?.focus() }, [])

  /*
   * Retoma o romaneio de onde ela parou — reconferindo no servidor.
   *
   * Peça bipada ontem pode ter sido vendida hoje. Repor a lista crua do
   * localStorage colocaria de volta peça que não existe mais e o envio inteiro
   * seria recusado pelo banco (a função é uma transação só), depois de ela ter
   * bipado a caixa toda. Por isso a lista volta pelo que o servidor confirma,
   * e o que caiu fora é contado e dito na tela.
   */
  /*
   * Contador de restaurações: a leitura é assíncrona e o modal pode fechar (ou
   * a origem mudar) no meio dela. Só a mais recente pode tocar o estado.
   */
  const restauracaoAtual = useRef(0)

  async function restaurar(origemAlvo: string) {
    const minha = ++restauracaoAtual.current
    const vivo = () => restauracaoAtual.current === minha

    /* Cede a vez antes de tocar o estado: chamada da abertura do modal, esta
       função roda dentro de um efeito, e setState síncrono ali é o que a regra
       react-hooks/set-state-in-effect proíbe (render em cascata). */
    await Promise.resolve()
    if (!vivo()) return

    const r = lerRascunho(usuarioId, origemAlvo)
    if (!r) { if (vivo()) setRestaurando(false); return }

    /*
     * Falha AQUI (rede, sessão, deploy) é tratada igual ao `success: false`:
     * antes, a promise rejeitava, `restaurando` ficava true para sempre e o
     * efeito que grava nunca mais rodava — tudo que ela bipasse depois se
     * perdia ao fechar a tela, que é o bug que o rascunho veio corrigir.
     */
    let res: Awaited<ReturnType<typeof revalidarRascunho>> | null = null
    let falha: string | null = null
    try {
      res = await revalidarRascunho(r.linhas.map(l => l.id), r.origem)
    } catch (e) {
      falha = mensagemDeErroAoSalvar(e, { temRascunho: true })
    }
    if (!vivo()) return

    if (!res || !res.success) {
      // Falhou a reconferência: não apaga o rascunho nem mostra lista velha.
      // Ela tenta de novo abrindo a tela; o trabalho continua guardado.
      //
      // A trava é necessária: sem ela, o efeito que GRAVA veria a lista vazia
      // logo em seguida e apagaria o rascunho — o comentário acima prometia
      // uma coisa e o código fazia a outra (achado na revisão de 16/09).
      rascunhoTravado.current = true
      setErro(falha ?? 'Não consegui reconferir o romaneio guardado. Feche e abra a tela de novo.')
      setRestaurando(false)
      return
    }

    const atuais = new Map(res.pecas.map(p => [p.id, p]))
    const vivas = r.linhas.flatMap(l => {
      const p = atuais.get(l.id)
      if (!p) return []
      // Saldo pode ter caído desde o bipe — a quantidade acompanha.
      return [{ ...p, quantidade: Math.min(l.quantidade, p.quantity_in_stock) }]
    })

    if (!vivas.length) { apagarRascunho(usuarioId, r.origem); setRestaurando(false); return }

    setDestino(r.destino)
    setObs(r.obs)
    setLinhas(vivas)
    // O id do rascunho é o do romaneio que PODE já ter sido enviado — manter.
    const idGuardado = idDeRequisicaoValido(r.idRequisicao)
    if (idGuardado) setIdRequisicao(idGuardado)
    setRetomado({ quando: r.salvoEm, perdidas: r.linhas.length - vivas.length })
    setRestaurando(false)
  }

  useEffect(() => {
    /* A leitura mora dentro de uma função assíncrona, e não no corpo do efeito:
       `localStorage` fica fora do caminho síncrono de render. */
    ;(async () => { await restaurar(origem) })()
    // Fechar o modal invalida a restauração em voo (ver `restauracaoAtual`).
    const contador = restauracaoAtual
    return () => { contador.current++ }
    // Roda uma vez, na abertura do modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Toda mudança na lista é gravada. Lista vazia não deixa rastro. */
  useEffect(() => {
    if (restaurando) return
    // Reconferência falhou: o rascunho guardado é o único trabalho que existe.
    // Nem apagar nem sobrescrever — bipar uma peça agora trocaria a caixa inteira
    // guardada por essa peça só. Destrava ao reabrir a tela ou ao Descartar.
    if (rascunhoTravado.current) return
    if (enviado) return
    // A chave é da ORIGEM atual: lista vazia aqui só apaga o rascunho desta
    // loja, nunca o de outra.
    if (!linhas.length) { apagarRascunho(usuarioId, origem); return }
    gravarRascunho(usuarioId, { origem, destino, obs, linhas, salvoEm: new Date().toISOString(), idRequisicao })
  }, [linhas, origem, destino, obs, restaurando, enviado, usuarioId, idRequisicao])

  /* Sair da tela NÃO descarta. Só este botão descarta. */
  function descartarRascunho() {
    rascunhoTravado.current = false
    apagarRascunho(usuarioId, origem)
    setIdRequisicao(novoIdDeRequisicao())
    setLinhas([])
    setRetomado(null)
    setErro(null)
    setUltimo(null)
    ultimaLeitura.current.clear()
    campoRef.current?.focus()
  }

  /*
   * Trocar a origem esvazia a lista.
   *
   * As peças já bipadas pertencem à loja anterior; deixá-las na tela e mandar
   * enviaria peça de Campinas num romaneio que diz "saiu de Brasília". A função
   * do banco recusaria, mas só depois de a pessoa ter bipado a caixa inteira.
   */
  function trocarOrigem(nova: string) {
    /*
     * O rascunho da origem anterior fica guardado na chave dela — não é
     * apagado. E a origem nova traz o SEU rascunho, se houver: trocar de loja
     * e voltar não pode custar a caixa bipada.
     */
    rascunhoTravado.current = false
    setRestaurando(true)
    // Outra origem = outro romaneio. Se ela tiver rascunho lá, `restaurar`
    // troca pelo id guardado nele.
    setIdRequisicao(novoIdDeRequisicao())
    setOrigem(nova)
    setLinhas([])
    setRetomado(null)
    setErro(null)
    setUltimo(null)
    ultimaLeitura.current.clear()
    if (nova === destino) setDestino(lojas.find(l => l.id !== nova)?.id ?? '')
    void restaurar(nova)
  }

  function ajustar(id: string, delta: number) {
    setLinhas(atual => atual.map(l => {
      if (l.id !== id) return l
      return { ...l, quantidade: Math.max(1, Math.min(l.quantidade + delta, l.quantity_in_stock)) }
    }))
  }

  const pecas = linhas.reduce((s, l) => s + l.quantidade, 0)
  const custo = linhas.reduce((s, l) => s + l.cost_price * l.quantidade, 0)
  /* Pedido dela, com estas palavras: "Coloca assim, ó: peça, custo e venda."
     "Itens" saiu do rodapé — ela perguntou "peça e item não é a mesma coisa?"
     e não havia resposta que servisse para alguma decisão dela. */
  const venda = linhas.reduce((s, l) => s + l.sale_price * l.quantidade, 0)

  async function enviar() {
    if (travaEnvio.current) return
    travaEnvio.current = true
    setEnviando(true)
    setErro(null)

    /* try/finally: sem ele, uma falha de rede ou um deploy no meio deixa o
     * botão girando para sempre e sem mensagem. Ver src/lib/erroDeSalvar.ts. */
    let r: Awaited<ReturnType<typeof enviarTransferencia>>
    try {
      r = await enviarTransferencia({
        from_store_id: origem,
        to_store_id:   destino,
        itens: linhas.map(l => ({ product_id: l.id, quantity: l.quantidade })),
        notes: obs,
        // Toda transferência (ida e devolução) entra direto no destino: ela bipa
        // pra montar, envia, e já cai no estoque de destino. Sem bipar na chegada.
        autoReceber: true,
        clientRequestId: idRequisicao,
      })
      if (r.success) setEnviado(true)
    } catch (e) {
      /* Erro sem resposta pode ter enviado. A mensagem manda conferir a lista
         antes de reenviar — reenviar às cegas duplicaria a caixa inteira. O
         rascunho fica: se não foi, ela não perdeu nada. */
      travaEnvio.current = false
      setErro(mensagemDeErroAoSalvar(e, { temRascunho: true }))
      return
    } finally {
      setEnviando(false)
    }

    if (!r.success) { travaEnvio.current = false; setErro(r.error ?? 'Erro ao enviar.'); return }

    // Só aqui o rascunho morre: o romaneio existe no banco, não se perde mais.
    apagarRascunho(usuarioId, origem)
    // Romaneio encerrado: o próximo é outro envio, com outro id.
    setIdRequisicao(novoIdDeRequisicao())
    router.refresh()
    onEnviado(r.transfer_id!)
  }

  return (
    <Modal isOpen title="Nova transferência" size="xl" onClose={onClose}>
      <div className={styles.corpo}>
        <div className={styles.rotas}>
          <div className={styles.campo}>
            <span>De</span>
            <SearchableSelect
              value={origem}
              onChange={trocarOrigem}
              options={lojas.map(l => ({ value: l.id, label: l.name }))}
              placeholder="Loja de origem"
              searchable={false}
              permitirLimpar={false}
              disabled={enviando || origemTravada}
            />
          </div>
          <span className={styles.seta}>→</span>
          <div className={styles.campo}>
            <span>Para</span>
            <SearchableSelect
              value={destino}
              onChange={setDestino}
              options={lojas.filter(l => l.id !== origem).map(l => ({ value: l.id, label: l.name }))}
              placeholder="Loja de destino"
              searchable={false}
              permitirLimpar={false}
              disabled={enviando}
            />
          </div>
        </div>

        <p className={styles.tipoDica}>
          Bipe as peças para montar a transferência. Ao enviar, elas já entram no
          estoque da loja de destino — não precisa bipar de novo na chegada.
        </p>

        <div className={styles.bipeArea}>
          <ScanLine size={18} className={styles.bipeIcone} />
          <input
            ref={campoRef}
            className={styles.bipeInput}
            value={digitado}
            onChange={e => setDigitado(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              registrar(digitado)
              setDigitado('')
            }}
            placeholder="Bipe a etiqueta ou digite o código e tecle Enter"
            disabled={enviando}
          />
        </div>

        {erro && (
          <div className={styles.erro}>
            <AlertTriangle size={14} />
            {erro}
          </div>
        )}
        {!erro && ultimo && <div className={styles.ultimo}>Última leitura: {ultimo}</div>}

        {retomado && (
          <div className={styles.avisoRetomado}>
            <RotateCcw size={14} />
            <span>
              <strong>Romaneio retomado.</strong> Você tinha {pecas} peça{pecas !== 1 ? 's' : ''} bipada
              {pecas !== 1 ? 's' : ''} em {new Date(retomado.quando).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}.
              {retomado.perdidas > 0 && (
                <> {retomado.perdidas} peça{retomado.perdidas > 1 ? 's saíram' : ' saiu'} da lista
                  por não ter mais saldo nesta loja.</>
              )}
            </span>
            <button type="button" className={styles.descartar} onClick={descartarRascunho}
              disabled={enviando}>
              Descartar
            </button>
          </div>
        )}

        {linhas.length === 0 ? (
          <div className={styles.vazio}>
            Nenhuma peça no romaneio ainda. Bipe as etiquetas das peças que vão na caixa.
          </div>
        ) : (
          <div className={styles.listaWrapper}>
            <table className={styles.lista}>
              <thead>
                <tr>
                  <th>Etiqueta</th>
                  <th>Peça</th>
                  <th className={`${styles.num} col-num`}>Enviar</th>
                  <th className={`${styles.num} col-num`}>Na loja</th>
                  <th className={`${styles.num} col-num`}>Custo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => (
                  <tr key={l.id}>
                    <td className={styles.etiqueta}>{l.barcode_number}</td>
                    <td>
                      <span className={styles.nome}>{l.name}</span>
                      <span className={styles.codigo}>{l.code}</span>
                    </td>
                    <td className={`${styles.num} col-num`}>
                      {/* Stepper só aparece de fato para peça com mais de uma unidade. */}
                      <div className={styles.stepper}>
                        <button type="button" onClick={() => ajustar(l.id, -1)}
                          disabled={l.quantidade <= 1 || enviando} aria-label="Menos um">
                          <Minus size={12} />
                        </button>
                        <span>{l.quantidade}</span>
                        <button type="button" onClick={() => ajustar(l.id, 1)}
                          disabled={l.quantidade >= l.quantity_in_stock || enviando} aria-label="Mais um">
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    <td className={`${styles.num} col-num`}>{l.quantity_in_stock}</td>
                    <td className={`${styles.num} col-num`}>{formatarDinheiro(l.cost_price * l.quantidade)}</td>
                    <td>
                      <button type="button" className={styles.remover} disabled={enviando}
                        onClick={() => setLinhas(a => a.filter(x => x.id !== l.id))} aria-label="Tirar do romaneio">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          O aviso "X peças vai parcial — reimprima a etiqueta na chegada" saiu em
          16/09. Desde a etiqueta única POR LOJA, a peça chega com a mesma
          etiqueta que está colada nela. A resposta da dona quando viu o aviso
          foi "não, jamais" a reetiquetar.

          O único caso que ainda pede etiqueta nova (etiqueta repetida em outro
          cadastro no destino) só se sabe na chegada, e aparece no romaneio e
          na conferência — não dá para prever aqui.
        */}

        <label className={styles.campoObs}>
          <span>Observação (opcional)</span>
          <input value={obs} onChange={e => setObs(e.target.value)}
            placeholder="Ex.: caixa 2 de 3, foi pelo motoboy" disabled={enviando} />
        </label>

        <div className={styles.rodape}>
          <div className={styles.totais}>
            <span><strong>{pecas}</strong> peça{pecas !== 1 ? 's' : ''}</span>
            <span>Custo <strong>{formatarDinheiro(custo)}</strong></span>
            <span>Venda <strong>{formatarDinheiro(venda)}</strong></span>
          </div>
          <div className={styles.acoes}>
            <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button onClick={enviar} loading={enviando} disabled={linhas.length === 0 || !destino || enviado}>
              Enviar e dar entrada
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
