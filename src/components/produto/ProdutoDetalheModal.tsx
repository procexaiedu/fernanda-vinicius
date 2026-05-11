'use client'

import { useState, useEffect } from 'react'
import { X, Pencil, Gem } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { buscarHistoricoVendas, type SaleHistoryItem } from '@/app/(sistema)/produtos/actions'
import styles from './ProdutoDetalheModal.module.css'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProdutoParaDetalhe {
  id: string
  code: string
  name: string
  category: string
  material: string
  supplier_id: string
  store_id: string
  cost_price: number
  sale_price: number
  promotional_price: number | null
  quantity_in_stock: number
  ownership_type: 'own' | 'consignment'
  last_sale_date: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  suppliers?: { id: string; name: string; initials: string } | null
  stores?: { id: string; name: string } | null
}

interface Transfer {
  id: string
  quantity: number
  created_at: string
  notes: string | null
  from_store: { name: string } | null
  to_store: { name: string } | null
  users: { full_name: string } | null
}

interface Props {
  produto: ProdutoParaDetalhe
  isAdmin: boolean
  onClose: () => void
  onEdit?: (p: ProdutoParaDetalhe) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(s: string | null) {
  if (!s) return '—'
  const [date] = s.split('T')
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ProdutoDetalheModal({ produto, isAdmin, onClose, onEdit }: Props) {
  type Tab = 'geral' | 'vendas' | 'transferencias'
  const [tab, setTab] = useState<Tab>('geral')
  const [salesItems, setSalesItems] = useState<SaleHistoryItem[] | null>(null)
  const [transfers, setTransfers] = useState<Transfer[] | null>(null)
  const [loadingSales, setLoadingSales] = useState(false)
  const [loadingTransfers, setLoadingTransfers] = useState(false)

  const margem = isAdmin && produto.cost_price > 0
    ? ((produto.sale_price - produto.cost_price) / produto.cost_price) * 100
    : null

  useEffect(() => {
    if (tab !== 'vendas' || salesItems !== null) return
    setLoadingSales(true)
    buscarHistoricoVendas(produto.id)
      .then(data => { setSalesItems(data); setLoadingSales(false) })
      .catch(() => { setSalesItems([]); setLoadingSales(false) })
  }, [tab, salesItems, produto.id])

  useEffect(() => {
    if (!isAdmin || tab !== 'transferencias' || transfers !== null) return
    setLoadingTransfers(true)
    const supabase = createBrowserClient()
    supabase
      .from('stock_transfers')
      .select('id, quantity, created_at, notes, from_store:stores!from_store_id(name), to_store:stores!to_store_id(name), users!user_id(full_name)')
      .eq('product_id', produto.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }: { data: unknown }) => { setTransfers((data as Transfer[]) ?? []); setLoadingTransfers(false) })
  }, [tab, transfers, produto.id, isAdmin])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'geral', label: 'Geral' },
    { key: 'vendas', label: 'Histórico de Vendas' },
    ...(isAdmin ? [{ key: 'transferencias' as Tab, label: 'Transferências' }] : []),
  ]

  return (
    <Modal isOpen onClose={onClose} size="xl2" hideHeader>
      <div className={styles.container}>

        {/* Header customizado */}
        <div className={styles.modalHeader}>
          {produto.photo_url
            ? <img src={produto.photo_url} alt={produto.name} className={styles.photo} />
            : <div className={styles.photoPlaceholder}><Gem size={36} /></div>
          }

          <div className={styles.headerInfo}>
            <div className={styles.productName}>{produto.name}</div>
            <div className={styles.headerMeta}>
              <span className={styles.code}>{produto.code}</span>
              <span className={styles.metaItem}><span className={styles.metaLabel}>Categoria:</span> {produto.category}</span>
              <span className={styles.metaItem}><span className={styles.metaLabel}>Material:</span> {produto.material}</span>
              {isAdmin && produto.suppliers && (
                <span className={styles.metaItem}><span className={styles.metaLabel}>Fornecedor:</span> {produto.suppliers.name}</span>
              )}
              {isAdmin && produto.stores && (
                <span className={styles.metaItem}><span className={styles.metaLabel}>Loja:</span> {produto.stores.name}</span>
              )}
            </div>
            <div className={styles.headerActions}>
              {produto.is_active ? <Badge variant="success">Ativo</Badge> : <Badge variant="muted">Inativo</Badge>}
              {produto.ownership_type === 'consignment' && <Badge variant="accent">Consignação</Badge>}
              {onEdit && (
                <Button size="sm" variant="ghost" onClick={() => onEdit(produto)}>
                  <Pencil size={13} /> Editar
                </Button>
              )}
            </div>
          </div>

          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Geral */}
        {tab === 'geral' && (
          <>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Preço de Venda</span>
                <span className={`${styles.statValue} ${styles.statValueGreen}`}>{fmt(produto.sale_price)}</span>
              </div>
              {produto.promotional_price && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Promoção</span>
                  <span className={`${styles.statValue} ${styles.statValueGold}`}>{fmt(produto.promotional_price)}</span>
                </div>
              )}
              <div className={styles.stat}>
                <span className={styles.statLabel}>Estoque</span>
                <span className={`${styles.statValue} ${produto.quantity_in_stock === 0 ? styles.statValueRed : ''}`}>
                  {produto.quantity_in_stock} un.
                </span>
              </div>
              {isAdmin && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Custo</span>
                  <span className={styles.statValue}>{fmt(produto.cost_price)}</span>
                </div>
              )}
            </div>

            {isAdmin && margem !== null && (
              <div className={styles.margem}>
                Margem: <strong style={{ color: margem >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {margem >= 0 ? '+' : ''}{margem.toFixed(0)}%
                </strong>
                {' '}({fmt(produto.sale_price - produto.cost_price)})
              </div>
            )}

            <div className={styles.dates}>
              <span>Cadastrado: {fmtDate(produto.created_at)}</span>
              <span>Última venda: {fmtDate(produto.last_sale_date)}</span>
            </div>
          </>
        )}

        {/* Tab: Histórico de Vendas */}
        {tab === 'vendas' && (
          loadingSales
            ? <div><div className={styles.skeleton} style={{ width: '100%', marginBottom: 8 }} /><div className={styles.skeleton} style={{ width: '80%' }} /></div>
            : !salesItems?.length
              ? <div className={styles.empty}>Nenhuma venda registrada para este produto.</div>
              : (
                <table className={styles.histTable}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      {isAdmin && <th>Cliente</th>}
                      <th>Qtd.</th>
                      <th>Valor</th>
                      {isAdmin && <th>Vendedora</th>}
                      <th>Loja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesItems.map(si => (
                      <tr key={si.id}>
                        <td>{fmtDate(si.sale_date)}</td>
                        {isAdmin && <td>{si.customer_name ?? '—'}</td>}
                        <td>{si.quantity}</td>
                        <td>{fmt(si.unit_price)}</td>
                        {isAdmin && <td>{si.seller_name ?? '—'}</td>}
                        <td>{si.store_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
        )}

        {/* Tab: Transferências (admin only) */}
        {tab === 'transferencias' && isAdmin && (
          loadingTransfers
            ? <div><div className={styles.skeleton} style={{ width: '100%', marginBottom: 8 }} /><div className={styles.skeleton} style={{ width: '80%' }} /></div>
            : !transfers?.length
              ? <div className={styles.empty}>Nenhuma transferência registrada para este produto.</div>
              : (
                <table className={styles.histTable}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>De → Para</th>
                      <th>Qtd.</th>
                      <th>Responsável</th>
                      <th>Obs.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map(t => (
                      <tr key={t.id}>
                        <td>{fmtDate(t.created_at)}</td>
                        <td>{t.from_store?.name ?? '—'} → {t.to_store?.name ?? '—'}</td>
                        <td>{t.quantity}</td>
                        <td>{t.users?.full_name ?? '—'}</td>
                        <td>{t.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
        )}
      </div>
    </Modal>
  )
}
