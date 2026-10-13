'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Search, X, Cake, Ban } from 'lucide-react'
import type { Candidato } from './actions'
import { formatarTelefone } from '@/lib/telefone'
import styles from './DestinatariosPicker.module.css'

/*
 * Escolha de quem recebe (13/10/2026).
 *
 * O padrão é "já comprou na loja": o ban de 16/09 veio de marketing para lista
 * fria (agenda importada). Quem nunca comprou só aparece marcando o filtro de
 * propósito, com aviso. Excluída aparece apagada e não marca; o banco barra de
 * novo no snapshot e no lote, então a tela é só a primeira trava.
 */

export type Publico = 'compraram' | 'todos'
type Ordem = 'recencia' | 'gasto' | 'compras' | 'nome'

export interface Filtros {
  publico: Publico
  diasUltimaCompra: number | null
  minCompras: number
  minGasto: number
  aniversariantes: boolean
  ddds: string[]
  busca: string
}

export const FILTROS_PADRAO: Filtros = {
  publico: 'compraram', diasUltimaCompra: null, minCompras: 1, minGasto: 0,
  aniversariantes: false, ddds: [], busca: '',
}

/** DDD: só dígitos, sem o 55, os 2 primeiros. A base tem formato misto. */
export function dddDe(phone: string): string {
  const d = (phone || '').replace(/\D/g, '').replace(/^55/, '')
  return d.length >= 10 ? d.slice(0, 2) : '—'
}

