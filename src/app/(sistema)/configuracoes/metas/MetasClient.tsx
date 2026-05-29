'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Check, RotateCcw, Coins, Loader2 } from 'lucide-react'
import { monthLabel, currentMonthKey } from '@/lib/metas/compute'
import { upsertMetaPadrao, upsertMetaMes, removeMetaMes, gerarComissoesDoMes } from './actions'
import styles from './MetasClient.module.css'

export interface MetaRow {
  userId: string
  name: string
  storeName: string | null
  target: number
  commissionPct: number
  hasOverride: boolean
  defaultTarget: number
  realized: number
  salesCount: number
  pct: number
  reached: boolean
  commission: number
  commissionGenerated: boolean
}

interface Props {
  mode: 'default' | 'month'
  monthKey: string // 'padrao' no modo default
  rows: MetaRow[]
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function MetasClient({ mode, monthKey, rows }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState<string | null>(null)

  const isDefault = mode === 'default'

  function goTo(month: string) {
    startTransition(() => router.push(`/configuracoes/metas?month=${month}`))
  }

  async function handleGerar() {
    setGenerating(true)
    setGenMsg(null)
    const res = await gerarComissoesDoMes(monthKey)
    setGenerating(false)
    if (!res.success) { setGenMsg(`Erro: ${res.error}`); return }
    setGenMsg(`${res.total} comissão(ões): ${res.created} criada(s), ${res.updated} atualizada(s), ${res.removed} removida(s).`)
    router.refresh()
  }

  return (
    <div className={styles.container}>
      {/* Seletor de contexto: Padrão vs Mês */}
      <div className={styles.contextBar}>
        <div className={styles.modeToggle}>
          <button
            type="button"
            className={`${styles.modeBtn} ${isDefault ? styles.modeActive : ''}`}
            onClick={() => goTo('padrao')}
          >
            Meta padrão
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${!isDefault ? styles.modeActive : ''}`}
            onClick={() => goTo(currentMonthKey(new Date()))}
          >
            Por mês
          </button>
        </div>

        {!isDefault && (
          <div className={styles.monthNav}>
            <button className={styles.navBtn} onClick={() => goTo(shiftMonth(monthKey, -1))} title="Mês anterior">
              <ChevronLeft size={16} />
            </button>
            <span className={styles.monthLabel}>{monthLabel(monthKey)}</span>
            <button className={styles.navBtn} onClick={() => goTo(shiftMonth(monthKey, 1))} title="Próximo mês">
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {!isDefault && (
          <button className={styles.gerarBtn} onClick={handleGerar} disabled={generating}>
            {generating ? <Loader2 size={15} className={styles.spin} /> : <Coins size={15} />}
            {generating ? 'Gerando…' : 'Gerar comissões do mês'}
          </button>
        )}
      </div>

      {isDefault ? (
        <p className={styles.hint}>
          A meta padrão vale para todos os meses. Em <strong>Por mês</strong>, você pode sobrescrever um mês específico (ex.: dezembro).
        </p>
      ) : (
        <p className={styles.hint}>
          Mostrando a meta vigente de <strong>{monthLabel(monthKey)}</strong>. Editar aqui cria um override só deste mês (a padrão continua valendo nos demais).
        </p>
      )}

      {genMsg && <div className={styles.genMsg}>{genMsg}</div>}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Vendedora</th>
              {!isDefault && <th className={styles.numCol}>Realizado</th>}
              {!isDefault && <th className={styles.progressCol}>Progresso</th>}
              <th className={styles.numCol}>Meta (R$)</th>
              <th className={styles.numCol}>Comissão (%)</th>
              {!isDefault && <th className={styles.numCol}>Comissão</th>}
              <th className={styles.actionsCol}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={isDefault ? 4 : 7} className={styles.empty}>Nenhuma vendedora ativa.</td></tr>
            ) : rows.map(row => (
              <MetaRowEditor key={row.userId} row={row} isDefault={isDefault} monthKey={monthKey} onSaved={() => router.refresh()} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MetaRowEditor({ row, isDefault, monthKey, onSaved }: {
  row: MetaRow; isDefault: boolean; monthKey: string; onSaved: () => void
}) {
  const [target, setTarget] = useState(String(row.target || ''))
  const [pct, setPct] = useState(String(row.commissionPct || ''))
  const [saving, setSaving] = useState(false)

  const dirty = Number(target || 0) !== row.target || Number(pct || 0) !== row.commissionPct

  async function save() {
    setSaving(true)
    const t = Number(target || 0)
    const p = Number(pct || 0)
    const res = isDefault
      ? await upsertMetaPadrao(row.userId, t, p)
      : await upsertMetaMes(row.userId, monthKey, t, p)
    setSaving(false)
    if (res.success) onSaved()
    else alert(res.error)
  }

  async function usarPadrao() {
    setSaving(true)
    const res = await removeMetaMes(row.userId, monthKey)
    setSaving(false)
    if (res.success) onSaved()
    else alert(res.error)
  }

  const pctValue = row.target > 0 ? Math.min(row.pct, 100) : 0

  return (
    <tr>
      <td>
        <div className={styles.sellerCell}>
          <span className={styles.sellerName}>{row.name}</span>
          {row.storeName && <span className={styles.sellerStore}>{row.storeName}</span>}
          {!isDefault && row.hasOverride && <span className={styles.overrideBadge}>override</span>}
        </div>
      </td>

      {!isDefault && (
        <td className={styles.numCol}>
          <span className={styles.realized}>{fmtBRL(row.realized)}</span>
          <span className={styles.salesCount}>{row.salesCount} venda{row.salesCount !== 1 ? 's' : ''}</span>
        </td>
      )}

      {!isDefault && (
        <td className={styles.progressCol}>
          {row.target > 0 ? (
            <div className={styles.progressWrap}>
              <div className={styles.progressTrack}>
                <div
                  className={`${styles.progressFill} ${row.reached ? styles.progressReached : ''}`}
                  style={{ width: `${pctValue}%` }}
                />
              </div>
              <span className={`${styles.progressPct} ${row.reached ? styles.pctReached : ''}`}>
                {Math.round(row.pct)}%
              </span>
            </div>
          ) : <span className={styles.noGoal}>sem meta</span>}
        </td>
      )}

      <td className={styles.numCol}>
        <input
          type="number" min={0} step={50}
          className={styles.input}
          value={target}
          placeholder="0"
          onChange={e => setTarget(e.target.value)}
        />
      </td>

      <td className={styles.numCol}>
        <input
          type="number" min={0} max={100} step={0.5}
          className={`${styles.input} ${styles.inputSmall}`}
          value={pct}
          placeholder="0"
          onChange={e => setPct(e.target.value)}
        />
      </td>

      {!isDefault && (
        <td className={styles.numCol}>
          {row.reached
            ? <span className={`${styles.commission} ${row.commissionGenerated ? styles.commissionPaid : ''}`}>
                {fmtBRL(row.commission)}{row.commissionGenerated && <Check size={12} />}
              </span>
            : <span className={styles.noGoal}>—</span>}
        </td>
      )}

      <td className={styles.actionsCol}>
        <div className={styles.rowActions}>
          {dirty && (
            <button className={styles.saveBtn} onClick={save} disabled={saving} title="Salvar">
              {saving ? <Loader2 size={14} className={styles.spin} /> : <Check size={14} />}
            </button>
          )}
          {!isDefault && row.hasOverride && (
            <button className={styles.resetBtn} onClick={usarPadrao} disabled={saving} title="Usar meta padrão (remover override)">
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
