'use client'

import { useTransition } from 'react'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart2, ChevronLeft, ChevronRight, Gem, ArrowLeftRight } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import ProdutoDetalheModal from '@/components/produto/ProdutoDetalheModal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import type { ProductWithRelations, StoreOption } from '../produtos/page'
import styles from './EstoqueClient.module.css'

function getStatusVenda(lastSaleDate: string | null, createdAt: string): 'parado' | 'critico' | null {
  const now = Date.now()
  const ref = lastSaleDate ? new Date(lastSaleDate).getTime() : new Date(createdAt).getTime()
  const dias = Math.floor((now - ref) / 86400000)
  if (!lastSaleDate && dias < 30) return null
  if (dias >= 90) return 'critico'
  if (dias >= 60) return 'parado'
  return null
}

function buildPages(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(s: string | null) {
  if (!s) return '—'
  const [date] = s.split('T')
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

interface Filters {
  q: string
  store_id: string
  category: string
  material: string
  qty_zero: string
}

interface Props {
  products: ProductWithRelations[]
  total: number
  page: number
  perPage: number
  isAdmin: boolean
  stores: StoreOption[]
  categories: string[]
  materials: string[]
  filters: Filters
}

export default function EstoqueClient({
  products, total, page, perPage, isAdmin, stores, categories, materials, filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [detalhe, setDetalhe] = useState<ProductWithRelations | null>(null)

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

  return (
    <>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <input
            className={styles.search}
            placeholder="Buscar por nome, código ou código de barras..."
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
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={filters.qty_zero === 'true'}
                onChange={e => pushFilter('qty_zero', e.target.checked ? 'true' : '')}
              />
              Mostrar sem estoque
            </label>
          )}
          <span className={styles.counter}>{total} produto{total !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.toolbarRight}>
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => router.push('/estoque/transferencias')}>
              <ArrowLeftRight size={14} />
              Transferências
            </Button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        {products.length === 0 ? (
          <div className={styles.empty}>
            <span>Nenhum produto no estoque.</span>
            <span className={styles.emptyHint}>Tente ajustar os filtros.</span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Código</th>
                {isAdmin && <th className="col-secondary">Fornecedor</th>}
                {isAdmin && <th className="col-tertiary">Loja</th>}
                <th>Qtd.</th>
                <th>Venda</th>
                <th className="col-tertiary">Promo</th>
                <th className="col-tertiary">Última venda</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map(prod => {
                const statusVenda = getStatusVenda(prod.last_sale_date, prod.created_at)
                return (
                  <tr
                    key={prod.id}
                    className={styles.row}
                    onClick={() => setDetalhe(prod)}
                    title="Clique para ver detalhes"
                  >
                    <td>
                      <div className={styles.productCell}>
                        {prod.photo_url
                          ? <img src={prod.photo_url} alt={prod.name} className={styles.photo} />
                          : <div className={styles.photoPlaceholder}><Gem size={14} /></div>
                        }
                        <div className={styles.productInfo}>
                          <span className={styles.productName}>{prod.name}</span>
                          <span className={styles.productCategory}>{prod.category}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className={styles.code}>{prod.code}</span>
                    </td>

                    {isAdmin && <td className={`${styles.mutedCell} col-secondary`}>{prod.suppliers?.name ?? '—'}</td>}
                    {isAdmin && <td className={`${styles.mutedCell} col-tertiary`}>{prod.stores?.name ?? '—'}</td>}

                    <td>
                      <span className={`${styles.qty} ${prod.quantity_in_stock <= 1 ? styles.qtyLow : ''}`}>
                        {prod.quantity_in_stock}
                      </span>
                    </td>

                    <td><span className={styles.salePrice}>{fmt(prod.sale_price)}</span></td>

                    <td className="col-tertiary">
                      {prod.promotional_price
                        ? <span className={styles.promoPrice}>{fmt(prod.promotional_price)}</span>
                        : <span className={styles.mutedCell}>—</span>}
                    </td>

                    <td className={`${styles.mutedCell} col-tertiary`}>{fmtDate(prod.last_sale_date)}</td>

                    <td>
                      {statusVenda === 'parado' && <span className={styles.statusParado}>Parado</span>}
                      {statusVenda === 'critico' && <span className={styles.statusCritico}>Crítico</span>}
                      {!statusVenda && <span className={styles.mutedCell}>—</span>}
                    </td>

                    <td onClick={e => e.stopPropagation()}>
                      <button className={styles.iconBtn} title="Ver detalhes" onClick={() => setDetalhe(prod)}>
                        <BarChart2 size={14} />
                      </button>
                    </td>
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
          <span className={styles.paginationInfo}>Mostrando {from}–{to} de {total}</span>
          <div className={styles.paginationButtons}>
            <button className={styles.pageBtn} disabled={page <= 1} onClick={() => pushPage(page - 1)}>
              <ChevronLeft size={14} />
            </button>
            {buildPages(page, totalPages).map((p, i) =>
              p === '...'
                ? <span key={`dots-${i}`} className={styles.pageDots}>…</span>
                : <button key={p} className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`} onClick={() => pushPage(p as number)}>{p}</button>
            )}
            <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => pushPage(page + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {detalhe && (
        <ProdutoDetalheModal
          produto={detalhe}
          isAdmin={isAdmin}
          onClose={() => setDetalhe(null)}
        />
      )}
    </>
  )
}
