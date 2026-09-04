'use client'

import { useState } from 'react'
import { ShoppingCart, Receipt, CheckCircle2, FileText, X, MessageCircle,
} from 'lucide-react'
import NovaVendaForm from '../vendas/nova/NovaVendaForm'
import CaixaDoDia from './CaixaDoDia'
import PageHeader from '@/components/ui/PageHeader'
import { buscarCaixaDoDia, type CaixaDoDia as CaixaData } from './actions'
import styles from './pdv.module.css'
import { emitirNotaDaVenda } from '@/app/(sistema)/vendas/fiscal'
import { linkDaNotaNoWhatsApp } from '@/lib/fiscal/enviarDanfe'

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
  /*
   * A venda que acabou de sair. Guardada para oferecer a NOTA.
   *
   * O toast antigo sumia em 2,2s — bom para "deu certo", inútil para uma ação
   * que a cliente pode pedir. E a NFC-e tem 5 minutos de janela: se a barra
   * some antes de a cliente falar, a nota não sai mais na hora.
   *
   * Por isso este painel FICA até alguém fechar ou até a próxima venda.
   */
  const [ultimaVenda, setUltimaVenda] = useState<{ id: string } | null>(null)
  const [caixa, setCaixa]     = useState<CaixaData>(initialCaixa)

  async function handleSaved(saleId: string) {
    setUltimaVenda(saleId ? { id: saleId } : null)
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

      {ultimaVenda && (
        <PainelNota saleId={ultimaVenda.id} onFechar={() => setUltimaVenda(null)} />
      )}
    </div>
  )
}

// ─── Painel da venda recém-fechada ────────────────────────────────────────────

/**
 * O que aparece depois de salvar: confirmação e o botão de nota.
 *
 * **A nota é sob demanda, não automática.** Decisão do dono em 02/09: nem toda
 * venda leva nota, então quem decide é quem está no balcão, quando a cliente
 * pede. Emitir sozinho geraria documento fiscal para venda que ninguém pediu.
 *
 * O painel FICA até fechar ou até a próxima venda — diferente do toast antigo,
 * que sumia em 2,2s. A NFC-e tem 5 minutos de janela: se a barra some antes de
 * a cliente pedir, a nota não sai mais na hora e vira problema do dia seguinte.
 */
function PainelNota({ saleId, onFechar }: { saleId: string; onFechar: () => void }) {
  const [estado, setEstado] = useState<'pronta' | 'emitindo' | 'ok' | 'erro'>('pronta')
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [danfe, setDanfe] = useState<string | null>(null)
  /* Link pronto ANTES do clique: abrir o WhatsApp depois de um `await` é o que
   * o navegador barra como pop-up. */
  const [linkWhats, setLinkWhats] = useState<string | null>(null)

  async function emitir() {
    setEstado('emitindo'); setMensagem(null)
    const r = await emitirNotaDaVenda(saleId)
    if (r.success) {
      setEstado('ok')
      setDanfe(r.danfeUrl ?? null)
      setLinkWhats(linkDaNotaNoWhatsApp({
        telefone: r.telefone, danfeUrl: r.danfeUrl, nomeDaCliente: r.cliente, loja: r.loja,
      }))
    } else {
      setEstado('erro')
      /* As recusas da validação são mais úteis que a mensagem genérica: dizem
       * QUAL campo e o que fazer. Se houver, elas ganham a tela. */
      setMensagem(r.recusas?.length
        ? r.recusas.map(x => `${x.campo}: ${x.motivo}`).join(' · ')
        : (r.error ?? 'Não foi possível emitir.'))
    }
  }

  return (
    <div className={styles.painelVenda}>
      <div className={styles.painelLinha}>
        <CheckCircle2 size={18} />
        <strong>Venda registrada</strong>

        {estado === 'pronta' && (
          <button className={styles.btnNota} onClick={emitir}>
            <FileText size={14} /> Emitir nota
          </button>
        )}
        {estado === 'emitindo' && <span className={styles.painelInfo}>Emitindo…</span>}
        {estado === 'ok' && <span className={styles.painelOk}>Nota autorizada</span>}

        {/* Fechar continua disponível em qualquer estado: a operadora não pode
            ficar presa a este painel com a próxima cliente esperando. */}
        <button className={styles.btnFechar} onClick={onFechar} aria-label="Fechar">
          <X size={16} />
        </button>
      </div>

      {danfe && (
        <div className={styles.painelLinks}>
          <a className={styles.painelDanfe} href={danfe} target="_blank" rel="noopener noreferrer">
            Abrir DANFE para imprimir
          </a>
          {/*
            Só aparece se a venda tem cliente COM telefone. Venda avulsa não
            tem para quem mandar, e um botão que abre o WhatsApp em branco no
            meio do balcão é pior que botão nenhum.
          */}
          {linkWhats && (
            <a className={styles.painelWhats} href={linkWhats} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={13} /> Mandar no WhatsApp
            </a>
          )}
        </div>
      )}

      {estado === 'erro' && (
        <div className={styles.painelErro}>
          {mensagem}
          {/* Falhar não pode ser o fim: quase toda recusa é corrigível e a
              janela de 5 minutos ainda pode estar aberta. */}
          <button className={styles.btnTentar} onClick={emitir}>Tentar de novo</button>
        </div>
      )}
    </div>
  )
}
