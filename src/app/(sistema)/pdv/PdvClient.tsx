'use client'

import { useState } from 'react'
import { ShoppingCart, Receipt, CheckCircle2 } from 'lucide-react'
import NovaVendaForm from '../vendas/nova/NovaVendaForm'
import CaixaDoDia from './CaixaDoDia'
import PageHeader from '@/components/ui/PageHeader'
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

  async function handleSaved() {
    setToast(true)
    setTimeout(() => setToast(false), 2200)
    setSaleKey(k => k + 1)                                  // reseta o form p/ a próxima venda
    setCaixa(await buscarCaixaDoDia(caixa.storeId, date))   // atualiza o caixa do dia
  }

  return (
    <div className={styles.app}>
      {/*
        A barra própria do PDV saiu: marca, "Sair do PDV" e relógio existiam porque
        a tela era uma superfície separada, aberta em outra aba. Agora ela vive
        dentro do layout do sistema, então a sidebar já dá a marca e a navegação, e
        sair é só clicar em outro item do menu. Ficaram as duas abas, que são do
        PDV e não do sistema.
      */}
      <PageHeader title="PDV" subtitle="Registro rápido de venda e caixa do dia" />

      <nav className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'venda' ? styles.tabOn : ''}`} onClick={() => setTab('venda')}>
          <ShoppingCart size={16} /> Nova venda
        </button>
        <button className={`${styles.tab} ${tab === 'caixa' ? styles.tabOn : ''}`} onClick={() => setTab('caixa')}>
          <Receipt size={16} /> Caixa do dia
        </button>
      </nav>

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
