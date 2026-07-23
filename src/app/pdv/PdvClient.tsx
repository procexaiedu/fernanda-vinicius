'use client'

import { useState, useEffect } from 'react'
import { ShoppingCart, Receipt, CheckCircle2 } from 'lucide-react'
import NovaVendaForm from '../(sistema)/vendas/nova/NovaVendaForm'
import CaixaDoDia from './CaixaDoDia'
import { buscarCaixaDoDia, type CaixaDoDia as CaixaData } from './actions'
import styles from './pdv.module.css'

type FormProps = React.ComponentProps<typeof NovaVendaForm>

interface Props {
  stores: FormProps['stores']
  products: FormProps['products']
  customers: FormProps['customers']
  settings: FormProps['settings']
  userProfile: FormProps['userProfile']
  users: FormProps['users']
  initialCaixa: CaixaData
  caixaStoreId: string
  date: string
}

export default function PdvClient({
  stores, products, customers, settings, userProfile, users, initialCaixa, caixaStoreId, date,
}: Props) {
  const [tab, setTab]         = useState<'venda' | 'caixa'>('venda')
  const [saleKey, setSaleKey] = useState(0)      // bump p/ remontar (resetar) o form
  const [toast, setToast]     = useState(false)
  const [caixa, setCaixa]     = useState<CaixaData>(initialCaixa)
  const [clock, setClock]     = useState('')

  useEffect(() => {
    function tick() {
      const d = new Date()
      setClock(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [])

  async function handleSaved() {
    setToast(true)
    setTimeout(() => setToast(false), 2200)
    setSaleKey(k => k + 1)                                  // reseta o form p/ a próxima venda
    setCaixa(await buscarCaixaDoDia(caixa.storeId, date))   // atualiza o caixa do dia
  }

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandName}>Fernanda <b>Vinícius</b></span>
          <span className={styles.brandSub}>PDV</span>
        </div>
        <nav className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'venda' ? styles.tabOn : ''}`} onClick={() => setTab('venda')}>
            <ShoppingCart size={16} /> Nova venda
          </button>
          <button className={`${styles.tab} ${tab === 'caixa' ? styles.tabOn : ''}`} onClick={() => setTab('caixa')}>
            <Receipt size={16} /> Caixa do dia
          </button>
        </nav>
        <div className={styles.spacer} />
        <a href="/vendas" className={styles.exit}>Sair do PDV</a>
        <span className={styles.clock}>{clock}</span>
      </header>

      <main className={styles.main}>
        {/* Ambas ficam montadas (display toggle) p/ não perder a venda em andamento ao trocar de aba */}
        <div style={{ display: tab === 'venda' ? 'block' : 'none' }} className={styles.vendaWrap}>
          <NovaVendaForm
            key={saleKey}
            stores={stores}
            products={products}
            customers={customers}
            settings={settings}
            userProfile={userProfile}
            users={users}
            onSaved={handleSaved}
          />
        </div>

        <div style={{ display: tab === 'caixa' ? 'block' : 'none' }}>
          <CaixaDoDia
            stores={stores}
            isAdmin={userProfile.role === 'admin'}
            date={date}
            caixa={caixa}
            onCaixaChange={setCaixa}
          />
        </div>
      </main>

      {toast && (
        <div className={styles.toast}><CheckCircle2 size={18} /> Venda registrada!</div>
      )}
    </div>
  )
}
