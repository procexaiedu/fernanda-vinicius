'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, RotateCcw, ScanLine } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { identificarEtiqueta, receberTransferencia } from './actions'
import type { Romaneio } from './page'
import styles from './ConferenciaModal.module.css'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'

const MS_LEITURA_DUPLA = 1500

/*
 * ─── Rascunho da conferência ─────────────────────────────────────────────────
 *
 * Pedido em 16/09, na véspera da primeira conferência real: 164 peças de
 * Campinas chegando em Brasília. A tela de ENVIO já guardava rascunho desde
 * 15/09 (a dona perdeu um romaneio inteiro ao sair da tela); a de CHEGADA
 * guardava os bipes só na memória. Fechar, recarregar ou a internet cair na
 * peça 150 obrigava a bipar a caixa inteira de novo.
 *
 * Diferente do envio, aqui NÃO há reconferência no servidor ao retomar: o
 * romaneio enviado não muda enquanto está em trânsito. Se outra pessoa já o
 * recebeu, o banco recusa a confirmação (a função é idempotente) e o rascunho
 * é descartado.
 *
 * Uma chave POR ROMANEIO — pode haver mais de um em trânsito, e bipes de uma
 * caixa não podem aparecer na conferência de outra.
 */
interface RascunhoConferencia {
  bipados: [string, number][]
  sobras: { barcode: string; id: string | null; nome: string }[]
  obs: string
  salvoEm: string
}

const chaveRascunho = (transferId: string) => `fv:conferencia:rascunho:v1:${transferId}`

function lerRascunho(transferId: string): RascunhoConferencia | null {
  try {
    const cru = localStorage.getItem(chaveRascunho(transferId))
    if (!cru) return null
    const r = JSON.parse(cru) as RascunhoConferencia
    return Array.isArray(r?.bipados) ? r : null
  } catch {
    // Aba anônima, storage bloqueado ou JSON corrompido: segue sem rascunho.
    return null
  }
}

function gravarRascunho(transferId: string, r: RascunhoConferencia) {
  try { localStorage.setItem(chaveRascunho(transferId), JSON.stringify(r)) } catch { /* idem */ }
}

function apagarRascunho(transferId: string) {
  try { localStorage.removeItem(chaveRascunho(transferId)) } catch { /* idem */ }
}

/**
 * Conferência da caixa que chegou.
 *
 * O bipe é conferido contra a lista do romaneio, que já veio inteira do
 * servidor — inclusive o `barcode_number` congelado de cada peça. Não há ida ao
 * banco por leitura: a operadora bipa 40 peças em fila e cada uma responde na
 * hora.
 *
 * Peça do romaneio que não for bipada conta como NÃO RECEBIDA. Não é "esqueci
 * de conferir": no fim da conferência, o que não foi bipado não chegou, e o
 * saldo dela volta para a loja de origem. Por isso o botão de confirmar mostra
 * o que vai ser registrado como falta antes de aplicar.
 */