const MOTIVO: Record<string, string> = {
  invalido: 'sem WhatsApp', bloqueio: 'bloqueada', opt_out: 'pediu p/ sair', manual: 'excluída',
  lugar: 'lugar/empresa', emergencia: 'emergência/serviço', sem_nome_utilizavel: 'sem nome p/ saudar', fixo_sem_whatsapp: 'fixo', estrangeiro: 'estrangeiro',
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const diasDesde = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null

function aplicar(cs: Candidato[], f: Filtros): Candidato[] {
  const mes = new Date().getMonth() + 1
  const q = f.busca.trim().toLowerCase()
  const qd = q.replace(/\D/g, '')
  return cs.filter(c => {
    if (c.compras < (f.publico === 'compraram' ? Math.max(1, f.minCompras) : f.minCompras)) return false
    if (f.minGasto > 0 && c.gasto < f.minGasto) return false
    if (f.diasUltimaCompra != null) {
      const d = diasDesde(c.ultima_compra)
      if (d == null || d > f.diasUltimaCompra) return false
    }
    if (f.aniversariantes && (!c.birthday || Number(c.birthday.slice(5, 7)) !== mes)) return false
    if (f.ddds.length && !f.ddds.includes(dddDe(c.phone))) return false
    if (q && !(c.name.toLowerCase().includes(q) || (qd && (c.phone || '').replace(/\D/g, '').includes(qd)))) return false
    return true
  })
}

function ordenar(cs: Candidato[], o: Ordem): Candidato[] {
  const r = [...cs]
  if (o === 'nome') return r.sort((a, b) => a.name.localeCompare(b.name))
  if (o === 'gasto') return r.sort((a, b) => b.gasto - a.gasto)
  if (o === 'compras') return r.sort((a, b) => b.compras - a.compras || b.gasto - a.gasto)
  return r.sort((a, b) => (b.ultima_compra ?? '').localeCompare(a.ultima_compra ?? ''))
}

interface Props {
  candidatos: Candidato[]
  selecionados: Set<string>
  onChange: (s: Set<string>) => void
  filtros: Filtros
  onFiltros: (f: Filtros) => void
  limiteDia: number | null
  saldoUsd: number | null
  custoMsgUsd: number
}

export default function DestinatariosPicker({ candidatos, selecionados, onChange, filtros: f, onFiltros, limiteDia, saldoUsd, custoMsgUsd }: Props) {
  const [ordem, setOrdem] = useState<Ordem>('recencia')
  const [topN, setTopN] = useState('')
  const [dddDigitando, setDddDigitando] = useState('')
  const set = (p: Partial<Filtros>) => onFiltros({ ...f, ...p })

  const visiveis = useMemo(() => ordenar(aplicar(candidatos, f), ordem), [candidatos, f, ordem])
  const marcaveis = visiveis.filter(c => !c.excluido)
  const excluidosNoFiltro = visiveis.length - marcaveis.length
  const nuncaCompraramSel = candidatos.filter(c => selecionados.has(c.id) && c.compras === 0).length
  const foraDoFiltro = useMemo(() => {
    const vis = new Set(visiveis.map(c => c.id))
    return [...selecionados].filter(id => !vis.has(id)).length
  }, [visiveis, selecionados])

  const ddds = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of candidatos) { const d = dddDe(c.phone); if (d !== '—') m.set(d, (m.get(d) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([ddd, qtd]) => ({ ddd, qtd }))
  }, [candidatos])

  function addDdd(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 2)
    if (d.length === 2 && !f.ddds.includes(d)) set({ ddds: [...f.ddds, d] })
    setDddDigitando('')
  }

  function toggle(c: Candidato) {
    if (c.excluido) return
    const n = new Set(selecionados)
    if (n.has(c.id)) n.delete(c.id); else n.add(c.id)
    onChange(n)
  }
  const adicionarMostrados = () => { const n = new Set(selecionados); marcaveis.forEach(c => n.add(c.id)); onChange(n) }
  const soOsMelhores = () => {
    const n = Math.max(0, Math.floor(Number(topN) || 0))
    if (n) onChange(new Set(marcaveis.slice(0, n).map(c => c.id)))
  }

  const total = selecionados.size
  const passaLimite = limiteDia != null && total > limiteDia
  const custo = total * custoMsgUsd
  const passaSaldo = saldoUsd != null && custo > saldoUsd

  return (
    <div className={styles.box}>
      {/* Público + ordenação */}
      <div className={styles.linha}>
        <div className={styles.seg} role="group" aria-label="Público">
          <button type="button" className={f.publico === 'compraram' ? styles.segOn : ''}
            onClick={() => set({ publico: 'compraram', minCompras: Math.max(1, f.minCompras) })}>Já compraram</button>
          <button type="button" className={f.publico === 'todos' ? styles.segOnRisco : ''}
            onClick={() => set({ publico: 'todos', minCompras: 0 })}>Incluir quem nunca comprou</button>
        </div>
        <label className={styles.ordem}>
          Ordenar
          <select value={ordem} onChange={e => setOrdem(e.target.value as Ordem)} className={styles.select}>
            <option value="recencia">Compra mais recente</option>
            <option value="gasto">Mais gastou</option>
            <option value="compras">Mais compras</option>
            <option value="nome">Nome</option>
          </select>
        </label>
      </div>

      {f.publico === 'todos' && (
        <div className={styles.risco}>
          <AlertTriangle size={14} />
          <span>Quem nunca comprou pode não conhecer a loja e denunciar a mensagem. Foi assim que a conta de Brasília foi bloqueada em 16/09. Prefira só quem já comprou.</span>
        </div>
      )}

      {/* Filtros */}
      <div className={styles.filtros}>
        <label className={styles.filtro}>
          Última compra
          <select className={styles.select} value={f.diasUltimaCompra ?? ''}
            onChange={e => set({ diasUltimaCompra: e.target.value ? Number(e.target.value) : null })}>
            <option value="">qualquer data</option>
            <option value="30">últimos 30 dias</option>
            <option value="90">últimos 3 meses</option>
            <option value="180">últimos 6 meses</option>
            <option value="365">último ano</option>
          </select>
        </label>
        <label className={styles.filtro}>
          Mín. de compras
          <input className={styles.num} type="number" min={f.publico === 'compraram' ? 1 : 0} value={f.minCompras}
            onChange={e => set({ minCompras: Math.max(f.publico === 'compraram' ? 1 : 0, Number(e.target.value) || 0) })} />
        </label>
        <label className={styles.filtro}>
          Gastou ao menos (R$)
          <input className={styles.num} type="number" min={0} step={50} value={f.minGasto || ''}
            placeholder="0" onChange={e => set({ minGasto: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <button type="button" className={`${styles.toggle} ${f.aniversariantes ? styles.toggleOn : ''}`}
          onClick={() => set({ aniversariantes: !f.aniversariantes })}>
          <Cake size={13} /> Aniversariantes do mês
        </button>
      </div>

      {/* DDD + busca */}
      <div className={styles.linha}>
        <div className={styles.ddd}>
          <span className={styles.rot}>DDD</span>
          {f.ddds.map(d => (
            <span key={d} className={styles.chip}>{d}
              <button type="button" onClick={() => set({ ddds: f.ddds.filter(x => x !== d) })} aria-label={`Remover DDD ${d}`}><X size={11} /></button>
            </span>
          ))}
          <input className={styles.dddInput} inputMode="numeric" value={dddDigitando}
            placeholder={f.ddds.length ? 'mais um…' : 'todos'}
            onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); if (v.length === 2) addDdd(v); else setDddDigitando(v) }}
            onKeyDown={e => { if (e.key === 'Backspace' && !dddDigitando && f.ddds.length) set({ ddds: f.ddds.slice(0, -1) }) }} />
          {ddds.filter(d => !f.ddds.includes(d.ddd)).slice(0, 3).map(d => (
            <button key={d.ddd} type="button" className={styles.sug} onClick={() => addDdd(d.ddd)}>+ {d.ddd} <span>{d.qtd}</span></button>
          ))}
        </div>
        <div className={styles.busca}>
          <Search size={14} />
          <input placeholder="Buscar nome ou telefone…" value={f.busca} onChange={e => set({ busca: e.target.value })} />
        </div>
      </div>

      {/* Seleção em massa */}
      <div className={styles.massa}>
        <button type="button" className={styles.primario} onClick={adicionarMostrados} disabled={!marcaveis.length}>
          <Check size={15} /> Marcar os {marcaveis.length} mostrados
        </button>
        <span className={styles.ou}>ou só os</span>
        <input className={styles.num} type="number" min={1} placeholder={String(limiteDia ?? 100)} value={topN}
          onChange={e => setTopN(e.target.value)} aria-label="Quantos melhores" />
        <button type="button" className={styles.sec} onClick={soOsMelhores} disabled={!Number(topN)}>primeiros da lista</button>
        <button type="button" className={styles.sec} onClick={() => onChange(new Set())}>Limpar seleção</button>
      </div>

      {/* Lista */}
      <div className={styles.lista}>
        <div className={styles.cab}>
          <span />
          <span>Cliente</span>
          <span className={styles.n}>Compras</span>
          <span className={styles.n}>Gasto</span>
          <span className={styles.n}>Última</span>
        </div>
        {visiveis.map(c => {
          const on = selecionados.has(c.id)
          const d = diasDesde(c.ultima_compra)
          return (
            <label key={c.id} className={`${styles.item} ${on ? styles.itemOn : ''} ${c.excluido ? styles.itemExcl : ''}`}
              title={c.excluido ? 'Na lista de exclusão: não recebe disparo' : undefined}>
              <input type="checkbox" checked={on && !c.excluido} disabled={!!c.excluido} onChange={() => toggle(c)} />
              <span className={styles.nome}>
                <span className="nome-cliente">{c.name}</span>
                <small>{formatarTelefone(c.phone)}</small>
                {c.excluido && <span className={styles.tagExcl}><Ban size={10} /> {MOTIVO[c.excluido]}</span>}
                {!c.excluido && c.compras === 0 && <span className={styles.tagFria}>nunca comprou</span>}
              </span>
              <span className={styles.n}>{c.compras || '—'}</span>
              <span className={styles.n}>{c.gasto ? brl(c.gasto) : '—'}</span>
              <span className={styles.n}>{d == null ? '—' : d === 0 ? 'hoje' : `${d} d`}</span>
            </label>
          )
        })}
        {visiveis.length === 0 && <div className={styles.vazio}>Ninguém com esses filtros.</div>}
      </div>

      {/* Contador */}
      <div className={styles.rodape}>
        <span className={styles.muted}>
          {visiveis.length} mostrado(s){excluidosNoFiltro ? ` · ${excluidosNoFiltro} na lista de exclusão` : ''}
          {foraDoFiltro ? ` · +${foraDoFiltro} marcado(s) fora do filtro` : ''}
        </span>
        <span className={styles.conta}>
          <strong className={passaLimite ? styles.ruim : ''}>{total}</strong>
          {limiteDia != null ? <> / {limiteDia} por dia</> : ' selecionado(s)'}
          <span className={styles.sep}>·</span>
          ≈ US$ {custo.toFixed(2)}
          {saldoUsd != null ? <> de US$ {saldoUsd.toFixed(2)}</> : <> (saldo não lido)</>}
        </span>
      </div>
      {passaLimite && (
        <div className={styles.risco}>
          <AlertTriangle size={14} />
          <span>O número só pode iniciar {limiteDia} conversas por dia. Acima disso a Meta recusa e a qualidade do número cai. Reduza a seleção ou divida em dias.</span>
        </div>
      )}
      {passaSaldo && (
        <div className={styles.risco}>
          <AlertTriangle size={14} />
          <span>O saldo da YCloud não cobre este envio. As mensagens a mais falham por saldo (não excluem ninguém). Peça a recarga antes de enviar.</span>
        </div>
      )}
      {nuncaCompraramSel > 0 && (
        <div className={styles.risco}>
          <AlertTriangle size={14} />
          <span>{nuncaCompraramSel} selecionada(s) nunca compraram nesta loja.</span>
        </div>
      )}
    </div>
  )
}
