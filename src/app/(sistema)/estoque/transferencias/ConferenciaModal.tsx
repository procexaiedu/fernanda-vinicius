'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ScanLine } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { identificarEtiqueta, receberTransferencia } from './actions'
import type { Romaneio } from './page'
import styles from './ConferenciaModal.module.css'

const MS_LEITURA_DUPLA = 1500

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

  // product_id -> quantas unidades foram bipadas
  const [bipados, setBipados] = useState<Map<string, number>>(new Map())
  /*
   * Sobra precisa de `product_id` para virar registro na transferência: a
   * função do banco grava um item de sobra referenciando o produto. Guardar só
   * a string da etiqueta deixaria a sobra fora do banco, viva apenas na tela.
   * Etiqueta que não existe em `products` fica com `id: null` — essa não dá
   * para registrar, só descrever na observação.
   */
  const [sobras, setSobras] = useState<{ barcode: string; id: string | null; nome: string }[]>([])
  const [obs, setObs]         = useState('')
  const [erro, setErro]       = useState<string | null>(null)
  const [ultimo, setUltimo]   = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [digitado, setDigitado] = useState('')

  const campoRef = useRef<HTMLInputElement>(null)
  const ultimaLeitura = useRef<Map<string, number>>(new Map())

  useEffect(() => { campoRef.current?.focus() }, [])

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
      const achada = await identificarEtiqueta(cod)
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
  }, [porEtiqueta])

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
    const r = await receberTransferencia(
      romaneio.id,
      [
        ...[...bipados.entries()].map(([product_id, quantity]) => ({ product_id, quantity })),
        ...sobras.filter(s => s.id).map(s => ({ product_id: s.id!, quantity: 1 })),
      ],
      obs,
    )

    setSalvando(false)
    if (!r.success) { setErro(r.error ?? 'Erro ao confirmar.'); return }

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
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Fechar sem confirmar</Button>
          <Button onClick={confirmar} loading={salvando}
            variant={temDivergencia ? 'danger' : 'primary'}>
            {temDivergencia ? 'Confirmar com divergência' : 'Confirmar recebimento'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
