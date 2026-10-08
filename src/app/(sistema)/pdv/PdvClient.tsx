'use client'

import { useState } from 'react'
import { ShoppingCart, Receipt } from 'lucide-react'
import NovaVendaForm from '../vendas/nova/NovaVendaForm'
import CaixaDoDia from './CaixaDoDia'
import PageHeader from '@/components/ui/PageHeader'
import { buscarCaixaDoDia, type CaixaDoDia as CaixaData } from './actions'
import styles from './pdv.module.css'
import PainelNota from '@/components/venda/PainelNota'
import MetaLojaCard from '@/components/metas/MetaLojaCard'
import type { PainelMeta } from '@/lib/metas/loja'

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
  painelMeta: PainelMeta
  nomeLoja: string | null
}

export default function PdvClient({
  stores, products, customers, settings, userProfile, users, initialCaixa, caixaStoreId, date, painelMeta, nomeLoja,
}: Props) {
  const [tab, setTab]         = useState<'venda' | 'caixa'>('venda')
  const [saleKey, setSaleKey] = useState(0)      // bump p/ remontar (resetar) o form
  /*
   * A venda que acabou de sair. Guardada para oferecer a NOTA.
   *
   * O toast antigo sumia em 2,2s — bom para "deu certo", inútil para uma ação
   * que a cliente pode pedir. E a NFC-e tem 5 minutos de janela: se a barra
   * some antes de a cliente falar, a nota não sai mais na hora.
   *
   * Por isso este painel FICA até alguém fechar ou até a próxima venda.
   */
  /* `aviso`: a venda gravou com pendência (estoque/pagamento). O form remonta
   * para a próxima cliente, então a mensagem mora aqui, no painel que fica. */
  const [ultimaVenda, setUltimaVenda] = useState<{ id: string; aviso?: string } | null>(null)
  const [caixa, setCaixa]     = useState<CaixaData>(initialCaixa)

  async function handleSaved(saleId: string, aviso?: string) {
    setUltimaVenda(saleId ? { id: saleId, aviso } : null)
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

      <MetaLojaCard progresso={painelMeta.progresso} erro={painelMeta.erro} nomeLoja={nomeLoja} />

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

      {ultimaVenda && (
        <PainelNota key={ultimaVenda.id} saleId={ultimaVenda.id} aviso={ultimaVenda.aviso} onFechar={() => setUltimaVenda(null)} />
      )}
    </div>
  )
}
