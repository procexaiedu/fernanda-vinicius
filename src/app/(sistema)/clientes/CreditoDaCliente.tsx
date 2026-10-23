'use client'

import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { buscarCreditoDaCliente, ajustarCreditoDaCliente, type CreditoDaCliente as Credito } from '../vendas/credito'
import { formatarDinheiro } from '@/lib/dinheiro'
import Input from '@/components/ui/Input'
import styles from './ClienteDetalheModal.module.css'

const fmt = formatarDinheiro

const TIPO: Record<string, string> = {
  gerou: 'Gerou (sobra de troca)', usou: 'Usou numa compra', ajuste: 'Ajuste', estorno: 'Estorno (venda excluída)',
}

/**
 * Crédito da cliente na loja da sessão: saldo e extrato (gerou, usou, ajuste).
 * Vendedora vê; ajustar/zerar é só do admin (o servidor confere de novo).
 * Sem saldo e sem histórico, nem aparece.
 */
export default function CreditoDaCliente({ customerId }: { customerId: string }) {
  const [credito, setCredito] = useState<Credito | null>(null)
  const [erro, setErro]       = useState<string | null>(null)
  const [ajustando, setAjustando] = useState(false)
  const [novo, setNovo]       = useState('')
  const [motivo, setMotivo]   = useState('')
  const [salvando, setSalvando] = useState(false)

  function carregar() {
    buscarCreditoDaCliente(customerId, null, true)
      .then(r => { setCredito(r.data); setErro(r.error ?? null) })
      .catch(() => setErro('Não consegui ler o crédito da cliente agora.'))
  }
  useEffect(carregar, [customerId])

  async function salvarAjuste() {
    const valor = parseFloat(novo.replace(',', '.'))
    setSalvando(true)
    const r = await ajustarCreditoDaCliente(customerId, null, valor, motivo)
    setSalvando(false)
    if (!r.success) { setErro(r.error ?? 'Não consegui ajustar.'); return }
    setAjustando(false); setNovo(''); setMotivo(''); setErro(null)
    carregar()
  }

  if (erro && !credito) return <div className={styles.notes}>{erro}</div>
  if (!credito || (credito.saldo <= 0 && !credito.extrato?.length)) return null

  return (
    <div className={styles.salesSection} data-novidade="credito-da-cliente">
      <div className={styles.sectionTitle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Wallet size={14} /> Crédito na loja</span>
        <span className={styles.sectionCount}>saldo {fmt(credito.saldo)}</span>
      </div>

      {credito.podeAjustar && (
        ajustando ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ width: 130 }}>
              <Input inputMode="decimal" placeholder="Novo saldo" value={novo} onChange={e => setNovo(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="Motivo do ajuste" value={motivo} onChange={e => setMotivo(e.target.value)} />
            </div>
            <button className={styles.editBtn} disabled={salvando} onClick={salvarAjuste}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button className={styles.editBtn} onClick={() => setAjustando(false)}>Cancelar</button>
          </div>
        ) : (
          <button className={styles.editBtn} style={{ marginBottom: 8 }} onClick={() => { setNovo(String(credito.saldo)); setAjustando(true) }}>
            Ajustar ou zerar
          </button>
        )
      )}
      {erro && <div className={styles.notes}>{erro}</div>}

      {(credito.extrato ?? []).map(m => (
        <div key={m.id} style={{ display: 'flex', gap: 12, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ width: 82, color: 'var(--text-muted)' }}>{new Date(m.quando).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
          <span style={{ flex: 1 }}>{TIPO[m.tipo] ?? m.tipo}{m.notas ? ` · ${m.notas}` : ''}</span>
          <span style={{ width: 90, textAlign: 'right', color: m.valor > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
            {m.valor > 0 ? '+' : '−'} {fmt(Math.abs(m.valor))}
          </span>
          <span style={{ width: 90, textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(m.saldoDepois)}</span>
        </div>
      ))}
    </div>
  )
}
