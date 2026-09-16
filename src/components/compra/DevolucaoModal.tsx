'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Minus, Plus, ScanLine, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { formatarDinheiro } from '@/lib/dinheiro'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'
import { buscarPecaDoLote, devolverPecas } from '@/app/(sistema)/compras/acertos'
import styles from './DevolucaoModal.module.css'

/**
 * Devolver à fornecedora as peças que não venderam.
 *
 * O desenho é dela, de 15/09:
 *
 *   — "Eu não faço por valor, eu faço por peça, Felipe. Assim por valor pra mim
 *      não é legal, eu tenho que saber a peça."
 *   — "Eu não posso bipar as peças que eu vou devolver?"
 *   — "Bipar ou digitar, porque eu vou ter que ficar procurando. Eu vou estar
 *      com as peças na mão."
 *
 * Daí as duas entradas (leitor e teclado) e nenhuma busca por lista: com a peça
 * na mão e 46 linhas na tela, procurar é o que faz alguém desistir.
 *
 * O valor some do saldo sozinho — "aí ele vai descontar desse valor". Quem
 * calcula é o servidor, a partir do rastro da baixa de estoque.
 */

interface Linha {
  id: string
  nome: string
  code: string
  barcode_number: string
  saldo: number
  custo: number
  quantidade: number
}

/** Duas leituras do mesmo código em menos disto é o leitor repetindo. */
const MS_LEITURA_DUPLA = 1500

