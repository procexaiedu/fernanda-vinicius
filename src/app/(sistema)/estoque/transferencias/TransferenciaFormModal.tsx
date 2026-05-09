'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { createTransfer } from './actions'
import styles from './TransferenciaFormModal.module.css'

interface Product {
  id: string
  code: string
  name: string
  quantity_in_stock: number
  store_id: string
  stores: { id: string; name: string } | null
}

interface Props {
  stores: { id: string; name: string }[]
  products: Product[]
  onClose: () => void
}

export default function TransferenciaFormModal({ stores, products, onClose }: Props) {
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [toStoreId, setToStoreId] = useState('')
  const [qty, setQty] = useState('1')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const searchResults = useMemo(() => {
    if (!query.trim() || selected) return []
    const q = query.toLowerCase()
    return products.filter(p =>
      p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [query, selected, products])

  const destStores = stores.filter(s => s.id !== selected?.store_id)

  function selectProduct(p: Product) {
    setSelected(p)
    setQuery(p.name)
    setQty('1')
    setToStoreId('')
  }

  function clearProduct() {
    setSelected(null)
    setQuery('')
    setToStoreId('')
    setQty('1')
  }

  async function handleSubmit() {
    setError('')
    if (!selected) { setError('Selecione um produto.'); return }
    if (!toStoreId) { setError('Selecione a loja de destino.'); return }
    const qtyNum = parseInt(qty)
    if (!qtyNum || qtyNum <= 0) { setError('Quantidade inválida.'); return }
    if (qtyNum > selected.quantity_in_stock) {
      setError(`Estoque insuficiente. Disponível: ${selected.quantity_in_stock} unidade(s).`)
      return
    }

    setSaving(true)
    const result = await createTransfer({
      product_id:    selected.id,
      from_store_id: selected.store_id,
      to_store_id:   toStoreId,
      quantity:      qtyNum,
      notes,
    })
    setSaving(false)

    if (!result.success) { setError(result.error ?? 'Erro ao transferir.'); return }
    router.refresh()
    onClose()
  }

  return (
    <Modal isOpen onClose={onClose} title="Nova Transferência de Estoque" size="md">
      <div className={styles.form}>

        {/* Busca de produto */}
        <div className={styles.field}>
          <label className={styles.label}>Produto <span className={styles.required}>*</span></label>
          {selected ? (
            <div>
              <div className={styles.selectedProduct}>
                <span className={styles.selectedCode}>{selected.code}</span>
                <span className={styles.selectedName}>{selected.name}</span>
                <span className={styles.selectedMeta}>
                  Origem: {selected.stores?.name ?? '—'} · Qtd. disponível: {selected.quantity_in_stock}
                </span>
              </div>
              <button
                style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={clearProduct}
              >
                Trocar produto
              </button>
            </div>
          ) : (
            <div className={styles.searchWrapper}>
              <input
                className={styles.input}
                placeholder="Buscar por nome ou código..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
              />
              {searchResults.length > 0 && (
                <div className={styles.searchResults}>
                  {searchResults.map(p => (
                    <div
                      key={p.id}
                      className={styles.searchResultItem}
                      onClick={() => selectProduct(p)}
                    >
                      <span className={styles.resultCode}>{p.code}</span>
                      <span className={styles.resultName}>{p.name}</span>
                      <span className={styles.resultMeta}>{p.stores?.name ?? '—'} · {p.quantity_in_stock} un.</span>
                    </div>
                  ))}
                </div>
              )}
              {query.trim() && searchResults.length === 0 && !selected && (
                <div className={styles.searchResults}>
                  <div className={styles.searchResultItem} style={{ cursor: 'default', color: 'var(--text-muted)' }}>
                    Nenhum produto encontrado.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Loja de destino */}
        <div className={styles.field}>
          <label className={styles.label}>Loja de Destino <span className={styles.required}>*</span></label>
          <select
            className={styles.select}
            value={toStoreId}
            onChange={e => setToStoreId(e.target.value)}
            disabled={!selected}
          >
            <option value="">Selecione...</option>
            {destStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Quantidade */}
        <div className={styles.field}>
          <label className={styles.label}>Quantidade <span className={styles.required}>*</span></label>
          <input
            className={styles.input}
            type="number"
            min="1"
            max={selected?.quantity_in_stock ?? 999}
            value={qty}
            onChange={e => setQty(e.target.value)}
            disabled={!selected}
          />
          {selected && (
            <span className={styles.qtyHint}>Disponível na origem: {selected.quantity_in_stock} unidade(s)</span>
          )}
        </div>

        {/* Observações */}
        <div className={styles.field}>
          <label className={styles.label}>Observações</label>
          <textarea
            className={styles.textarea}
            placeholder="Opcional..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button loading={saving} onClick={handleSubmit}>Confirmar Transferência</Button>
        </div>
      </div>
    </Modal>
  )
}
