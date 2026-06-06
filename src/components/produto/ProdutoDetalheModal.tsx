'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Pencil, Gem, Printer, Tag, Check, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EtiquetasPrinter, { type EtiquetasPrinterItem } from '@/components/etiquetas/EtiquetasPrinter'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { buscarHistoricoVendas, setPromotionalActive, updateProductPricing, type SaleHistoryItem } from '@/app/(sistema)/produtos/actions'
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
  promotional_active?: boolean
  quantity_in_stock: number
  ownership_type: 'own' | 'consignment'
  last_sale_date: string | null
  photo_url: string | null
  is_active: boolean
  created_at: string
  supplier_reference?: string | null
  label_format?: 'A' | 'B'
  barcode_number?: string
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
  /** Mapa categoria→formato (category_label_mapping). Fonte de verdade do formato da etiqueta. */
  categoryLabelMap?: Record<string, 'A' | 'B'>
  /** Lista de categorias para o sugestão no editor rápido. */
  categories?: string[]
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

export default function ProdutoDetalheModal({ produto, categoryLabelMap, categories = [], isAdmin, onClose, onEdit }: Props) {
  type Tab = 'geral' | 'vendas' | 'transferencias'
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('geral')
  const [salesItems, setSalesItems] = useState<SaleHistoryItem[] | null>(null)
  const [transfers, setTransfers] = useState<Transfer[] | null>(null)
  const [loadingSales, setLoadingSales] = useState(false)
  const [loadingTransfers, setLoadingTransfers] = useState(false)
  const [printerOpen, setPrinterOpen] = useState(false)

  // Estado local dos campos editáveis — reflete edições/toggle na hora (o `produto` é um snapshot).
  const [promoActive, setPromoActive] = useState(produto.promotional_active ?? false)
  const [salePrice, setSalePrice] = useState(produto.sale_price)
  const [promoPrice, setPromoPrice] = useState<number | null>(produto.promotional_price)
  const [category, setCategory] = useState(produto.category)
  const [togglingPromo, setTogglingPromo] = useState(false)
  const [promoError, setPromoError] = useState<string | null>(null)

  // Editor rápido (categoria + venda + promoção)
  const [editorOpen, setEditorOpen] = useState(false)
  const [savingEditor, setSavingEditor] = useState(false)
  const [editorErr, setEditorErr] = useState<string | null>(null)
  const [draftCategory, setDraftCategory] = useState(produto.category)
  const [draftSale, setDraftSale] = useState(String(produto.sale_price))
  const [draftPromo, setDraftPromo] = useState(produto.promotional_price?.toString() ?? '')

  // Resync quando troca o produto exibido
  useEffect(() => {
    setPromoActive(produto.promotional_active ?? false)
    setSalePrice(produto.sale_price)
    setPromoPrice(produto.promotional_price)
    setCategory(produto.category)
    setEditorOpen(false)
    setPromoError(null)
  }, [produto])

  const hasPromo = promoPrice !== null && promoPrice > 0
  // Preço efetivo: só usa a promo se estiver ATIVA e > 0 (mesma regra do PDV/etiqueta).
  const effectivePrice = promoActive && hasPromo ? (promoPrice as number) : salePrice

  // Formato real da etiqueta vem da tabela category_label_mapping (mesma regra da lista).
  // A coluna products.label_format é só fallback — hoje todos os produtos têm 'B' nela.
  const labelFormat = categoryLabelMap?.[category] ?? produto.label_format
  const printerItem: EtiquetasPrinterItem | null = produto.barcode_number && labelFormat
    ? {
        id: produto.id,
        name: produto.name,
        // A 2ª linha da etiqueta (referência interna) usa o code do produto
        supplier_reference: produto.code,
        sale_price: effectivePrice,
        barcode_number: produto.barcode_number,
        label_format: labelFormat,
        quantity: 1,
      }
    : null

  const margem = isAdmin && produto.cost_price > 0
    ? ((effectivePrice - produto.cost_price) / produto.cost_price) * 100
    : null

  async function handleTogglePromo() {
    if (togglingPromo) return
    setPromoError(null)
    const next = !promoActive
    if (next && !hasPromo) {
      setPromoError('Defina um preço promocional primeiro.')
      setEditorOpen(true)
      return
    }
    setTogglingPromo(true)
    setPromoActive(next) // otimista
    const res = await setPromotionalActive(produto.id, next)
    setTogglingPromo(false)
    if (!res.success) {
      setPromoActive(!next) // reverte
      setPromoError(res.error ?? 'Erro ao atualizar a promoção.')
      return
    }
    router.refresh()
  }

  function openEditor() {
    setDraftCategory(category)
    setDraftSale(String(salePrice))
    setDraftPromo(promoPrice?.toString() ?? '')
    setEditorErr(null)
    setEditorOpen(true)
  }

  async function handleSavePricing() {
    setEditorErr(null)
    const sale = parseFloat(draftSale)
    if (!draftCategory.trim()) { setEditorErr('Categoria é obrigatória.'); return }
    if (!sale || sale <= 0) { setEditorErr('Preço de venda deve ser maior que zero.'); return }
    const promo = draftPromo.trim() ? parseFloat(draftPromo) : null
    if (promo !== null && (isNaN(promo) || promo <= 0)) { setEditorErr('Preço promocional inválido.'); return }
    if (promo !== null && promo >= sale) { setEditorErr('A promoção deve ser menor que o preço de venda.'); return }

    setSavingEditor(true)
    const res = await updateProductPricing(produto.id, {
      category: draftCategory,
      sale_price: sale,
      promotional_price: promo,
    })
    setSavingEditor(false)
    if (!res.success) { setEditorErr(res.error ?? 'Erro ao salvar.'); return }

    // Atualiza estado local na hora
    setCategory(draftCategory.trim().toLowerCase())
    setSalePrice(sale)
    setPromoPrice(promo)
    if (promo === null) setPromoActive(false)
    setEditorOpen(false)
    router.refresh()
  }

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
              <span className={styles.metaItem}><span className={styles.metaLabel}>Categoria:</span> {category}</span>
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
              {printerItem && (
                <Button size="sm" variant="ghost" onClick={() => setPrinterOpen(true)}>
                  <Printer size={13} /> Imprimir etiqueta
                </Button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className={`${styles.promoToggle} ${promoActive ? styles.promoToggleOn : ''}`}
                  onClick={handleTogglePromo}
                  disabled={togglingPromo}
                  title={hasPromo ? 'Ligar/desligar o preço promocional' : 'Defina um preço promocional primeiro'}
                >
                  {togglingPromo ? <Loader2 size={13} className={styles.spin} /> : <Tag size={13} />}
                  <span>Promoção {promoActive ? 'ativa' : 'desligada'}</span>
                  <span className={styles.promoSwitch} aria-hidden><span className={styles.promoKnob} /></span>
                </button>
              )}
              {isAdmin && (
                <Button size="sm" variant="ghost" onClick={openEditor}>
                  <Pencil size={13} /> Editar preços
                </Button>
              )}
              {onEdit && (
                <Button size="sm" variant="ghost" onClick={() => onEdit(produto)}>
                  <Pencil size={13} /> Editar
                </Button>
              )}
            </div>
            {promoError && <div className={styles.promoError}>{promoError}</div>}

            {isAdmin && editorOpen && (
              <div className={styles.pricingEditor}>
                <div className={styles.pricingGrid}>
                  <div className={styles.pricingField}>
                    <label className={styles.pricingLabel}>Categoria</label>
                    <input
                      className={styles.pricingInput}
                      list="detalhe-categorias"
                      value={draftCategory}
                      onChange={e => setDraftCategory(e.target.value)}
                      placeholder="Ex: anel, colar..."
                    />
                    <datalist id="detalhe-categorias">
                      {categories.map(c => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <div className={styles.pricingField}>
                    <label className={styles.pricingLabel}>Venda (R$)</label>
                    <input
                      className={styles.pricingInput}
                      type="number" min="0" step="0.01"
                      value={draftSale}
                      onChange={e => setDraftSale(e.target.value)}
                      placeholder="0,00"
                    />
                  </div>
                  <div className={styles.pricingField}>
                    <label className={styles.pricingLabel}>Promoção (R$)</label>
                    <input
                      className={styles.pricingInput}
                      type="number" min="0" step="0.01"
                      value={draftPromo}
                      onChange={e => setDraftPromo(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                </div>
                {editorErr && <div className={styles.promoError}>{editorErr}</div>}
                <div className={styles.pricingActions}>
                  <Button size="sm" variant="ghost" onClick={() => setEditorOpen(false)} disabled={savingEditor}>
                    Cancelar
                  </Button>
                  <Button size="sm" loading={savingEditor} onClick={handleSavePricing}>
                    <Check size={13} /> Salvar
                  </Button>
                </div>
              </div>
            )}
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
                <span className={`${styles.statValue} ${styles.statValueGreen}`}>{fmt(salePrice)}</span>
              </div>
              {hasPromo && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Promoção {promoActive ? '(ativa)' : '(desligada)'}</span>
                  <span className={`${styles.statValue} ${promoActive ? styles.statValueGold : ''}`}>{fmt(promoPrice as number)}</span>
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
                {' '}({fmt(effectivePrice - produto.cost_price)})
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

      {printerItem && (
        <EtiquetasPrinter
          isOpen={printerOpen}
          onClose={() => setPrinterOpen(false)}
          initialItems={[printerItem]}
          title="Reimprimir etiqueta"
        />
      )}
    </Modal>
  )
}
