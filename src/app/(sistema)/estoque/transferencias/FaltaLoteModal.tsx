'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { formatarDinheiro } from '@/lib/dinheiro'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'
import { decidirFaltaDoLote, type FaltaDoLote } from './actions'
import type { Romaneio } from './page'
import base from './ConferenciaModal.module.css'
import styles from './AcertoConsignacaoModal.module.css'

/**
 * Falta na conferência de uma remessa de compra (12/10/2026).
 *
 * Pedido da Eleandra: quando a peça da compra não chega, avisar e perguntar se
 * o valor dela deve ser descontado. Descontar abate das parcelas pendentes da
 * fornecedora (o que já foi pago vira crédito a receber); na consignação,
 * reduz o que se deve do lote. Não descontar só registra a decisão. Tela só de
 * admin: mostra custo.
 */
export default function FaltaLoteModal({ romaneio, onClose, onDecidido }: {
  romaneio: Romaneio
  onClose: () => void
  onDecidido: () => void
}) {
  const [falta, setFalta] = useState<FaltaDoLote | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<'descontar' | 'manter' | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const r = await decidirFaltaDoLote(romaneio.id, false)
        if (!vivo) return
        if (!r.success) { setErro(r.error ?? 'Não consegui calcular a falta.'); return }
        setFalta(r.falta!)
      } catch (e) {
        if (vivo) setErro(mensagemDeErroAoSalvar(e))
      }
    })()
    return () => { vivo = false }
  }, [romaneio.id])

  async function decidir(descontar: boolean) {
    setSalvando(descontar ? 'descontar' : 'manter')
    setErro(null)
    try {
      const r = await decidirFaltaDoLote(romaneio.id, true, descontar)
      if (!r.success) { setErro(r.error ?? 'Erro ao decidir.'); return }
      onDecidido()
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
    } finally {
      setSalvando(null)
    }
  }

  const credito = falta?.fornecedoras.reduce((s, f) => s + f.credito, 0) ?? 0

  return (
    <Modal isOpen title={`Faltaram peças da compra — ${romaneio.para}`} size="xl" onClose={onClose}>
      <div className={base.corpo}>
        {erro && <div className={base.erro}><AlertTriangle size={14} />{erro}</div>}

        {!falta && !erro && <p className={styles.carregando}>Calculando o valor das peças que faltaram…</p>}

        {falta && (
          <>
            <div className={styles.resumo}>
              <div><span>Peças que não chegaram</span><strong>{falta.pecas}</strong></div>
              <div className={styles.valor}>
                <span>Valor dessas peças (custo)</span>
                <strong>{formatarDinheiro(falta.valor)}</strong>
              </div>
            </div>

            <div className={base.listaWrapper}>
              <table className={base.lista}>
                <thead>
                  <tr>
                    <th>Etiqueta</th>
                    <th>Peça</th>
                    <th>Fornecedor</th>
                    <th className={base.num}>Faltou</th>
                    <th className={base.num}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {falta.itens.map(i => (
                    <tr key={i.etiqueta + i.peca}>
                      <td className={base.etiqueta}>{i.etiqueta}</td>
                      <td>{i.peca}</td>
                      <td>{i.fornecedor}</td>
                      <td className={base.num}>{i.faltou}</td>
                      <td className={base.num}>{formatarDinheiro(i.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.aviso}>
              {falta.consignacao
                ? <>Descontar tira {formatarDinheiro(falta.valor)} do valor devido ao fornecedor nesta consignação.</>
                : <>
                    Descontar abate {formatarDinheiro(falta.valor - credito)} das parcelas ainda pendentes desta compra
                    (da última para a primeira)
                    {credito > 0 && <>; {formatarDinheiro(credito)} já estavam pagos e entram no Financeiro como crédito a receber do fornecedor</>}.
                  </>}
            </p>
          </>
        )}

        <div className={base.rodape}>
          <span className={styles.nota}>A decisão fica anotada na compra e não pode ser refeita aqui.</span>
          <div className={base.acoes}>
            <Button variant="ghost" onClick={onClose} disabled={!!salvando}>Decidir depois</Button>
            <Button variant="ghost" onClick={() => decidir(false)} loading={salvando === 'manter'}
              disabled={!falta || !!salvando}>
              Não descontar
            </Button>
            <Button onClick={() => decidir(true)} loading={salvando === 'descontar'} disabled={!falta || !!salvando}>
              Descontar {falta ? formatarDinheiro(falta.valor) : ''}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
