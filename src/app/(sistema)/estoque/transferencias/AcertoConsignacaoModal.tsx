'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import { formatarDinheiro } from '@/lib/dinheiro'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'
import { acertoConsignacao, type AcertoConsignacao } from './actions'
import type { Romaneio } from './page'
import base from './ConferenciaModal.module.css'
import styles from './AcertoConsignacaoModal.module.css'

/**
 * Acerto da consignação entre lojas (05/10/2026).
 *
 * "A diferença (o que não voltou) tem que gerar o valor a pagar para
 * Campinas." Por peça: ficou = recebido na chegada − devolvido. O que faltou na
 * ida não é cobrado (nunca chegou); o que faltou na volta aparece à parte para
 * a admin decidir. Confirmar lança UMA conta a pagar pendente na loja de
 * destino. Tela só de admin: mostra custo.
 */
export default function AcertoConsignacaoModal({ romaneio, onClose, onAcertado }: {
  romaneio: Romaneio
  onClose: () => void
  onAcertado: () => void
}) {
  const [previa, setPrevia] = useState<AcertoConsignacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [vencimento, setVencimento] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const r = await acertoConsignacao(romaneio.id, false)
        if (!vivo) return
        if (!r.success) { setErro(r.error ?? 'Não consegui calcular o acerto.'); return }
        setPrevia(r.acerto!)
      } catch (e) {
        if (vivo) setErro(mensagemDeErroAoSalvar(e))
      }
    })()
    return () => { vivo = false }
  }, [romaneio.id])

  async function confirmar() {
    setSalvando(true)
    setErro(null)
    try {
      const r = await acertoConsignacao(romaneio.id, true, vencimento)
      if (!r.success) { setErro(r.error ?? 'Erro no acerto.'); return }
      onAcertado()
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
    } finally {
      setSalvando(false)
    }
  }

  const res = previa?.resumo
  const ficaram = previa?.itens.filter(i => i.ficou > 0) ?? []

  return (
    <Modal isOpen title={`Acerto da consignação — ${romaneio.de} → ${romaneio.para}`} size="xl" onClose={onClose}>
      <div className={base.corpo}>
        {erro && <div className={base.erro}><AlertTriangle size={14} />{erro}</div>}

        {!previa && !erro && <p className={styles.carregando}>Calculando o que ficou em {romaneio.para}…</p>}

        {res && (
          <>
            <div className={styles.resumo}>
              <div><span>Enviadas</span><strong>{res.pecas_enviadas}</strong></div>
              <div><span>Devolvidas</span><strong>{res.pecas_devolvidas}</strong></div>
              <div><span>Ficaram em {res.para}</span><strong>{res.pecas_ficaram}</strong></div>
              <div className={styles.valor}>
                <span>A pagar para {res.de} (preço de {res.criterio})</span>
                <strong>{formatarDinheiro(res.valor)}</strong>
              </div>
            </div>

            {(res.faltou_na_ida > 0 || res.faltou_na_volta > 0) && (
              <p className={styles.aviso}>
                {res.faltou_na_ida > 0 && <>{res.faltou_na_ida} peça(s) faltaram na chegada a {res.para} e não entram na conta. </>}
                {res.faltou_na_volta > 0 && <>{res.faltou_na_volta} peça(s) saíram de {res.para} na devolução e não chegaram a {res.de}: confira antes de fechar.</>}
              </p>
            )}

            {ficaram.length > 0 && (
              <div className={base.listaWrapper}>
                <table className={base.lista}>
                  <thead>
                    <tr>
                      <th>Etiqueta</th>
                      <th>Peça</th>
                      <th className={base.num}>Recebidas</th>
                      <th className={base.num}>Devolvidas</th>
                      <th className={base.num}>Ficaram</th>
                      <th className={base.num}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficaram.map(i => (
                      <tr key={i.etiqueta + i.peca}>
                        <td className={base.etiqueta}>{i.etiqueta}</td>
                        <td>{i.peca}</td>
                        <td className={base.num}>{i.recebido}</td>
                        <td className={base.num}>{i.devolvido}</td>
                        <td className={base.num}>{i.ficou}</td>
                        <td className={base.num}>{formatarDinheiro(i.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <label className={styles.vencimento}>
              <span>Vencimento da conta a pagar</span>
              <DatePicker value={vencimento} onChange={setVencimento} />
            </label>
          </>
        )}

        <div className={base.rodape}>
          <span className={styles.nota}>
            {res && res.valor > 0
              ? `Lança uma conta a pagar pendente em ${res.para}. Depois disso a consignação não recebe mais devolução.`
              : 'Nada ficou: o acerto só encerra a consignação.'}
          </span>
          <div className={base.acoes}>
            <Button variant="ghost" onClick={onClose} disabled={salvando}>Voltar</Button>
            <Button onClick={confirmar} loading={salvando} disabled={!previa || salvando}>
              Fechar acerto
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
