'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import EtiquetasPrinter, { type EtiquetasPrinterItem } from '@/components/etiquetas/EtiquetasPrinter'
import { formatarDinheiro } from '@/lib/dinheiro'
import { consultarPecasRomaneio, corrigirPrecoPeca, etiquetaPersistidaRomaneio, type PecaRomaneio } from './pecasActions'
import styles from './PecasRomaneio.module.css'

export default function PecasRomaneio({ transferId, isAdmin, onClose }: {
  transferId: string; isAdmin: boolean; onClose: () => void
}) {
  const router = useRouter()
  const [pecas, setPecas] = useState<PecaRomaneio[]>([])
  const [precos, setPrecos] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [etiqueta, setEtiqueta] = useState<EtiquetasPrinterItem | null>(null)

  useEffect(() => {
    let ativo = true
    consultarPecasRomaneio(transferId).then(p => {
      if (!ativo) return
      setPecas(p)
      setPrecos(Object.fromEntries(p.map(i => [i.id, i.precoVenda.toFixed(2).replace('.', ',')])))
    }).catch(() => { if (ativo) setErro('Não foi possível consultar as peças. Feche e tente novamente.') })
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [transferId])

  async function salvar(p: PecaRomaneio) {
    setErro(''); setAviso('')
    const texto = precos[p.id]?.trim() ?? ''
    if (!/^\d+(?:[,.]\d{1,2})?$/.test(texto)) {
      setErro('Informe o preço sem separador de milhar, por exemplo: 237,00.'); return
    }
    if (!p.versao) return
    setOcupado(true)
    try {
      const r = await corrigirPrecoPeca(transferId, p.id, Number(texto.replace(',', '.')), p.versao)
      if (!r.success) { setErro(r.error ?? 'Não foi possível salvar.'); return }
      const atuais = await consultarPecasRomaneio(transferId)
      setPecas(atuais)
      setPrecos(Object.fromEntries(atuais.map(i => [i.id, i.precoVenda.toFixed(2).replace('.', ',')])))
      setAviso(`Preço salvo. Etiqueta atual: ${formatarDinheiro(r.effective_price ?? 0)}. Reimprima abaixo.`)
      router.refresh()
    } catch { setErro('Não foi possível confirmar o resultado. Reabra os itens antes de tentar novamente.') }
    finally { setOcupado(false) }
  }

  async function imprimir(p: PecaRomaneio) {
    setErro(''); setOcupado(true)
    try { setEtiqueta(await etiquetaPersistidaRomaneio(transferId, p.id)) }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível preparar a etiqueta.') }
    finally { setOcupado(false) }
  }

  return <>
    <Modal isOpen title="Fotos e itens do romaneio" size="xl" onClose={() => { if (!ocupado) onClose() }}>
      <div className={styles.conteudo} data-novidade="pecas-romaneio">
        <p>O preço do romaneio registra o envio. A reimpressão consulta o cadastro atual da peça.</p>
        {carregando && <p role="status">Consultando peças…</p>}
        {erro && <p role="alert" className={styles.erro}>{erro}</p>}
        {aviso && <p role="status" className={styles.sucesso}>{aviso}</p>}
        {!carregando && !erro && pecas.length === 0 && <p>Nenhuma peça neste romaneio.</p>}
        {pecas.map(p => {
          const novo = Number((precos[p.id] ?? '').replace(',', '.'))
          const efetivo = p.promocaoAtiva ? p.precoPromocional : novo
          const alterado = novo !== p.precoVenda
          return <article key={p.id} className={styles.peca}>
            <div className={styles.foto}>
              {/* A foto é do cadastro atual, não um snapshot histórico do envio. */}
              {p.foto ? <a href={p.foto} target="_blank" rel="noreferrer"><img src={p.foto} alt={`Foto de ${p.nome}`} /></a>
                : <span>Sem foto cadastrada</span>}
            </div>
            <div className={styles.dados}>
              <h3>{p.nome}</h3><p>Etiqueta {p.etiqueta}</p>
              <p>Preço no romaneio: <strong>{p.precoRomaneio == null ? 'Não registrado' : formatarDinheiro(p.precoRomaneio)}</strong></p>
              {isAdmin && <>
                <p>Etiqueta atual: <strong>{formatarDinheiro(p.precoEtiqueta)}</strong></p>
                {p.promocaoAtiva && <p className={styles.promocao}>Promoção ativa: {formatarDinheiro(p.precoPromocional ?? 0)}. A promoção será mantida e continua valendo na etiqueta.</p>}
                {p.bloqueio ? <p className={styles.bloqueio}>{p.bloqueio}</p> : <form onSubmit={e => { e.preventDefault(); void salvar(p) }}>
                  <label htmlFor={`preco-${p.id}`}>Preço de venda (R$)</label>
                  <input id={`preco-${p.id}`} inputMode="decimal" value={precos[p.id] ?? ''} disabled={ocupado}
                    onChange={e => setPrecos(v => ({ ...v, [p.id]: e.target.value }))} />
                  <p>Ao salvar, etiqueta: <strong>{Number.isFinite(efetivo) && Number(efetivo) > 0 ? formatarDinheiro(Number(efetivo)) : 'Informe um preço válido'}</strong></p>
                  <Button size="sm" type="submit" disabled={ocupado || !alterado}>Salvar preço</Button>
                </form>}
                {alterado && !p.bloqueio && <p>Salve a alteração antes de reimprimir.</p>}
                <Button size="sm" variant="outline" disabled={ocupado || (alterado && !p.bloqueio)} onClick={() => void imprimir(p)}>
                  Reimprimir etiqueta
                </Button>
              </>}
              {!isAdmin && <p>{p.bloqueio}</p>}
            </div>
          </article>
        })}
      </div>
    </Modal>
    {etiqueta && <EtiquetasPrinter isOpen title="Reimprimir etiqueta atualizada" initialItems={[etiqueta]} onClose={() => setEtiqueta(null)} />}
  </>
}
