'use client'

import { useState } from 'react'
import { salvarTaxa } from './actions'
import { BANDEIRAS, type TaxaCelula } from '@/lib/taxasCartao'
import styles from './TaxasClient.module.css'

/*
 * Uma grade: bandeira na linha, Débito e Crédito 1x–12x na coluna. Cada célula
 * salva sozinha ao sair do campo. Célula vazia = sem taxa: a venda entra pelo
 * valor cheio e o fluxo de caixa avisa "sem taxa" (Hipercard e 7x–12x hoje).
 */

const COLUNAS: { card_type: 'debit' | 'credit'; installments: number; label: string }[] = [
  { card_type: 'debit', installments: 1, label: 'Débito' },
  ...Array.from({ length: 12 }, (_, i) => ({ card_type: 'credit' as const, installments: i + 1, label: i === 0 ? 'Crédito 1x' : `${i + 1}x` })),
]

const chave = (b: string, t: string, n: number) => `${b}|${t}|${n}`
const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

type Estado = 'salvando' | 'salvo' | 'erro'

export default function TaxasClient({ taxas }: { taxas: TaxaCelula[] }) {
  const inicial = Object.fromEntries(taxas.map(t => [chave(t.brand, t.card_type, t.installments), fmt(t.fee_pct)]))
  const [valores, setValores] = useState<Record<string, string>>(inicial)
  const [gravado, setGravado] = useState<Record<string, string>>(inicial)
  const [estado, setEstado] = useState<Record<string, Estado>>({})
  const [erro, setErro] = useState<string | null>(null)

  async function salvar(brand: string, card_type: 'debit' | 'credit', installments: number) {
    const k = chave(brand, card_type, installments)
    const texto = (valores[k] ?? '').trim().replace('%', '').replace(',', '.')
    if ((valores[k] ?? '') === (gravado[k] ?? '')) return
    const fee = texto === '' ? null : Number(texto)
    if (fee !== null && (!Number.isFinite(fee) || fee < 0 || fee >= 100)) {
      setEstado(e => ({ ...e, [k]: 'erro' }))
      setErro('Taxa inválida: use um número entre 0 e 99,99 (ex.: 2,81).')
      return
    }
    setEstado(e => ({ ...e, [k]: 'salvando' }))
    const res = await salvarTaxa({ brand, card_type, installments, fee_pct: fee })
    if (!res.success) {
      setEstado(e => ({ ...e, [k]: 'erro' }))
      setErro(res.error ?? 'Não consegui salvar.')
      return
    }
    const novo = fee === null ? '' : fmt(fee)
    setErro(null)
    setValores(v => ({ ...v, [k]: novo }))
    setGravado(g => ({ ...g, [k]: novo }))
    setEstado(e => ({ ...e, [k]: 'salvo' }))
    setTimeout(() => setEstado(e => { const n = { ...e }; if (n[k] === 'salvo') delete n[k]; return n }), 1800)
  }

  return (
    <div className={styles.card}>
      <div className={styles.legenda}>
        <span>Taxa em % por venda. Deixe vazio para <strong>sem taxa</strong> (entra o valor cheio, com aviso no fluxo de caixa).</span>
        {erro && <span className={styles.erro} role="alert">{erro}</span>}
      </div>
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th className={styles.colBandeira}>Bandeira</th>
              {COLUNAS.map(c => <th key={c.label}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {BANDEIRAS.map(b => (
              <tr key={b.value}>
                <th scope="row" className={styles.colBandeira}>
                  {b.label}
                  {!b.noPdv && <span className={styles.fora} title="O PDV ainda não oferece esta bandeira">fora do PDV</span>}
                </th>
                {COLUNAS.map(c => {
                  const k = chave(b.value, c.card_type, c.installments)
                  const v = valores[k] ?? ''
                  return (
                    <td key={k} className={styles.td} data-estado={estado[k]} data-vazio={v === '' || undefined}>
                      <input
                        className={styles.celula}
                        inputMode="decimal"
                        value={v}
                        placeholder="sem taxa"
                        aria-label={`${b.label} ${c.label}`}
                        onChange={e => setValores(x => ({ ...x, [k]: e.target.value }))}
                        onBlur={() => salvar(b.value, c.card_type, c.installments)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
