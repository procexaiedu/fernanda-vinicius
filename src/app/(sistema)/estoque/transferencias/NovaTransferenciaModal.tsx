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
const CHAVE_RASCUNHO = 'fv:transferencia:rascunho:v1'

interface Rascunho {
  origem: string
  destino: string
  obs: string
  linhas: Linha[]
  salvoEm: string
}

function lerRascunho(): Rascunho | null {
  try {
    const cru = localStorage.getItem(CHAVE_RASCUNHO)
    if (!cru) return null
    const r = JSON.parse(cru) as Rascunho
    return Array.isArray(r?.linhas) && r.linhas.length ? r : null
  } catch {
    // Aba anônima, storage bloqueado, JSON corrompido: seguir sem rascunho é
    // sempre melhor que derrubar a tela de transferência.
    return null
  }
}

function gravarRascunho(r: Rascunho) {
  try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r)) } catch { /* idem */ }
}

function apagarRascunho() {
  try { localStorage.removeItem(CHAVE_RASCUNHO) } catch { /* idem */ }
}

export default function NovaTransferenciaModal({ lojas, lojaPadrao, onClose, onEnviado }: {
  lojas: LojaOption[]
  lojaPadrao: string | null
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
   * `restaurando` existe para o efeito que GRAVA não passar na frente do que
   * LÊ. Sem ele, o primeiro render (com `linhas` vazio) apagaria o rascunho
   * antes de ele ser lido — o bug seria idêntico ao que isto veio corrigir.
   */
  const [restaurando, setRestaurando] = useState(true)
  const [retomado, setRetomado] = useState<{ quando: string; perdidas: number } | null>(null)

  const campoRef  = useRef<HTMLInputElement>(null)
  const [digitado, setDigitado] = useState('')

  // Guarda o instante da última leitura de cada código, para filtrar repetição.
  const ultimaLeitura = useRef<Map<string, number>>(new Map())

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
    if (agora - anterior < MS_LEITURA_DUPLA) return
    ultimaLeitura.current.set(cod, agora)

    setErro(null)

    const r = await buscarPecaPorCodigo(cod, origem)
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

  useBarcodeScanner({ onScan: registrar, ativo: !enviando })

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
  useEffect(() => {
    let vivo = true
    ;(async () => {
      /* A leitura mora aqui dentro, e não no corpo do efeito, por dois motivos:
         `localStorage` fica fora do caminho síncrono de render, e o estado só é
         tocado de dentro de uma função — que é o que a regra
         react-hooks/set-state-in-effect pede. */
      const r = lerRascunho()
      // Rascunho de outra loja não serve para quem tem loja fixa.
      if (!r || (origemTravada && r.origem !== origem)) { if (vivo) setRestaurando(false); return }

      const res = await revalidarRascunho(r.linhas.map(l => l.id), r.origem)
      if (!vivo) return

      if (!res.success) {
        // Falhou a reconferência: não apaga o rascunho nem mostra lista velha.
        // Ela tenta de novo abrindo a tela; o trabalho continua guardado.
        setErro('Não consegui reconferir o romaneio guardado. Feche e abra a tela de novo.')
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

      if (!vivas.length) { apagarRascunho(); setRestaurando(false); return }

      setOrigem(r.origem)
      setDestino(r.destino)
      setObs(r.obs)
      setLinhas(vivas)
      setRetomado({ quando: r.salvoEm, perdidas: r.linhas.length - vivas.length })
      setRestaurando(false)
    })()

    return () => { vivo = false }
    // Roda uma vez, na abertura do modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Toda mudança na lista é gravada. Lista vazia não deixa rastro. */
  useEffect(() => {
    if (restaurando) return
    if (!linhas.length) { apagarRascunho(); return }
    gravarRascunho({ origem, destino, obs, linhas, salvoEm: new Date().toISOString() })
  }, [linhas, origem, destino, obs, restaurando])

  /* Sair da tela NÃO descarta. Só este botão descarta. */
  function descartarRascunho() {
    apagarRascunho()
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
    setOrigem(nova)
    setLinhas([])
    setRetomado(null)
    setErro(null)
    setUltimo(null)
    ultimaLeitura.current.clear()
    if (nova === destino) setDestino(lojas.find(l => l.id !== nova)?.id ?? '')
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
  const parciais = linhas.filter(l => l.quantidade < l.quantity_in_stock)

  async function enviar() {
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
      })
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
      return
    } finally {
      setEnviando(false)
    }

    if (!r.success) { setErro(r.error ?? 'Erro ao enviar.'); return }

    // Só aqui o rascunho morre: o romaneio existe no banco, não se perde mais.
    apagarRascunho()
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

        {parciais.length > 0 && (
          <div className={styles.avisoParcial}>
            <AlertTriangle size={14} />
            <span>
              <strong>{parciais.length} peça{parciais.length > 1 ? 's' : ''} vai parcial.</strong> No
              destino ela ganha código de barras próprio — o código de barras é único no sistema
              inteiro e não pode existir nas duas lojas. Reimprima a etiqueta na chegada, senão o
              leitor não acha a peça lá.
            </span>
          </div>
        )}

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
            <Button onClick={enviar} loading={enviando} disabled={linhas.length === 0 || !destino}>
              Enviar e gerar romaneio
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
