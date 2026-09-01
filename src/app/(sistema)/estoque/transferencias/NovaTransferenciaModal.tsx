'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Minus, Plus, ScanLine, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { formatarDinheiro } from '@/lib/dinheiro'
import { buscarPecaPorCodigo, enviarTransferencia, type PecaBipada } from './actions'
import type { LojaOption } from './page'
import styles from './NovaTransferenciaModal.module.css'

interface Linha extends PecaBipada {
  quantidade: number
}

/** Duas leituras da mesma peça em menos disto é o leitor repetindo, não a pessoa bipando de novo. */
const MS_LEITURA_DUPLA = 1500

export default function NovaTransferenciaModal({ lojas, lojaPadrao, onClose, onEnviado }: {
  lojas: LojaOption[]
  lojaPadrao: string | null
  onClose: () => void
  onEnviado: (transferId: string) => void
}) {
  const router = useRouter()

  const [origem, setOrigem]   = useState(lojaPadrao ?? lojas[0]?.id ?? '')
  const [destino, setDestino] = useState(
    lojas.find(l => l.id !== (lojaPadrao ?? lojas[0]?.id))?.id ?? '',
  )
  const [linhas, setLinhas]   = useState<Linha[]>([])
  const [obs, setObs]         = useState('')
  const [erro, setErro]       = useState<string | null>(null)
  const [ultimo, setUltimo]   = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

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
   * Trocar a origem esvazia a lista.
   *
   * As peças já bipadas pertencem à loja anterior; deixá-las na tela e mandar
   * enviaria peça de Campinas num romaneio que diz "saiu de Brasília". A função
   * do banco recusaria, mas só depois de a pessoa ter bipado a caixa inteira.
   */
  function trocarOrigem(nova: string) {
    setOrigem(nova)
    setLinhas([])
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
  const parciais = linhas.filter(l => l.quantidade < l.quantity_in_stock)

  async function enviar() {
    setEnviando(true)
    setErro(null)

    const r = await enviarTransferencia({
      from_store_id: origem,
      to_store_id:   destino,
      itens: linhas.map(l => ({ product_id: l.id, quantity: l.quantidade })),
      notes: obs,
    })

    setEnviando(false)
    if (!r.success) { setErro(r.error ?? 'Erro ao enviar.'); return }

    router.refresh()
    onEnviado(r.transfer_id!)
  }

  return (
    <Modal isOpen title="Nova transferência" size="xl" onClose={onClose}>
      <div className={styles.corpo}>
        <div className={styles.rotas}>
          <label className={styles.campo}>
            <span>De</span>
            <select value={origem} onChange={e => trocarOrigem(e.target.value)} disabled={enviando}>
              {lojas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <span className={styles.seta}>→</span>
          <label className={styles.campo}>
            <span>Para</span>
            <select value={destino} onChange={e => setDestino(e.target.value)} disabled={enviando}>
              {lojas.filter(l => l.id !== origem).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
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
            <span><strong>{linhas.length}</strong> {linhas.length === 1 ? 'item' : 'itens'}</span>
            <span>Custo <strong>{formatarDinheiro(custo)}</strong></span>
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