export default function ConferenciaModal({ romaneio, onClose }: {
  romaneio: Romaneio
  onClose: () => void
}) {
  const router = useRouter()

  const esperados = useMemo(
    () => romaneio.itens.filter(i => i.quantity_sent > 0),
    [romaneio.itens],
  )

  /*
   * O rascunho é lido UMA vez, no primeiro render — inicializador preguiçoso do
   * useState, e não efeito. Assim os bipes já nascem na tela, sem piscar vazio,
   * e sem setState dentro de efeito. Esta tela só existe no navegador (abre por
   * clique, dentro do Modal), então `localStorage` está disponível.
   */
  const [inicial] = useState(() => {
    const r = lerRascunho(romaneio.id)
    if (!r) return null

    // Só o que é deste romaneio, e nunca acima do que foi enviado.
    const enviado = new Map(esperados.map(i => [i.product_id, i.quantity_sent]))
    const bipados = new Map<string, number>()
    for (const [id, qtd] of r.bipados) {
      const teto = enviado.get(id)
      if (teto && qtd > 0) bipados.set(id, Math.min(qtd, teto))
    }
    const sobras = Array.isArray(r.sobras) ? r.sobras : []
    if (!bipados.size && !sobras.length && !r.obs) return null

    return { bipados, sobras, obs: r.obs ?? '', salvoEm: r.salvoEm }
  })

  // product_id -> quantas unidades foram bipadas
  const [bipados, setBipados] = useState<Map<string, number>>(() => inicial?.bipados ?? new Map())
  /*
   * Sobra precisa de `product_id` para virar registro na transferência: a
   * função do banco grava um item de sobra referenciando o produto. Guardar só
   * a string da etiqueta deixaria a sobra fora do banco, viva apenas na tela.
   * Etiqueta que não existe em `products` fica com `id: null` — essa não dá
   * para registrar, só descrever na observação.
   */
  const [sobras, setSobras] = useState<{ barcode: string; id: string | null; nome: string }[]>(() => inicial?.sobras ?? [])
  const [obs, setObs]         = useState(() => inicial?.obs ?? '')
  const [retomadoEm, setRetomadoEm] = useState<string | null>(() => inicial?.salvoEm ?? null)
  const [erro, setErro]       = useState<string | null>(null)
  const [ultimo, setUltimo]   = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [digitado, setDigitado] = useState('')

  const campoRef = useRef<HTMLInputElement>(null)
  const ultimaLeitura = useRef<Map<string, number>>(new Map())

  useEffect(() => { campoRef.current?.focus() }, [])

  /* Todo bipe, sobra ou observação é gravado na hora. Nada bipado, nada guardado. */
  useEffect(() => {
    if (!bipados.size && !sobras.length && !obs.trim()) {
      apagarRascunho(romaneio.id)
      return
    }
    gravarRascunho(romaneio.id, {
      bipados: [...bipados.entries()],
      sobras,
      obs,
      salvoEm: new Date().toISOString(),
    })
  }, [bipados, sobras, obs, romaneio.id])

  /* Fechar a tela NÃO descarta. Só este botão. */
  function descartar() {
    apagarRascunho(romaneio.id)
    setBipados(new Map())
    setSobras([])
    setObs('')
    setRetomadoEm(null)
    setErro(null)
    setUltimo(null)
    ultimaLeitura.current.clear()
    campoRef.current?.focus()
  }

  const porEtiqueta = useMemo(() => {
    const m = new Map<string, typeof esperados[number]>()
    esperados.forEach(i => m.set(i.barcode_number, i))
    return m
  }, [esperados])

  const registrar = useCallback(async (codigo: string) => {
    const cod = codigo.trim()
    if (!cod) return

    const agora = Date.now()
    if (agora - (ultimaLeitura.current.get(cod) ?? 0) < MS_LEITURA_DUPLA) return
    ultimaLeitura.current.set(cod, agora)

    const item = porEtiqueta.get(cod)

    if (!item) {
      /*
       * Etiqueta que não está no romaneio. Fica anotada como sobra e NÃO vira
       * estoque: ninguém sabe de onde a peça veio, e criar saldo a partir de um
       * palpite é como se inventa peça no sistema. Alguém decide depois.
       */
      const achada = await identificarEtiqueta(cod, romaneio.to_store_id)
      setSobras(s => (s.some(x => x.barcode === cod)
        ? s
        : [...s, { barcode: cod, id: achada?.id ?? null, nome: achada?.name ?? 'não cadastrada' }]))
      setErro(achada
        ? `${achada.name} não está neste romaneio — anotada como sobra.`
        : `Etiqueta ${cod} não é de nenhuma peça cadastrada — anotada na observação.`)
      setUltimo(null)
      return
    }

    setErro(null)
    setBipados(atual => {
      const novo = new Map(atual)
      const ja = novo.get(item.product_id) ?? 0
      if (ja >= item.quantity_sent) {
        setErro(`${item.product_name}: o romaneio tem ${item.quantity_sent} e você já bipou ${ja}.`)
        return atual
      }
      novo.set(item.product_id, ja + 1)
      return novo
    })
    setUltimo(`${item.product_name} · ${cod}`)
  }, [porEtiqueta, romaneio.to_store_id])

  useBarcodeScanner({ onScan: registrar, ativo: !salvando })

  const conferidas = [...bipados.values()].reduce((s, n) => s + n, 0)
  const totalEsperado = esperados.reduce((s, i) => s + i.quantity_sent, 0)
  const faltando = esperados
    .map(i => ({ item: i, falta: i.quantity_sent - (bipados.get(i.product_id) ?? 0) }))
    .filter(x => x.falta > 0)

  const temDivergencia = faltando.length > 0 || sobras.length > 0

  async function confirmar() {
    if (temDivergencia && !obs.trim()) {
      setErro('Descreva a divergência antes de confirmar.')
      return
    }

    setSalvando(true)
    setErro(null)

    /*
     * Sobras identificadas vão no MESMO array dos recebidos. A função do banco
     * separa: o que não está no romaneio ela grava como item de sobra e não
     * mexe em saldo nenhum. Etiqueta não cadastrada (`id` nulo) fica de fora —
     * não há produto para referenciar; ela vive na observação.
     */
    /* try/finally: sem ele, uma falha de rede ou um deploy no meio deixa o
     * botão girando para sempre e sem mensagem. Ver src/lib/erroDeSalvar.ts. */
    let r: Awaited<ReturnType<typeof receberTransferencia>>
    try {
      r = await receberTransferencia(
      romaneio.id,
      [
        ...[...bipados.entries()].map(([product_id, quantity]) => ({ product_id, quantity })),
        ...sobras.filter(s => s.id).map(s => ({ product_id: s.id!, quantity: 1 })),
      ],
        obs,
      )
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
      return
    } finally {
      setSalvando(false)
    }

    if (!r.success) {
      /* Já recebido por outra pessoa (a função recusa com "já está como ..."):
         o rascunho não serve mais para nada. Qualquer outro erro mantém os
         bipes guardados para tentar de novo. */
      if (/já está como/i.test(r.error ?? '')) apagarRascunho(romaneio.id)
      setErro(r.error ?? 'Erro ao confirmar.')
      return
    }

    // Só aqui o rascunho morre: a chegada está gravada no banco.
    apagarRascunho(romaneio.id)
    router.refresh()
    onClose()
  }

  return (
    <Modal isOpen title={`Conferir chegada — ${romaneio.de} → ${romaneio.para}`} size="xl" onClose={onClose}>
      <div className={styles.corpo}>
        <div className={styles.progresso}>
          <span className={styles.contador}>
            <strong>{conferidas}</strong> de {totalEsperado} peça{totalEsperado !== 1 ? 's' : ''}
          </span>
          <div className={styles.barra}>
            <div className={styles.barraCheia}
              style={{ width: `${totalEsperado ? (conferidas / totalEsperado) * 100 : 0}%` }} />
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
            placeholder="Bipe cada peça da caixa"
            disabled={salvando}
          />
        </div>

        {retomadoEm && (
          <div className={styles.avisoRetomado}>
            <RotateCcw size={14} />
            <span>
              <strong>Conferência retomada.</strong> Os bipes feitos em{' '}
              {new Date(retomadoEm).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}{' '}
              foram guardados — continue de onde parou.
            </span>
            <button type="button" className={styles.descartar} onClick={descartar} disabled={salvando}>
              Recomeçar
            </button>
          </div>
        )}

        {erro && <div className={styles.erro}><AlertTriangle size={14} />{erro}</div>}
        {!erro && ultimo && <div className={styles.ultimo}><Check size={13} /> {ultimo}</div>}

        <div className={styles.listaWrapper}>
          <table className={styles.lista}>
            <thead>
              <tr>
                <th>Etiqueta</th>
                <th>Peça</th>
                <th className={`${styles.num} col-num`}>Romaneio</th>
                <th className={`${styles.num} col-num`}>Bipado</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {esperados.map(i => {
                const lidas = bipados.get(i.product_id) ?? 0
                const ok = lidas >= i.quantity_sent
                return (
                  <tr key={i.id} className={ok ? styles.linhaOk : ''}>
                    <td className={styles.etiqueta}>
                      {i.barcode_number}
                      {i.reetiquetar && <span className={styles.tagNova}>reetiquetar</span>}
                    </td>
                    <td>
                      <span className={styles.nome}>{i.product_name}</span>
                      <span className={styles.codigo}>{i.product_code}</span>
                    </td>
                    <td className={`${styles.num} col-num`}>{i.quantity_sent}</td>
                    <td className={`${styles.num} col-num`}>{lidas}</td>
                    <td>
                      {ok
                        ? <span className={styles.selOk}><Check size={12} /> conferida</span>
                        : <span className={styles.selFalta}>falta {i.quantity_sent - lidas}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {sobras.length > 0 && (
          <div className={styles.avisoSobra}>
            <AlertTriangle size={14} />
            <span>
              <strong>{sobras.length} etiqueta{sobras.length > 1 ? 's' : ''} fora do romaneio:</strong>{' '}
              {sobras.map(s => `${s.barcode} (${s.nome})`).join(', ')}. Fica registrado na
              transferência para alguém apurar, mas <strong>não entra no estoque</strong> — não dá
              para saber de onde a peça veio.
            </span>
          </div>
        )}

        {faltando.length > 0 && (
          <div className={styles.avisoFalta}>
            <AlertTriangle size={14} />
            <span>
              <strong>{faltando.length} peça{faltando.length > 1 ? 's' : ''} não foi bipada.</strong>{' '}
              Ao confirmar, o saldo delas volta para {romaneio.de} — é a hipótese mais provável
              (não foi embalada) e mantém o total fechado. Se sumiu mesmo, a conferência de estoque
              de {romaneio.de} vai acusar.
            </span>
          </div>
        )}

        <label className={styles.campoObs}>
          <span>
            Observação da conferência
            {temDivergencia && <em className={styles.obrigatorio}> — obrigatória, há divergência</em>}
          </span>
          <input value={obs} onChange={e => setObs(e.target.value)}
            placeholder={temDivergencia ? 'O que aconteceu?' : 'Opcional'} disabled={salvando} />
        </label>

        <div className={styles.rodape}>
          {/* "Sem confirmar", não "sem salvar": os bipes ficam guardados. */}
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Fechar e continuar depois</Button>
          <Button onClick={confirmar} loading={salvando}
            variant={temDivergencia ? 'danger' : 'primary'}>
            {temDivergencia ? 'Confirmar com divergência' : 'Confirmar recebimento'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
