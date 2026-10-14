'use client'

import { useState } from 'react'
import { salvarPrazo } from './actions'
import { BANDEIRAS, type PrazoLinha } from '@/lib/taxasCartao'
import { prazoPadrao } from '@/lib/recebimentos'
import styles from './TaxasClient.module.css'

/*
 * Quando o dinheiro do cartão cai, por bandeira. Parcela k cai em
 * venda + "1ª parcela" + "entre parcelas" × (k − 1); "dia útil" passa sábado e
 * domingo para segunda. Padrão = planilha da Laranjinha (débito 1 dia útil;
 * crédito 31 dias, e 31 a cada parcela). Serve para bater com o extrato.
 * Cada linha salva sozinha ao sair do campo.
 */

type Tipo = 'debit' | 'credit'
type Valores = { prazo_dias: string; intervalo_dias: string; dia_util: boolean }
const chave = (b: string, t: Tipo) => `${b}|${t}`

export default function PrazosClient({ prazos, lojaId }: { prazos: PrazoLinha[]; lojaId: string }) {
  const inicial: Record<string, Valores> = {}
  for (const b of BANDEIRAS) {
    for (const t of ['debit', 'credit'] as Tipo[]) {
      const p = prazos.find(x => x.brand === b.value && x.card_type === t)
      const d = prazoPadrao(t)
      inicial[chave(b.value, t)] = {
        prazo_dias: String(p?.prazo_dias ?? d.prazoDias),
        intervalo_dias: String(p?.intervalo_dias ?? d.intervaloDias),
        dia_util: p?.dia_util ?? d.diaUtil,
      }
    }
  }
  const [valores, setValores] = useState(inicial)
  const [gravado, setGravado] = useState(inicial)
  const [estado, setEstado] = useState<Record<string, 'salvando' | 'salvo' | 'erro'>>({})
  const [erro, setErro] = useState<string | null>(null)

  async function salvar(brand: string, t: Tipo, novo: Valores = valores[chave(brand, t)]) {
    const k = chave(brand, t)
    if (JSON.stringify(novo) === JSON.stringify(gravado[k])) return
    const prazo = Number(novo.prazo_dias)
    const intervalo = t === 'debit' ? 0 : Number(novo.intervalo_dias)
    if (!Number.isInteger(prazo) || !Number.isInteger(intervalo) || prazo < 0 || intervalo < 0 || prazo > 365 || intervalo > 365) {
      setEstado(e => ({ ...e, [k]: 'erro' }))
      setErro('Prazo em dias inteiros, de 0 a 365.')
      return
    }
    setEstado(e => ({ ...e, [k]: 'salvando' }))
    const res = await salvarPrazo({ store_id: lojaId, brand, card_type: t, prazo_dias: prazo, intervalo_dias: intervalo, dia_util: novo.dia_util })
    if (!res.success) {
      setEstado(e => ({ ...e, [k]: 'erro' }))
      setErro(res.error ?? 'Não consegui salvar.')
      return
    }
    setErro(null)
    setGravado(g => ({ ...g, [k]: novo }))
    setEstado(e => ({ ...e, [k]: 'salvo' }))
    setTimeout(() => setEstado(e => { const n = { ...e }; if (n[k] === 'salvo') delete n[k]; return n }), 1800)
  }

  function campo(brand: string, t: Tipo, nome: 'prazo_dias' | 'intervalo_dias', rotulo: string) {
    const k = chave(brand, t)
    return (
      <td className={styles.td} data-estado={estado[k]}>
        <input
          className={styles.celula}
          inputMode="numeric"
          value={valores[k][nome]}
          aria-label={rotulo}
          onChange={e => setValores(v => ({ ...v, [k]: { ...v[k], [nome]: e.target.value } }))}
          onBlur={() => salvar(brand, t)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
      </td>
    )
  }

  function util(brand: string, t: Tipo, rotulo: string) {
    const k = chave(brand, t)
    return (
      <td className={styles.td} data-estado={estado[k]}>
        <input
          type="checkbox"
          checked={valores[k].dia_util}
          aria-label={rotulo}
          onChange={e => {
            const novo = { ...valores[k], dia_util: e.target.checked }
            setValores(v => ({ ...v, [k]: novo }))
            salvar(brand, t, novo)
          }}
        />
      </td>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.legenda}>
        <span>
          <strong>Prazos de recebimento</strong> (em dias depois da venda). Parcela 1 cai no prazo da 1ª; as seguintes, a cada
          “entre parcelas”. Dia útil: sábado e domingo passam para segunda. Vale para as vendas novas.
        </span>
        {erro && <span className={styles.erro} role="alert">{erro}</span>}
      </div>
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th className={styles.colBandeira}>Bandeira</th>
              <th>Débito: dias</th>
              <th>Débito: dia útil</th>
              <th>Crédito: 1ª parcela</th>
              <th>Crédito: entre parcelas</th>
              <th>Crédito: dia útil</th>
            </tr>
          </thead>
          <tbody>
            {BANDEIRAS.map(b => (
              <tr key={b.value}>
                <th scope="row" className={styles.colBandeira}>{b.label}</th>
                {campo(b.value, 'debit', 'prazo_dias', `${b.label} débito dias`)}
                {util(b.value, 'debit', `${b.label} débito dia útil`)}
                {campo(b.value, 'credit', 'prazo_dias', `${b.label} crédito 1ª parcela`)}
                {campo(b.value, 'credit', 'intervalo_dias', `${b.label} crédito entre parcelas`)}
                {util(b.value, 'credit', `${b.label} crédito dia útil`)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
