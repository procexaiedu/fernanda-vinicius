'use client'

import { useState, useCallback, useMemo, useTransition, useEffect } from 'react'
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
import Paginacao from '@/components/ui/Paginacao'
import ThOrdenavel from '@/components/ui/ThOrdenavel'
import { useOrdenacao } from '@/hooks/useOrdenacao'
import { usePaginacaoServidor } from '@/hooks/usePaginacaoServidor'
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
  categoryLabelMap: Record<string, 'A' | 'B'>
  defaultMarkupPct: number
  filters: Filters
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ProdutosClient({
  products, total, page, perPage, isAdmin, stores, suppliers, categories, materials, categoryLabelMap, defaultMarkupPct, filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pendente, startTransition] = useTransition()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductWithRelations | null>(null)
  const [detalhe, setDetalhe] = useState<ProductWithRelations | null>(null)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [printerOpen, setPrinterOpen] = useState(false)

  /*
   * 10 por tela, encadeada sobre os lotes de 50 do servidor: as 5 primeiras
   * páginas de cada lote são instantâneas e só a virada consulta de novo.
   * (`pushPage` é declaração de função, então já está içada aqui.)
   */
  /*
   * Ordena o lote na tela. Vale o lote de 50 do servidor — é o que dá resposta
   * instantânea ao clique; ordenar os 1031 inteiros exigiria mandar o `order` para
   * o Supabase e cada clique custaria ~500ms.
   */
  const ord = useOrdenacao(products, {
    produto:    { valor: p => p.name, tipo: 'texto' },
    codigo:     { valor: p => p.code, tipo: 'texto' },
    material:   { valor: p => p.material, tipo: 'texto' },
    fornecedor: { valor: p => p.suppliers?.name, tipo: 'texto' },
    loja:       { valor: p => p.stores?.name, tipo: 'texto' },
    custo:      { valor: p => p.cost_price, tipo: 'numero' },
    venda:      { valor: p => p.sale_price, tipo: 'numero' },
    promo:      { valor: p => p.promotional_price, tipo: 'numero' },
    qtd:        { valor: p => p.quantity_in_stock, tipo: 'numero' },
  })

  const pag = usePaginacaoServidor({
    itens: ord.ordenados,
    paginaServidor: page,
    porLoteServidor: perPage,
    totalItens: total,
    irParaPaginaServidor: pushPage,
    carregando: pendente,
  })

  const toggleSelect = useCallback((id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Escopo = a PÁGINA visível (10), não o lote do servidor (50). Marcar 50 peças
  // com 10 na tela levava a imprimir etiqueta de peça que a pessoa não tinha visto.
  const toggleSelectAll = useCallback(() => {
    const daPagina = pag.fatia.map(p => p.id)
    setSelectedIds(prev => {
      const todasMarcadas = daPagina.length > 0 && daPagina.every(id => prev.has(id))
      const next = new Set(prev)
      if (todasMarcadas) daPagina.forEach(id => next.delete(id))
      else daPagina.forEach(id => next.add(id))
      return next
    })
  }, [pag.fatia])

  const printerItems = useMemo<EtiquetasPrinterItem[]>(
    () => products
      .filter(p => selectedIds.has(p.id))
      .map(p => ({
        id: p.id,
        name: p.name,
        // A 2ª linha da etiqueta (referência interna) usa o code do produto
        supplier_reference: p.code,
        // Preço efetivo: só usa a promo se estiver ATIVA e > 0 (mesma regra do PDV).
        // `?? ` sozinho deixava promotional_price=0 passar e imprimia R$0,00.
        sale_price: p.promotional_active && p.promotional_price && p.promotional_price > 0
          ? p.promotional_price
          : p.sale_price,
        barcode_number: p.barcode_number,
        label_format: categoryLabelMap[p.category] ?? p.label_format,
        quantity: 1,
      })),
    [products, selectedIds, categoryLabelMap],
  )

  // Persistência dos filtros da URL (localStorage). Ao voltar ao módulo sem
  // nenhum filtro na URL, restaura o último usado.
  const FILTERS_KEY = 'fv-filtros-produtos'
  const FILTER_PARAMS = ['q', 'store_id', 'category', 'material', 'supplier_id', 'active']

  useEffect(() => {
    const hasFilters = [...FILTER_PARAMS, 'page'].some(k => searchParams.has(k))
    if (hasFilters) return
    try {
      const saved = localStorage.getItem(FILTERS_KEY)
      if (saved) router.replace(`?${saved}`)
    } catch { /* ignora */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pushFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value) p.set(key, value)
    else p.delete(key)
    p.delete('page')
    try { localStorage.setItem(FILTERS_KEY, p.toString()) } catch { /* ignora */ }
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
            placeholder="Buscar nome, código ou barras…"
            defaultValue={filters.q}
            onChange={e => pushFilter('q', e.target.value)}
          />
          {isAdmin && (
            <SearchableSelect
              value={filters.store_id}
              onChange={v => pushFilter('store_id', v)}
              options={stores.map(s => ({ value: s.id, label: s.name }))}
              placeholder="Loja"
              searchable={stores.length > 5}
            />
          )}
          <SearchableSelect
            value={filters.category}
            onChange={v => pushFilter('category', v)}
            options={categories.map(c => ({ value: c, label: c }))}
            placeholder="Categoria"
          />
          <SearchableSelect
            value={filters.material}
            onChange={v => pushFilter('material', v)}
            options={materials.map(m => ({ value: m, label: m }))}
            placeholder="Material"
          />
          {isAdmin && (
            <SearchableSelect
              value={filters.supplier_id}
              onChange={v => pushFilter('supplier_id', v)}
              options={suppliers.map(s => ({ value: s.id, label: s.name }))}
              placeholder="Fornecedor"
            />
          )}
          {isAdmin && (
            <label className="filtro-toggle">
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
                    checked={pag.fatia.length > 0 && pag.fatia.every(p => selectedIds.has(p.id))}
                    ref={el => {
                      if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < products.length
                    }}
                    onChange={toggleSelectAll}
                    title="Selecionar todos da página"
                  />
                </th>
                <ThOrdenavel ord={ord} coluna="produto">Produto</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="codigo">Código</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="material" className="col-tertiary">Material</ThOrdenavel>
                {isAdmin && <ThOrdenavel ord={ord} coluna="fornecedor" className="col-secondary">Fornecedor</ThOrdenavel>}
                {isAdmin && <ThOrdenavel ord={ord} coluna="loja" className="col-tertiary">Loja</ThOrdenavel>}
                {isAdmin && <ThOrdenavel ord={ord} coluna="custo" className="col-secondary col-num">Custo</ThOrdenavel>}
                <ThOrdenavel ord={ord} coluna="venda" className="col-num">Venda</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="promo" className="col-tertiary col-num">Promo</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="qtd" className="col-num">Qtd.</ThOrdenavel>
                <th className="col-center">Status</th>
                {isAdmin && <th className={styles.actionsCol}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {pag.fatia.map(prod => {
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

                    <td className={`${styles.mutedCell} ${styles.materialCell} col-tertiary`} title={prod.material}>
                      <Badge variant="muted">{prod.material}</Badge>
                    </td>

                    {isAdmin && (
                      <td className={`${styles.mutedCell} col-secondary col-truncate`} title={prod.suppliers?.name ?? undefined}>
                        {prod.suppliers?.name ?? '—'}
                      </td>
                    )}

                    {isAdmin && (
                      <td className={`${styles.mutedCell} col-tertiary col-truncate`} title={prod.stores?.name ?? undefined}>
                        {prod.stores?.name ?? '—'}
                      </td>
                    )}

                    {isAdmin && (
                      <td className="col-secondary col-num">
                        <span className={styles.costPrice}>{formatCurrency(prod.cost_price)}</span>
                      </td>
                    )}

                    <td className="col-num">
                      <span className={styles.salePrice}>{formatCurrency(prod.sale_price)}</span>
                    </td>

                    <td className="col-tertiary col-num">
                      {prod.promotional_price
                        ? <span className={styles.promoPrice}>{formatCurrency(prod.promotional_price)}</span>
                        : <span className={styles.mutedCell}>—</span>}
                    </td>

                    <td className="col-num">
                      <span className={`${styles.qty} ${prod.quantity_in_stock === 0 ? styles.qtyZero : ''}`}>
                        {prod.quantity_in_stock}
                      </span>
                    </td>

                    <td className="col-center">
                      <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
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

      {/* Paginação — 10 por tela, encadeada sobre os lotes de 50 do servidor */}
      <Paginacao
        pagina={pag.pagina}
        totalPaginas={pag.totalPaginas}
        totalItens={pag.totalItens}
        rotulo="produto"
        onIr={pag.irPara}
        carregando={pag.carregando}
      />

      {/* Modais */}
      {formOpen && isAdmin && (
        <ProdutoFormModal
          product={editing}
          suppliers={suppliers}
          stores={stores}
          categories={categories}
          materials={materials}
          defaultMarkupPct={defaultMarkupPct}
          onClose={() => setFormOpen(false)}
        />
      )}

      {detalhe && (
        <ProdutoDetalheModal
          produto={detalhe}
          categoryLabelMap={categoryLabelMap}
          categories={categories}
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
