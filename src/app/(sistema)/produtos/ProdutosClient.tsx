'use client'

import { useState, useCallback, useMemo, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Pencil, Power, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Gem, Printer } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import ProdutoFormModal from './ProdutoFormModal'
import ProdutoDetalheModal from '@/components/produto/ProdutoDetalheModal'
import EtiquetasPrinter, { type EtiquetasPrinterItem } from '@/components/etiquetas/EtiquetasPrinter'
import { toggleProductStatus } from './actions'
import SearchableSelect from '@/components/ui/SearchableSelect'
import type { ProductWithRelations, StoreOption, SupplierOption } from './page'
import styles from './ProdutosClient.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function getStatusVenda(lastSaleDate: string | null, createdAt: string): 'parado' | 'critico' | null {
  const now = Date.now()
  const ref = lastSaleDate ? new Date(lastSaleDate).getTime() : new Date(createdAt).getTime()
  const dias = Math.floor((now - ref) / 86400000)
  if (!lastSaleDate && dias < 30) return null
  if (dias >= 90) return 'critico'
  if (dias >= 60) return 'parado'
  return null
}

// ─── Paginação ─────────────────────────────────────────────────────────────

function buildPages(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Filters {
  q: string
  store_id: string
  category: string
  material: string
  supplier_id: string
  active: string
}

interface Props {
  products: ProductWithRelations[]
  total: number
  page: number
  perPage: number
  isAdmin: boolean
  stores: StoreOption[]
  suppliers: SupplierOption[]
  categories: string[]
  materials: string[]
  filters: Filters
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ProdutosClient({
  products, total, page, perPage, isAdmin, stores, suppliers, categories, materials, filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductWithRelations | null>(null)
  const [detalhe, setDetalhe] = useState<ProductWithRelations | null>(null)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [printerOpen, setPrinterOpen] = useState(false)

  const toggleSelect = useCallback((id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === products.length) return new Set()
      return new Set(products.map(p => p.id))
    })
  }, [products])

  const printerItems = useMemo<EtiquetasPrinterItem[]>(
    () => products
      .filter(p => selectedIds.has(p.id))
      .map(p => ({
        id: p.id,
        name: p.name,
        // A 2ª linha da etiqueta (referência interna) usa o code do produto
        supplier_reference: p.code,
        sale_price: p.promotional_price ?? p.sale_price,
        barcode_number: p.barcode_number,
        label_format: p.label_format,
        quantity: 1,
      })),
    [products, selectedIds],
  )

  const totalPages = Math.ceil(total / perPage)
  const from = Math.min((page - 1) * perPage + 1, total)
  const to = Math.min(page * perPage, total)

  function pushFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value) p.set(key, value)
    else p.delete(key)
    p.delete('page')
    startTransition(() => router.push(`?${p.toString()}`))
  }

  function pushPage(n: number) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('page', String(n))
    startTransition(() => router.push(`?${p.toString()}`))
  }

  function openCreate() { setEditing(null); setFormOpen(true) }
  function openEdit(prod: ProductWithRelations, e: React.MouseEvent) {
    e.stopPropagation(); setDetalhe(null); setEditing(prod); setFormOpen(true)
  }

  async function handleToggle(prod: ProductWithRelations, e: React.MouseEvent) {
    e.stopPropagation()
    if (!prod.is_active) {
      setTogglingId(prod.id)
      await toggleProductStatus(prod.id, true)
      setTogglingId(null)
      router.refresh()
      return
    }
    setConfirmDeactivateId(prod.id)
  }

  async function confirmDeactivate(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setTogglingId(id); setConfirmDeactivateId(null)
    await toggleProductStatus(id, false)
    setTogglingId(null)
    router.refresh()
  }

  const copyCode = useCallback((code: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(code)
  }, [])

  return (
    <>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <input
            className={styles.search}
            placeholder="Buscar por nome ou código..."
            defaultValue={filters.q}
            onChange={e => pushFilter('q', e.target.value)}
          />
          {isAdmin && (
            <SearchableSelect
              value={filters.store_id}
              onChange={v => pushFilter('store_id', v)}
              options={stores.map(s => ({ value: s.id, label: s.name }))}
              placeholder="Todas as lojas"
              searchable={stores.length > 5}
            />
          )}
          <SearchableSelect
            value={filters.category}
            onChange={v => pushFilter('category', v)}
            options={categories.map(c => ({ value: c, label: c }))}
            placeholder="Todas as categorias"
          />
          <SearchableSelect
            value={filters.material}
            onChange={v => pushFilter('material', v)}
            options={materials.map(m => ({ value: m, label: m }))}
            placeholder="Todos os materiais"
          />
          {isAdmin && (
            <SearchableSelect
              value={filters.supplier_id}
              onChange={v => pushFilter('supplier_id', v)}
              options={suppliers.map(s => ({ value: s.id, label: s.name }))}
              placeholder="Todos os fornecedores"
            />
          )}
          {isAdmin && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={filters.active === 'false'}
                onChange={e => pushFilter('active', e.target.checked ? 'false' : 'true')}
              />
              Mostrar inativos
            </label>
          )}
          <span className={styles.counter}>{total} produto{total !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.toolbarRight}>
          {selectedIds.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setPrinterOpen(true)}>
              <Printer size={14} />
              Imprimir etiquetas ({selectedIds.size})
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              Novo Produto
            </Button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        {products.length === 0 ? (
          <div className={styles.empty}>
            <span>Nenhum produto encontrado.</span>
            <span className={styles.emptyHint}>
              {isAdmin ? 'Clique em "Novo Produto" para adicionar.' : 'Tente ajustar os filtros.'}
            </span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={products.length > 0 && selectedIds.size === products.length}
                    ref={el => {
                      if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < products.length
                    }}
                    onChange={toggleSelectAll}
                    title="Selecionar todos da página"
                  />
                </th>
                <th>Produto</th>
                <th>Código</th>
                <th className="col-tertiary">Material</th>
                {isAdmin && <th className="col-secondary">Fornecedor</th>}
                {isAdmin && <th className="col-tertiary">Loja</th>}
                {isAdmin && <th className="col-secondary">Custo</th>}
                <th>Venda</th>
                <th className="col-tertiary">Promo</th>
                <th>Qtd.</th>
                <th>Status</th>
                {isAdmin && <th className={styles.actionsCol}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {products.map(prod => {
                const statusVenda = getStatusVenda(prod.last_sale_date, prod.created_at)
                return (
                  <tr
                    key={prod.id}
                    className={`${styles.row} ${!prod.is_active ? styles.rowInactive : ''}`}
                    onClick={() => setDetalhe(prod)}
                    title="Clique para ver detalhes"
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(prod.id)}
                        onChange={e => toggleSelect(prod.id, e)}
                      />
                    </td>
                    <td>
                      <div className={styles.productCell}>
                        {prod.photo_url ? (
                          <img src={prod.photo_url} alt={prod.name} className={styles.photo} />
                        ) : (
                          <div className={styles.photoPlaceholder}>
                            <Gem size={16} />
                          </div>
                        )}
                        <div className={styles.productInfo}>
                          <span className={styles.productName}>{prod.name}</span>
                          <span className={styles.productCategory}>{prod.category}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className={styles.code} onClick={e => copyCode(prod.code, e)} title="Clique para copiar">
                        {prod.code}
                      </span>
                    </td>

                    <td className={`${styles.mutedCell} col-tertiary`}>
                      <Badge variant="muted">{prod.material}</Badge>
                    </td>

                    {isAdmin && (
                      <td className={`${styles.mutedCell} col-secondary`}>{prod.suppliers?.name ?? '—'}</td>
                    )}

                    {isAdmin && (
                      <td className={`${styles.mutedCell} col-tertiary`}>{prod.stores?.name ?? '—'}</td>
                    )}

                    {isAdmin && (
                      <td className="col-secondary">
                        <span className={styles.costPrice}>{formatCurrency(prod.cost_price)}</span>
                      </td>
                    )}

                    <td>
                      <span className={styles.salePrice}>{formatCurrency(prod.sale_price)}</span>
                    </td>

                    <td className="col-tertiary">
                      {prod.promotional_price
                        ? <span className={styles.promoPrice}>{formatCurrency(prod.promotional_price)}</span>
                        : <span className={styles.mutedCell}>—</span>}
                    </td>

                    <td>
                      <span className={`${styles.qty} ${prod.quantity_in_stock === 0 ? styles.qtyZero : ''}`}>
                        {prod.quantity_in_stock}
                      </span>
                    </td>

                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {prod.is_active
                          ? <Badge variant="success">Ativo</Badge>
                          : <Badge variant="muted">Inativo</Badge>}
                        {statusVenda === 'parado' && <span className={styles.statusParado}>Parado</span>}
                        {statusVenda === 'critico' && <span className={styles.statusCritico}>Crítico</span>}
                      </div>
                    </td>

                    {isAdmin && (
                      <td onClick={e => e.stopPropagation()}>
                        <div className={styles.actions}>
                          {confirmDeactivateId === prod.id ? (
                            <>
                              <span className={styles.confirmText}>Inativar?</span>
                              <Button size="sm" variant="danger" loading={togglingId === prod.id} onClick={e => confirmDeactivate(prod.id, e)}>
                                Confirmar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setConfirmDeactivateId(null) }}>
                                Cancelar
                              </Button>
                            </>
                          ) : (
                            <>
                              <button className={styles.iconBtn} title="Editar" onClick={e => openEdit(prod, e)}>
                                <Pencil size={14} />
                              </button>
                              <button
                                className={`${styles.iconBtn} ${prod.is_active ? styles.iconBtnDanger : styles.iconBtnSuccess}`}
                                title={prod.is_active ? 'Inativar' : 'Reativar'}
                                disabled={togglingId === prod.id}
                                onClick={e => handleToggle(prod, e)}
                              >
                                <Power size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <span className={styles.paginationInfo}>
            Mostrando {from}–{to} de {total} produto{total !== 1 ? 's' : ''}
          </span>
          <div className={styles.paginationButtons}>
            <button className={styles.pageBtn} disabled={page <= 1} onClick={() => pushPage(page - 1)}>
              <ChevronLeft size={14} />
            </button>
            {buildPages(page, totalPages).map((p, i) =>
              p === '...'
                ? <span key={`dots-${i}`} className={styles.pageDots}>…</span>
                : <button
                    key={p}
                    className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}
                    onClick={() => pushPage(p as number)}
                  >{p}</button>
            )}
            <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => pushPage(page + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Modais */}
      {formOpen && isAdmin && (
        <ProdutoFormModal
          product={editing}
          suppliers={suppliers}
          stores={stores}
          categories={categories}
          materials={materials}
          onClose={() => setFormOpen(false)}
        />
      )}

      {detalhe && (
        <ProdutoDetalheModal
          produto={detalhe}
          isAdmin={isAdmin}
          onClose={() => setDetalhe(null)}
          onEdit={isAdmin ? (p) => { setDetalhe(null); setEditing(p as ProductWithRelations); setFormOpen(true) } : undefined}
        />
      )}

      <EtiquetasPrinter
        isOpen={printerOpen}
        onClose={() => setPrinterOpen(false)}
        initialItems={printerItems}
        title={`Imprimir etiquetas (${selectedIds.size})`}
      />
    </>
  )
}
