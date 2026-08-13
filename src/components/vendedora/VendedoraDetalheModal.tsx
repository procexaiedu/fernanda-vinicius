'use client'

import { useEffect, useState } from 'react'
import { X, TrendingUp, ShoppingBag, Store, Award } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { buscarVendasDaVendedora, type TopVendedora, type VendaDaVendedora } from '@/app/(sistema)/actions'
import styles from './VendedoraDetalheModal.module.css'

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

type SaleRow = VendaDaVendedora

interface Props {
  vendedora: TopVendedora
  month: number
  year: number
  isAdmin?: boolean
  onClose: () => void
}

export default function VendedoraDetalheModal({ vendedora, month, year, isAdmin = false, onClose }: Props) {
  const [sales, setSales]     = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(true)

  /*
   * A lista vem da MESMA fonte do ranking: server action com client admin e o
   * critério `seller_id ?? user_id`.
   *
   * Antes era consulta do navegador filtrando só por `user_id`. Como as lojas
   * operam com um login compartilhado, `user_id` é quem abriu o caixa, não quem
   * vendeu — a Rosi tinha 16 vendas no ranking e a lista vinha vazia, e a Fernanda
   * mostrava as 26 do mês sob um cabeçalho que dizia 10.
   */
  useEffect(() => {
    let cancelado = false
    setLoading(true)
    buscarVendasDaVendedora(vendedora.id, month, year)
      .then(r => { if (!cancelado) setSales(r) })
      .finally(() => { if (!cancelado) setLoading(false) })
    return () => { cancelado = true }
  }, [vendedora.id, month, year])

  const totalReceita = sales.reduce((s, r) => s + r.total, 0)
  const totalCmv     = sales.reduce((s, r) => s + r.total_cost, 0)
  const lucro        = totalReceita - totalCmv
  const margem       = totalReceita > 0 ? (lucro / totalReceita) * 100 : 0

  function getInitials(name: string) {
    const parts = name.trim().split(' ').filter(Boolean)
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  return (
    <Modal isOpen onClose={onClose} size="md" hideHeader>
      <div className={styles.header}>
        <div className={styles.avatar}>{getInitials(vendedora.name)}</div>
        <div className={styles.info}>
          <h2 className={styles.name}>{vendedora.name}</h2>
          <div className={styles.meta}>
            <Store size={12} />
            <span>{vendedora.store_name ?? 'Sem loja'}</span>
          </div>
        </div>
        <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <ShoppingBag size={14} className={styles.statIcon} />
          <div className={styles.statValue}>{vendedora.nrVendas}</div>
          <div className={styles.statLabel}>Vendas no mês</div>
        </div>
        <div className={styles.statCard}>
          <TrendingUp size={14} className={styles.statIcon} />
          <div className={styles.statValue}>{fmt(vendedora.totalVendido)}</div>
          <div className={styles.statLabel}>Total vendido</div>
        </div>
        {isAdmin && (
          <div className={styles.statCard}>
            <Award size={14} className={styles.statIcon} />
            <div className={styles.statValue}>{margem.toFixed(1)}%</div>
            <div className={styles.statLabel}>Margem bruta</div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Vendas do mês</div>
        {loading ? (
          <div className={styles.empty}>Carregando...</div>
        ) : sales.length === 0 ? (
          <div className={styles.empty}>Nenhuma venda no período</div>
        ) : (
          <div className={styles.salesList}>
            {sales.map(s => (
              <div key={s.id} className={styles.saleRow}>
                <div className={styles.saleDate}>{fmtDate(s.sale_date)}</div>
                <div className={styles.saleStore}>{s.store_name}</div>
                <div className={styles.saleItems}>{s.items_count} {s.items_count === 1 ? 'item' : 'itens'}</div>
                <div className={styles.saleTotal}>{fmt(s.total)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
