'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CheckCheck, AlertTriangle, Undo2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import { formatarDinheiro } from '@/lib/dinheiro'
import { rotuloBandeira } from '@/lib/taxasCartao'
import {
  buscarFluxo, buscarRecebimentos, conciliarRecebimentos,
  type DiaFluxo, type Recebimento,
} from './fluxo'
import styles from './FluxoCaixaTab.module.css'

/**
 * Quanto cai em cada data. Pix e dinheiro no dia; cartão parcela a parcela, já
 * sem a taxa da maquininha; despesas no vencimento. Embaixo, a conciliação da
 * semana: a gestora marca o que caiu ou informa o valor que caiu de fato.
 */

type Modo = 'semana' | 'mes'

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function hojeSP() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
function addDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function dow(iso: string) { return new Date(`${iso}T12:00:00Z`).getUTCDay() }
function segundaDe(iso: string) { return addDias(iso, -((dow(iso) + 6) % 7)) }
function fmtData(iso: string) { const [, m, d] = iso.split('-'); return `${d}/${m}` }

function periodo(modo: Modo, ancora: string): { de: string; ate: string; rotulo: string } {
  if (modo === 'semana') {
    const de = segundaDe(ancora)
    const ate = addDias(de, 6)
    return { de, ate, rotulo: `${fmtData(de)} a ${fmtData(ate)}` }
  }
  const [a, m] = ancora.split('-').map(Number)
  const ultimo = new Date(a, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  return { de: `${a}-${mm}-01`, ate: `${a}-${mm}-${ultimo}`, rotulo: `${MESES[m - 1]} ${a}` }
}

function mover(modo: Modo, ancora: string, passo: 1 | -1) {
  if (modo === 'semana') return addDias(ancora, 7 * passo)
  const [a, m] = ancora.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + passo, 1, 12))
  return d.toISOString().slice(0, 10)
}

const STATUS: Record<Recebimento['status'], string> = { previsto: 'Previsto', recebido: 'Recebido', divergente: 'Divergente' }

