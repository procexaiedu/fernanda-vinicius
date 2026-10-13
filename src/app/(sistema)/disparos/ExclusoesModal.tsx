'use client'

import { useEffect, useMemo, useState } from 'react'
import { Ban, Loader2, Plus, Search, Undo2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { formatarTelefone } from '@/lib/telefone'
import { listarExclusoes, incluirExclusao, retirarExclusao, listarCandidatos, type ExclusaoRow, type Candidato } from './actions'
import type { StoreOption } from './page'
import styles from './ExclusoesModal.module.css'

/*
 * Lista de exclusão de disparo da loja. Só mexe em Disparos: a cliente continua
 * igual na aba Clientes. Retirar não apaga: marca a data e o motivo.
 */

const MOTIVO: Record<string, string> = {
  invalido: 'Sem WhatsApp / inválido', bloqueio: 'Bloqueada', opt_out: 'Pediu para sair', manual: 'Excluída à mão',
  lugar: 'Lugar/empresa', emergencia: 'Emergência/serviço', sem_nome_utilizavel: 'Sem primeiro nome',
}
const ORIGEM: Record<string, string> = {
  webhook: 'automático (falha do WhatsApp)', resposta: 'automático (resposta)', manual: 'manual', historico: 'histórico de envios', limpeza: 'limpeza da lista',
}

interface Props {
  stores: StoreOption[]
  storeId: string
  onClose: () => void
}

export default function ExclusoesModal({ stores, storeId: inicial, onClose }: Props) {
  const [storeId, setStoreId] = useState(inicial)
  const [itens, setItens] = useState<ExclusaoRow[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [retirando, setRetirando] = useState<string | null>(null)
  const [motivoRetirar, setMotivoRetirar] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null)
  const [buscaNova, setBuscaNova] = useState('')
  const [detalhe, setDetalhe] = useState('')

  const [versao, setVersao] = useState(0)
  const carregar = () => setVersao(v => v + 1)
  useEffect(() => {
    let vivo = true
    listarExclusoes(storeId).then(r => {
      if (!vivo) return
      setErro(r.ok ? null : r.error ?? 'Erro ao carregar')
      setItens(r.ok ? r.itens ?? [] : [])
    })
    return () => { vivo = false }
  }, [storeId, versao])

  useEffect(() => {
    if (!adicionando || candidatos) return
    listarCandidatos(storeId).then(r => setCandidatos(r.ok ? r.candidatos ?? [] : []))
  }, [adicionando, candidatos, storeId])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase(), qd = q.replace(/\D/g, '')
    return (itens ?? []).filter(i => !q || (i.nome ?? '').toLowerCase().includes(q) || (qd && i.telefone_e164.includes(qd)))
  }, [itens, busca])

  const sugestoes = useMemo(() => {
    const q = buscaNova.trim().toLowerCase(), qd = q.replace(/\D/g, '')
    if (q.length < 2) return []
    return (candidatos ?? []).filter(c => !c.excluido &&
      (c.name.toLowerCase().includes(q) || (qd.length >= 4 && c.phone.replace(/\D/g, '').includes(qd)))).slice(0, 6)
  }, [candidatos, buscaNova])
  const telAvulso = buscaNova.replace(/\D/g, '')

  async function incluir(p: { customer_id?: string; telefone?: string }) {
    setSalvando(true); setErro(null)
    const r = await incluirExclusao({ store_id: storeId, detalhe, ...p })
    setSalvando(false)
    if (!r.success) { setErro(r.error ?? 'Erro'); return }
    setBuscaNova(''); setDetalhe(''); setAdicionando(false); setCandidatos(null)
    carregar()
  }

  async function retirar(id: string) {
    setSalvando(true); setErro(null)
    const r = await retirarExclusao(id, motivoRetirar)
    setSalvando(false)
    if (!r.success) { setErro(r.error ?? 'Erro'); return }
    setRetirando(null); setMotivoRetirar('')
    carregar()
  }

  return (
    <Modal isOpen onClose={onClose} title="Lista de exclusão de disparo" size="lg">
      <div className={styles.body}>
        <p className={styles.intro}>
          Quem está aqui <b>não recebe disparo</b> desta loja, mesmo se for marcada. O cadastro na aba Clientes não muda.
          Entram sozinhas: número sem WhatsApp, bloqueio e quem responde pedindo para sair (“pare”, “sair”, “não quero”…).
        </p>

        <div className={styles.barra}>
          {stores.length > 1 && (
            <select className={styles.select} value={storeId} onChange={e => { setItens(null); setCandidatos(null); setStoreId(e.target.value) }} aria-label="Loja">
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div className={styles.busca}>
            <Search size={14} />
            <input placeholder="Buscar nome ou telefone…" value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => setAdicionando(a => !a)}><Plus size={14} /> Excluir alguém</Button>
        </div>

        {adicionando && (
          <div className={styles.novo}>
            <input className={styles.input} autoFocus placeholder="Nome da cliente ou telefone" value={buscaNova} onChange={e => setBuscaNova(e.target.value)} />
            <input className={styles.input} placeholder="Motivo (opcional): ex. pediu na loja" value={detalhe} onChange={e => setDetalhe(e.target.value)} />
            {candidatos === null && <div className={styles.muted}><Loader2 size={13} className={styles.spin} /> carregando clientes…</div>}
            {sugestoes.map(c => (
              <button key={c.id} type="button" className={styles.sug} disabled={salvando} onClick={() => incluir({ customer_id: c.id })}>
                <Ban size={13} /> <span className="nome-cliente">{c.name}</span> <small>{formatarTelefone(c.phone)}</small>
              </button>
            ))}
            {(telAvulso.length === 10 || telAvulso.length === 11 || telAvulso.length === 13) && sugestoes.length === 0 && (
              <button type="button" className={styles.sug} disabled={salvando} onClick={() => incluir({ telefone: telAvulso })}>
                <Ban size={13} /> Excluir o telefone {formatarTelefone(telAvulso)}
              </button>
            )}
          </div>
        )}

        {erro && <div className={styles.erro}>{erro}</div>}

        <div className={styles.lista}>
          {itens === null ? (
            <div className={styles.vazio}><Loader2 size={14} className={styles.spin} /> Carregando…</div>
          ) : filtrados.length === 0 ? (
            <div className={styles.vazio}>{itens.length ? 'Nada com essa busca.' : 'Ninguém na lista de exclusão desta loja.'}</div>
          ) : filtrados.map(i => (
            <div key={i.id} className={styles.item}>
              <div className={styles.quem}>
                <span className="nome-cliente">{i.nome ?? 'Sem cadastro'}</span>
                <small>{formatarTelefone(i.telefone_e164)}</small>
              </div>
              <div className={styles.motivo}>
                <span className={styles.tag}>{MOTIVO[i.motivo] ?? i.motivo}</span>
                <small>{ORIGEM[i.origem] ?? i.origem} · {new Date(i.criado_em).toLocaleDateString('pt-BR')}{i.detalhe ? ` · ${i.detalhe}` : ''}</small>
              </div>
              {retirando === i.id ? (
                <div className={styles.retirar}>
                  <input className={styles.input} autoFocus placeholder="Por que retirar?" value={motivoRetirar} onChange={e => setMotivoRetirar(e.target.value)} />
                  <Button size="sm" loading={salvando} disabled={!motivoRetirar.trim()} onClick={() => retirar(i.id)}>Retirar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRetirando(null)}>Cancelar</Button>
                </div>
              ) : (
                <button type="button" className="icon-btn" title="Retirar da lista (volta a receber)" onClick={() => { setRetirando(i.id); setMotivoRetirar('') }}>
                  <Undo2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className={styles.muted}>{itens?.length ?? 0} na lista desta loja.</div>
      </div>
    </Modal>
  )
}
