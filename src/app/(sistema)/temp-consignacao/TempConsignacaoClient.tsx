'use client'

/*
 * TELA TEMPORÁRIA — ver o cabeçalho de ./actions.ts.
 * Apagar esta pasta inteira quando o lote da Emília estiver em Campinas.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import Button from '@/components/ui/Button'
import { formatarDinheiro } from '@/lib/dinheiro'
import { moverLote, type Lote } from './actions'

export default function TempConsignacaoClient({ lotes, lojas }: {
  lotes: Lote[]
  lojas: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [aberto, setAberto]   = useState<string | null>(null)
  const [movendo, setMovendo] = useState<string | null>(null)
  const [destino, setDestino] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function mover(lote: Lote) {
    const lojaId = destino[lote.id]
    if (!lojaId) { setMsg({ tipo: 'erro', texto: 'Escolha a loja de destino.' }); return }

    const nomeDestino = lojas.find(l => l.id === lojaId)?.name ?? '—'
    const ok = window.confirm(
      `Mover ${lote.pecas.length} peça(s) do lote de ${lote.fornecedor} `
      + `de ${lote.loja} para ${nomeDestino}?\n\nIsto muda a loja das peças e do lote no banco.`,
    )
    if (!ok) return

    setMovendo(lote.id)
    setMsg(null)
    try {
      const r = await moverLote(lote.id, lojaId)
      if (r.success) {
        setMsg({ tipo: 'ok', texto: `${r.pecasMovidas} peça(s) movidas para ${nomeDestino}. O lote foi junto.` })
        router.refresh()
      } else {
        setMsg({ tipo: 'erro', texto: r.error ?? 'Erro ao mover.' })
      }
    } catch (e) {
      setMsg({ tipo: 'erro', texto: String(e) })
    } finally {
      setMovendo(null)
    }
  }

  if (!lotes.length) {
    return <p style={{ color: 'var(--text-muted)' }}>Nenhuma consignação cadastrada.</p>
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {msg && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
          borderRadius: 8, fontSize: 13,
          background: msg.tipo === 'ok' ? 'var(--success-subtle)' : 'var(--danger-subtle)',
          border: `1px solid ${msg.tipo === 'ok' ? 'var(--success)' : 'var(--danger)'}`,
          color: msg.tipo === 'ok' ? 'var(--text-primary)' : 'var(--danger)',
        }}>
          <AlertTriangle size={14} />
          {msg.texto}
        </div>
      )}

      {lotes.map(lote => {
        const vendidas = lote.pecas.reduce((s, p) => s + p.vendidas, 0)
        const emEstoque = lote.pecas.reduce((s, p) => s + p.quantity_in_stock, 0)
        const expandido = aberto === lote.id

        return (
          <div key={lote.id} style={{
            border: '1px solid var(--border)', borderRadius: 10, padding: 14,
            background: 'var(--bg-elevated)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setAberto(expandido ? null : lote.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, background: 'none',
                  border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit', padding: 0,
                }}
              >
                {expandido ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <strong>{lote.fornecedor}</strong>
              </button>

              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {new Date(lote.received_date + 'T12:00:00').toLocaleDateString('pt-BR')}
              </span>

              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 999,
                background: 'var(--accent-subtle)', color: 'var(--text-primary)',
              }}>
                lote em {lote.loja}
              </span>

              {/* O que realmente importa: onde estão as PEÇAS. É por elas que a
                  compra e o estoque se orientam, não pelo cabeçalho do lote. */}
              <span style={{ fontSize: 12 }}>
                peças em <strong>{lote.lojasDasPecas.join(', ') || '—'}</strong>
              </span>

              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {lote.pecas.length} cadastro(s) · {emEstoque} em estoque · {vendidas} vendida(s)
                {lote.total_cost_value != null && ` · ${formatarDinheiro(Number(lote.total_cost_value))}`}
              </span>

              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lote.status}</span>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={destino[lote.id] ?? ''}
                  onChange={e => setDestino(d => ({ ...d, [lote.id]: e.target.value }))}
                  style={{
                    padding: '6px 8px', borderRadius: 6, fontSize: 12,
                    border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)',
                  }}
                >
                  <option value="">Mover para…</option>
                  {lojas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <Button
                  size="sm"
                  loading={movendo === lote.id}
                  disabled={!destino[lote.id] || movendo !== null}
                  onClick={() => mover(lote)}
                >
                  Mover
                </Button>
              </div>
            </div>

            {expandido && (
              <div style={{ marginTop: 12, overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '4px 6px' }}>Etiqueta</th>
                      <th style={{ padding: '4px 6px' }}>Peça</th>
                      <th style={{ padding: '4px 6px' }}>Código</th>
                      <th style={{ padding: '4px 6px' }}>Loja</th>
                      <th style={{ padding: '4px 6px', textAlign: 'right' }}>Estoque</th>
                      <th style={{ padding: '4px 6px', textAlign: 'right' }}>Vendidas</th>
                      <th style={{ padding: '4px 6px', textAlign: 'right' }}>Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lote.pecas.map(p => (
                      <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{p.barcode_number}</td>
                        <td style={{ padding: '4px 6px' }}>
                          {p.name}
                          {!p.is_active && <span style={{ color: 'var(--text-muted)' }}> (inativa)</span>}
                        </td>
                        <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{p.code}</td>
                        <td style={{ padding: '4px 6px' }}>
                          {lojas.find(l => l.id === p.store_id)?.name ?? '—'}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right' }}>{p.quantity_in_stock}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right' }}>{p.vendidas || ''}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right' }}>{formatarDinheiro(p.cost_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
