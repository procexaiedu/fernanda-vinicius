'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ClipboardCheck, FileText, Plus, XCircle } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import Paginacao from '@/components/ui/Paginacao'
import { formatarDinheiro } from '@/lib/dinheiro'
import NovaTransferenciaModal from './NovaTransferenciaModal'
import ConferenciaModal from './ConferenciaModal'
import Romaneio from './Romaneio'
import { cancelarTransferencia } from './actions'
import type { LojaOption, Romaneio as RomaneioT } from './page'
import styles from './TransferenciasClient.module.css'
import SearchableSelect from '@/components/ui/SearchableSelect'

const ROTULO: Record<RomaneioT['status'], string> = {
  enviada:    'Em trânsito',
  recebida:   'Recebida',
  divergente: 'Divergência',
  cancelada:  'Cancelada',
}

const COR: Record<RomaneioT['status'], 'warning' | 'success' | 'danger' | 'muted'> = {
  enviada:    'warning',
  recebida:   'success',
  divergente: 'danger',
  cancelada:  'muted',
}

function dataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

interface Props {
  romaneios: RomaneioT[]
  total: number
  page: number
  perPage: number
  lojas: LojaOption[]
  isAdmin: boolean
  minhaLoja: string | null
  filtroStatus: string
}

export default function TransferenciasClient({
  romaneios, total, page, perPage, lojas, isAdmin, minhaLoja, filtroStatus,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pendente, startTransition] = useTransition()

  const [novaAberta, setNovaAberta] = useState(false)
  const [conferindo, setConferindo] = useState<RomaneioT | null>(null)
  const [vendoRomaneio, setVendoRomaneio] = useState<RomaneioT | null>(null)
  const [cancelando, setCancelando] = useState<RomaneioT | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroCancel, setErroCancel] = useState<string | null>(null)
  const [salvandoCancel, setSalvandoCancel] = useState(false)

  function pushParam(chave: string, valor: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (valor) p.set(chave, valor); else p.delete(chave)
    if (chave !== 'page') p.delete('page')
    startTransition(() => router.push(`?${p.toString()}`))
  }

  /*
   * "Conferir" só aparece para quem RECEBE.
   *
   * O admin vê tudo, mas o botão continua sendo da loja de destino: quem confere
   * é quem tem a caixa na mão. Deixar Campinas dar entrada numa caixa que está
   * em Brasília é transformar conferência em digitação.
   */
  const podeConferir = (r: RomaneioT) =>
    r.status === 'enviada' && (isAdmin || r.to_store_id === minhaLoja)

  async function confirmarCancelamento() {
    if (!cancelando) return
    setSalvandoCancel(true)
    setErroCancel(null)
    const r = await cancelarTransferencia(cancelando.id, motivo)
    setSalvandoCancel(false)
    if (!r.success) { setErroCancel(r.error ?? 'Erro ao cancelar.'); return }
    setCancelando(null)
    setMotivo('')
    router.refresh()
  }

  const emTransito = romaneios.filter(r => r.status === 'enviada')

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <SearchableSelect
            value={filtroStatus}
            onChange={v => pushParam('status', v)}
            options={[
              { value: 'enviada',    label: 'Em trânsito' },
              { value: 'recebida',   label: 'Recebidas' },
              { value: 'divergente', label: 'Com divergência' },
              { value: 'cancelada',  label: 'Canceladas' },
            ]}
            placeholder="Todos os status"
            searchable={false}
            disabled={pendente}
          />
          <span className={styles.contador}>
            {total} transferência{total !== 1 ? 's' : ''}
          </span>
          {emTransito.length > 0 && (
            <span className={styles.transito}>
              {emTransito.length} em trânsito — o saldo delas não está em nenhuma loja
            </span>
          )}
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setNovaAberta(true)}>
            <Plus size={14} />
            Nova transferência
          </Button>
        )}
      </div>

      <div className={styles.tableWrapper}>
        {romaneios.length === 0 ? (
          <div className={styles.vazio}>
            <span>Nenhuma transferência.</span>
            {isAdmin && <span className={styles.vazioDica}>Clique em &quot;Nova transferência&quot; para começar.</span>}
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Enviada</th>
                <th>Rota</th>
                <th className={`${styles.num} col-num`}>Peças</th>
                <th className={`${styles.num} col-num`}>Custo</th>
                <th>Status</th>
                <th className="col-tertiary">Responsáveis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {romaneios.map(r => {
                const enviados = r.itens.filter(i => i.quantity_sent > 0)
                const pecas = r.totals?.pecas ?? enviados.reduce((s, i) => s + i.quantity_sent, 0)
                const faltas = r.itens.filter(i => i.divergence_type === 'falta').length
                const sobras = r.itens.filter(i => i.divergence_type === 'sobra').length
                return (
                  <tr key={r.id}>
                    <td className="col-date">{dataHora(r.sent_at)}</td>
                    <td>
                      <span className={styles.rota}>{r.de} <span className={styles.seta}>→</span> {r.para}</span>
                      {r.notes && <span className={styles.obs}>{r.notes}</span>}
                    </td>
                    <td className={`${styles.num} col-num`}>
                      {pecas}
                      <span className={styles.itens}>{enviados.length} {enviados.length === 1 ? 'item' : 'itens'}</span>
                    </td>
                    <td className={`${styles.num} col-num`}>{formatarDinheiro(r.totals?.custo_total ?? 0)}</td>
                    <td>
                      <Badge variant={COR[r.status]}>{ROTULO[r.status]}</Badge>
                      {r.status === 'divergente' && (
                        <span className={styles.divergencia}>
                          {faltas > 0 && `${faltas} falta${faltas > 1 ? 's' : ''}`}
                          {faltas > 0 && sobras > 0 && ' · '}
                          {sobras > 0 && `${sobras} sobra${sobras > 1 ? 's' : ''}`}
                        </span>
                      )}
                    </td>
                    <td className="col-tertiary">
                      <span className={styles.pessoa}>{r.enviou}</span>
                      {r.recebeu && <span className={styles.pessoa}>recebeu: {r.recebeu}</span>}
                    </td>
                    <td className={styles.acoes}>
                      <button className={styles.acao} onClick={() => setVendoRomaneio(r)} title="Ver romaneio">
                        <FileText size={14} />
                      </button>
                      {podeConferir(r) && (
                        <button className={`${styles.acao} ${styles.acaoPrincipal}`}
                          onClick={() => setConferindo(r)} title="Conferir chegada">
                          <ClipboardCheck size={14} />
                        </button>
                      )}
                      {isAdmin && r.status === 'enviada' && (
                        <button className={styles.acao} onClick={() => { setCancelando(r); setMotivo(''); setErroCancel(null) }}
                          title="Cancelar e devolver à origem">
                          <XCircle size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Paginacao
        pagina={page}
        totalPaginas={Math.max(1, Math.ceil(total / perPage))}
        totalItens={total}
        rotulo="transferência"
        rotuloPlural="transferências"
        onIr={n => pushParam('page', String(n))}
        carregando={pendente}
      />

      {novaAberta && (
        <NovaTransferenciaModal
          lojas={lojas}
          lojaPadrao={minhaLoja}
          onClose={() => setNovaAberta(false)}
          onEnviado={() => { setNovaAberta(false); router.refresh() }}
        />
      )}

      {conferindo && (
        <ConferenciaModal romaneio={conferindo} onClose={() => setConferindo(null)} />
      )}

      {vendoRomaneio && (
        <Modal isOpen size="xl" hideHeader onClose={() => setVendoRomaneio(null)}>
          <Romaneio r={vendoRomaneio} onFechar={() => setVendoRomaneio(null)} />
        </Modal>
      )}

      {cancelando && (
        <Modal isOpen title="Cancelar transferência" onClose={() => setCancelando(null)}>
          <div className={styles.cancelBox}>
            <p>
              As <strong>{cancelando.totals?.pecas ?? 0} peças</strong> voltam para o estoque de{' '}
              <strong>{cancelando.de}</strong>. Só dá para cancelar enquanto ninguém conferiu a chegada.
            </p>
            <label>
              <span>Motivo</span>
              <input value={motivo} onChange={e => setMotivo(e.target.value)}
                placeholder="Ex.: a caixa não saiu da loja" autoFocus />
            </label>
            {erroCancel && <div className={styles.cancelErro}>{erroCancel}</div>}
            <div className={styles.cancelAcoes}>
              <Button variant="ghost" onClick={() => setCancelando(null)} disabled={salvandoCancel}>Voltar</Button>
              <Button variant="danger" onClick={confirmarCancelamento}
                loading={salvandoCancel} disabled={!motivo.trim()}>
                Cancelar transferência
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
