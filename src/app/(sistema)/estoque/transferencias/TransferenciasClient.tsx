'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import Button from '@/components/ui/Button'
import TransferenciaFormModal from './TransferenciaFormModal'
import type { TransferWithRelations } from './page'
import styles from './TransferenciasClient.module.css'

function buildPages(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

function fmtDate(s: string) {
  const [date] = s.split('T')
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

interface ProductForTransfer {
  id: string
  code: string
  name: string
  quantity_in_stock: number
  store_id: string
  stores: { id: string; name: string } | null
}

interface Props {
  transfers: TransferWithRelations[]
  total: number
  page: number
  perPage: number
  stores: { id: string; name: string }[]
  productsForTransfer: ProductForTransfer[]
  filters: { store_id: string }
}

export default function TransferenciasClient({
  transfers, total, page, perPage, stores, productsForTransfer, filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [formOpen, setFormOpen] = useState(false)

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
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <select className={styles.filterSelect} value={filters.store_id} onChange={e => pushFilter('store_id', e.target.value)}>
            <option value="">Todas as lojas</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className={styles.counter}>{total} transferência{total !== 1 ? 's' : ''}</span>
        </div>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus size={14} />
          Nova Transferência
        </Button>
      </div>

      <div className={styles.tableWrapper}>
        {transfers.length === 0 ? (
          <div className={styles.empty}>
            <span>Nenhuma transferência registrada.</span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Produto</th>
                <th>De → Para</th>
                <th>Qtd.</th>
                <th>Responsável</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.id}>
                  <td>{fmtDate(t.created_at)}</td>
                  <td>
                    <div className={styles.prodCell}>
                      <span className={styles.prodCode}>{t.products?.code ?? '—'}</span>
                      <span className={styles.prodName}>{t.products?.name ?? '—'}</span>
                    </div>
                  </td>
                  <td>
                    {t.from_store?.name ?? '—'} <span className={styles.arrow}>→</span> {t.to_store?.name ?? '—'}
                  </td>
                  <td><span className={styles.qty}>{t.quantity}</span></td>
                  <td>{t.users?.name ?? '—'}</td>
                  <td>{t.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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

      {formOpen && (
        <TransferenciaFormModal
          stores={stores}
          products={productsForTransfer}
          onClose={() => setFormOpen(false)}
        />
      )}
    </>
  )
}