export default function DevolucaoModal({ consignmentId, falta, onFechar, onDevolvido }: {
  consignmentId: string
  /** Quanto ainda se deve — para mostrar como fica depois da devolução. */
  falta: number
  onFechar: () => void
  onDevolvido: () => void
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [digitado, setDigitado] = useState('')
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [falhas, setFalhas] = useState<Array<{ nome: string; erro: string }>>([])

  const campoRef = useRef<HTMLInputElement>(null)
  const ultimaLeitura = useRef<Map<string, number>>(new Map())

  useEffect(() => { campoRef.current?.focus() }, [])

  /* Uma porta só para leitor e teclado: a regra (é do lote? tem saldo? já está
     na lista?) não pode depender de como o código chegou. */
  const registrar = useCallback(async (codigo: string) => {
    const cod = codigo.trim()
    if (!cod) return

    const agora = Date.now()
    if (agora - (ultimaLeitura.current.get(cod) ?? 0) < MS_LEITURA_DUPLA) return
    ultimaLeitura.current.set(cod, agora)

    setErro(null)
    const r = await buscarPecaDoLote(consignmentId, cod)
    if (!r.success) { setErro(r.error); setUltimo(null); return }

    setLinhas(atual => {
      const i = atual.findIndex(l => l.id === r.peca.id)
      if (i === -1) return [{ ...r.peca, quantidade: 1 }, ...atual]
      // Já na lista: bipar de novo soma mais uma, até o saldo.
      const copia = [...atual]
      copia[i] = { ...copia[i], quantidade: Math.min(copia[i].quantidade + 1, copia[i].saldo) }
      return copia
    })
    setUltimo(`${r.peca.nome} · ${r.peca.barcode_number}`)
  }, [consignmentId])

  useBarcodeScanner({ onScan: registrar, ativo: !enviando })

  function ajustar(id: string, delta: number) {
    setLinhas(atual => atual.map(l =>
      l.id === id
        ? { ...l, quantidade: Math.max(1, Math.min(l.quantidade + delta, l.saldo)) }
        : l,
    ))
  }

  const pecas = linhas.reduce((s, l) => s + l.quantidade, 0)
  const valor = linhas.reduce((s, l) => s + l.custo * l.quantidade, 0)
  const faltaDepois = Math.max(0, falta - valor)

  async function confirmar() {
    setEnviando(true)
    setErro(null)
    setFalhas([])

    let r: Awaited<ReturnType<typeof devolverPecas>>
    try {
      r = await devolverPecas(
        consignmentId,
        linhas.map(l => ({ productId: l.id, quantidade: l.quantidade })),
        obs,
      )
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
      return
    } finally {
      setEnviando(false)
    }

    if (!r.success) {
      setErro(r.error ?? 'Erro ao devolver.')
      setFalhas(r.falhas ?? [])
      return
    }

    /* Devolução parcial não pode passar por sucesso limpo: ela precisa saber
       exatamente qual peça NÃO saiu do sistema antes de entregar a caixa. */
    if (r.falhas?.length) {
      setFalhas(r.falhas)
      setLinhas([])
      onDevolvido()
      return
    }

    onDevolvido()
    onFechar()
  }

  return (
    <Modal isOpen title="Devolver peças à fornecedora" size="lg" onClose={onFechar}>
      <div className={styles.corpo}>
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

        {erro && <div className={styles.erro}><AlertTriangle size={14} />{erro}</div>}
        {!erro && ultimo && <div className={styles.ultimo}>Última leitura: {ultimo}</div>}

        {falhas.length > 0 && (
          <div className={styles.erro}>
            <AlertTriangle size={14} />
            <span>
              <strong>Estas não foram devolvidas</strong> e continuam no estoque:
              {' '}{falhas.map(f => `${f.nome} (${f.erro})`).join('; ')}.
            </span>
          </div>
        )}

        {linhas.length === 0 ? (
          <div className={styles.vazio}>Bipe as peças que estão voltando para a fornecedora.</div>
        ) : (
          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Etiqueta</th>
                  <th>Peça</th>
                  <th className={styles.num}>Devolver</th>
                  <th className={styles.num}>Em estoque</th>
                  <th className={styles.num}>Custo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => (
                  <tr key={l.id}>
                    <td className={styles.etiqueta}>{l.barcode_number}</td>
                    <td>
                      <span className={styles.nome}>{l.nome}</span>
                      <span className={styles.codigo}>{l.code}</span>
                    </td>
                    <td className={styles.num}>
                      <div className={styles.stepper}>
                        <button type="button" onClick={() => ajustar(l.id, -1)}
                          disabled={l.quantidade <= 1 || enviando} aria-label="Menos um">
                          <Minus size={12} />
                        </button>
                        <span>{l.quantidade}</span>
                        <button type="button" onClick={() => ajustar(l.id, 1)}
                          disabled={l.quantidade >= l.saldo || enviando} aria-label="Mais um">
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    <td className={styles.num}>{l.saldo}</td>
                    <td className={styles.num}>{formatarDinheiro(l.custo * l.quantidade)}</td>
                    <td>
                      <button type="button" className={styles.remover} disabled={enviando}
                        onClick={() => setLinhas(a => a.filter(x => x.id !== l.id))}
                        aria-label="Tirar da devolução">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label className={styles.campoObs}>
          <span>Observação (opcional)</span>
          <input value={obs} onChange={e => setObs(e.target.value)}
            placeholder="Ex.: devolvido pelo motoboy, 16/09" disabled={enviando} />
        </label>

        <div className={styles.rodape}>
          <div className={styles.totais}>
            <span><strong>{pecas}</strong> peça{pecas !== 1 ? 's' : ''}</span>
            <span>Abate <strong>{formatarDinheiro(valor)}</strong></span>
            {/* O número que ela quer ver antes de confirmar: quanto sobra para pagar. */}
            <span className={styles.depois}>
              Falta depois <strong>{formatarDinheiro(faltaDepois)}</strong>
            </span>
          </div>
          <div className={styles.acoes}>
            <Button variant="ghost" onClick={onFechar} disabled={enviando}>Cancelar</Button>
            <Button onClick={confirmar} loading={enviando} disabled={linhas.length === 0}>
              Devolver {pecas > 0 ? `${pecas} peça${pecas !== 1 ? 's' : ''}` : ''}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