export default function FluxoCaixaTab() {
  const [modo, setModo] = useState<Modo>('semana')
  const [ancora, setAncora] = useState(hojeSP())
  const p = useMemo(() => periodo(modo, ancora), [modo, ancora])

  const [dias, setDias] = useState<DiaFluxo[] | null>(null)
  const [recs, setRecs] = useState<Recebimento[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [informando, setInformando] = useState<string | null>(null)
  const [valorInf, setValorInf] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    setDias(null)
    setRecs(null)
    setSel(new Set())
    const [f, r] = await Promise.all([buscarFluxo(p.de, p.ate), buscarRecebimentos(p.de, p.ate)])
    if (!f.ok) return setErro(f.erro)
    if (!r.ok) return setErro(r.erro)
    setDias(f.dados)
    setRecs(r.dados)
  }, [p.de, p.ate])

  useEffect(() => { carregar() }, [carregar])

  const totais = useMemo(() => {
    const t = { entradas: 0, taxa: 0, saidas: 0, semTaxa: 0 }
    for (const d of dias ?? []) {
      t.entradas += d.pixDinheiro + d.cartaoLiquido + d.outrasEntradas
      t.taxa += d.cartaoTaxa
      t.saidas += d.saidas
    }
    t.semTaxa = (recs ?? []).filter(r => r.taxaPct === null).length
    return t
  }, [dias, recs])

  const linhas = useMemo(() => {
    const base = (dias ?? []).map(d => {
      const entra = d.pixDinheiro + d.cartaoLiquido + d.outrasEntradas
      return { ...d, entra, saldo: entra - d.saidas, vazio: entra === 0 && d.saidas === 0 }
    })
    const comAcumulado = base.map((d, i) => ({
      ...d,
      acc: base.slice(0, i + 1).reduce((s, x) => s + x.saldo, 0),
    }))
    return comAcumulado.filter(d => modo === 'semana' || !d.vazio)
  }, [dias, modo])

  const pendentes = (recs ?? []).filter(r => r.status === 'previsto')
  const hoje = hojeSP()

  async function marcar(ids: string[]) {
    setSalvando(true)
    const res = await conciliarRecebimentos({ ids })
    setSalvando(false)
    if (!res.ok) return setErro(res.erro ?? 'Não consegui salvar.')
    carregar()
  }

  async function informar(id: string) {
    const v = Number(valorInf.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(v) || v < 0 || valorInf.trim() === '') return setErro('Informe o valor que caiu (ex.: 32,41).')
    setSalvando(true)
    const res = await conciliarRecebimentos({ ids: [id], valor: v })
    setSalvando(false)
    if (!res.ok) return setErro(res.erro ?? 'Não consegui salvar.')
    setInformando(null)
    setValorInf('')
    carregar()
  }

  async function desfazer(id: string) {
    setSalvando(true)
    const res = await conciliarRecebimentos({ ids: [id], desfazer: true })
    setSalvando(false)
    if (!res.ok) return setErro(res.erro ?? 'Não consegui desfazer.')
    carregar()
  }

  function alternar(id: string) {
    setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  return (
    <div className={styles.aba}>
      <div className={styles.topo}>
        <div className={styles.nav}>
          <button type="button" className={styles.navBtn} aria-label="Anterior" onClick={() => setAncora(a => mover(modo, a, -1))}>
            <ChevronLeft size={15} />
          </button>
          <span className={styles.navLabel}>{p.rotulo}</span>
          <button type="button" className={styles.navBtn} aria-label="Próximo" onClick={() => setAncora(a => mover(modo, a, 1))}>
            <ChevronRight size={15} />
          </button>
          <button type="button" className={styles.hojeBtn} onClick={() => setAncora(hojeSP())}>Hoje</button>
        </div>
        <div className={styles.modos} role="group" aria-label="Período">
          {(['semana', 'mes'] as const).map(m => (
            <button key={m} type="button" data-ativo={modo === m} onClick={() => setModo(m)}>
              {m === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>
      </div>

      {erro && <div className={styles.erro} role="alert">{erro}</div>}

      <div className={styles.placar}>
        <div className={styles.item}>
          <span className={styles.rotulo}>Entra no período</span>
          <strong className={styles.valor}>{dias ? formatarDinheiro(totais.entradas) : '…'}</strong>
          <span className={styles.nota}>Pix, dinheiro e cartão já sem a taxa</span>
        </div>
        <div className={styles.item}>
          <span className={styles.rotulo}>Taxa da maquininha</span>
          <strong className={`${styles.valor} ${styles.neg}`}>{dias ? formatarDinheiro(totais.taxa) : '…'}</strong>
          <span className={styles.nota}>
            {totais.semTaxa > 0 ? `${totais.semTaxa} parcela(s) sem taxa cadastrada` : 'descontada das parcelas'}
          </span>
        </div>
        <div className={styles.item}>
          <span className={styles.rotulo}>Sai no período</span>
          <strong className={styles.valor}>{dias ? formatarDinheiro(totais.saidas) : '…'}</strong>
          <span className={styles.nota}>despesas pelo vencimento</span>
        </div>
        <div className={styles.item}>
          <span className={styles.rotulo}>Saldo do período</span>
          <strong className={`${styles.valor} ${totais.entradas - totais.saidas < 0 ? styles.neg : styles.pos}`}>
            {dias ? formatarDinheiro(totais.entradas - totais.saidas) : '…'}
          </strong>
          <span className={styles.nota}>entra menos sai</span>
        </div>
      </div>

      <h3 className={styles.secaoTitulo}>Dia a dia</h3>
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Dia</th>
              <th className={styles.num}>Pix e dinheiro</th>
              <th className={styles.num}>Cartão (líquido)</th>
              <th className={styles.num}>Taxa</th>
              <th className={styles.num}>Outras entradas</th>
              <th className={styles.num}>Saídas</th>
              <th className={styles.num}>Saldo do dia</th>
              <th className={styles.num}>Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {!dias && <tr><td colSpan={8} className={styles.vazio}>Carregando…</td></tr>}
            {dias && linhas.length === 0 && <tr><td colSpan={8} className={styles.vazio}>Nada entra nem sai neste período.</td></tr>}
            {linhas.map(d => (
              <tr key={d.dia} data-hoje={d.dia === hoje || undefined} data-vazio={d.vazio || undefined}>
                <td>{DIAS[dow(d.dia)]} {fmtData(d.dia)}</td>
                <td className={styles.num}>{d.pixDinheiro ? formatarDinheiro(d.pixDinheiro) : '–'}</td>
                <td className={styles.num}>{d.cartaoLiquido ? formatarDinheiro(d.cartaoLiquido) : '–'}</td>
                <td className={`${styles.num} ${styles.muted}`}>{d.cartaoTaxa ? `−${formatarDinheiro(d.cartaoTaxa)}` : '–'}</td>
                <td className={styles.num}>{d.outrasEntradas ? formatarDinheiro(d.outrasEntradas) : '–'}</td>
                <td className={styles.num}>{d.saidas ? `−${formatarDinheiro(d.saidas)}` : '–'}</td>
                <td className={`${styles.num} ${d.saldo < 0 ? styles.neg : ''}`}>{formatarDinheiro(d.saldo)}</td>
                <td className={`${styles.num} ${d.acc < 0 ? styles.neg : ''}`}>{formatarDinheiro(d.acc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.conciliaTopo}>
        <h3 className={styles.secaoTitulo}>Conciliação dos cartões</h3>
        <div className={styles.conciliaAcoes}>
          {pendentes.length > 0 && (
            <button type="button" className={styles.linkBtn} onClick={() =>
              setSel(s => s.size === pendentes.length ? new Set() : new Set(pendentes.map(r => r.id)))}>
              {sel.size === pendentes.length ? 'Limpar seleção' : 'Selecionar todos os previstos'}
            </button>
          )}
          <Button size="sm" disabled={sel.size === 0} loading={salvando} onClick={() => marcar([...sel])}>
            <CheckCheck size={14} /> Marcar {sel.size || ''} como recebido{sel.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
      <p className={styles.dica}>
        Caiu certinho: selecione e marque em lote. Caiu diferente: use “Informar valor”; se não bater com o previsto, fica divergente.
      </p>

      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th aria-label="Selecionar" />
              <th>Cai em</th>
              <th>Venda</th>
              <th>Cartão</th>
              <th className={styles.num}>Bruto</th>
              <th className={styles.num}>Taxa</th>
              <th className={styles.num}>Líquido</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!recs && <tr><td colSpan={9} className={styles.vazio}>Carregando…</td></tr>}
            {recs && recs.length === 0 && <tr><td colSpan={9} className={styles.vazio}>Nenhum recebimento de cartão neste período.</td></tr>}
            {(recs ?? []).map(r => (
              <tr key={r.id} data-status={r.status}>
                <td>
                  {r.status === 'previsto' && (
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => alternar(r.id)} aria-label="Selecionar recebimento" />
                  )}
                </td>
                <td>{fmtData(r.dataPrevista)}{r.dataPrevista < hoje && r.status === 'previsto' && <span className={styles.atraso}> atrasado</span>}</td>
                <td>{fmtData(r.dataVenda)}{r.cliente ? ` · ${r.cliente.split(' ')[0]}` : ''}</td>
                <td>
                  {r.tipo === 'debit' ? 'Débito' : r.parcelas > 1 ? `Crédito ${r.parcela}/${r.parcelas}` : 'Crédito à vista'}
                  <span className={styles.muted}> · {rotuloBandeira(r.bandeira)}</span>
                </td>
                <td className={styles.num}>{formatarDinheiro(r.bruto)}</td>
                <td className={styles.num}>
                  {r.taxaPct === null
                    ? <span className={styles.semTaxa} title="Sem taxa cadastrada para esta bandeira/parcelas: entra o valor cheio"><AlertTriangle size={12} /> sem taxa</span>
                    : <span className={styles.muted}>{r.taxaPct.toLocaleString('pt-BR')}% · −{formatarDinheiro(r.taxa)}</span>}
                </td>
                <td className={styles.num}><strong>{formatarDinheiro(r.liquido)}</strong></td>
                <td>
                  <span className={styles.status} data-s={r.status}>{STATUS[r.status]}</span>
                  {r.status === 'divergente' && r.valorRecebido !== null && (
                    <span className={styles.muted}> caiu {formatarDinheiro(r.valorRecebido)} ({formatarDinheiro(r.valorRecebido - r.liquido)})</span>
                  )}
                </td>
                <td className={styles.acoes}>
                  {r.status === 'previsto' && informando !== r.id && (
                    <button type="button" className={styles.linkBtn} onClick={() => { setInformando(r.id); setValorInf(r.liquido.toFixed(2).replace('.', ',')) }}>
                      Informar valor
                    </button>
                  )}
                  {informando === r.id && (
                    <span className={styles.informar}>
                      <input
                        autoFocus
                        className={styles.input}
                        inputMode="decimal"
                        value={valorInf}
                        aria-label="Valor que caiu"
                        onChange={e => setValorInf(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') informar(r.id); if (e.key === 'Escape') setInformando(null) }}
                      />
                      <Button size="sm" loading={salvando} onClick={() => informar(r.id)}>OK</Button>
                    </span>
                  )}
                  {r.status !== 'previsto' && (
                    <button type="button" className={styles.linkBtn} onClick={() => desfazer(r.id)} title="Voltar para previsto">
                      <Undo2 size={13} /> Desfazer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
