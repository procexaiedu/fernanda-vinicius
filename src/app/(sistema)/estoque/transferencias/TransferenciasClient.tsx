'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ClipboardCheck, FileText, HandCoins, Plus, XCircle } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import Paginacao from '@/components/ui/Paginacao'
import { formatarDinheiro } from '@/lib/dinheiro'
import NovaTransferenciaModal from './NovaTransferenciaModal'
import ConferenciaModal from './ConferenciaModal'
import Romaneio from './Romaneio'
import { cancelarTransferencia } from './actions'
import AcertoConsignacaoModal from './AcertoConsignacaoModal'
import type { ConsignacaoAberta, LojaOption, Romaneio as RomaneioT } from './page'
import { ROTULO_TIPO } from '@/lib/consignacaoEntreLojas'
import styles from './TransferenciasClient.module.css'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'

const ROTULO: Record<RomaneioT['status'], string> = {
  enviada:    'Em trânsito · a conferir',
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
  consignacoesAbertas: ConsignacaoAberta[]
  isAdmin: boolean
  minhaLoja: string | null
  filtroStatus: string
  usuarioId: string
}

export default function TransferenciasClient({
  romaneios, total, page, perPage, lojas, consignacoesAbertas, isAdmin, minhaLoja, filtroStatus, usuarioId,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pendente, startTransition] = useTransition()

  const [novaAberta, setNovaAberta] = useState(false)
  const [conferindo, setConferindo] = useState<RomaneioT | null>(null)
  const [vendoRomaneio, setVendoRomaneio] = useState<RomaneioT | null>(null)
  const [cancelando, setCancelando] = useState<RomaneioT | null>(null)
  const [acertando, setAcertando] = useState<RomaneioT | null>(null)
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
    r.status === 'enviada' && (minhaLoja ? r.to_store_id === minhaLoja : isAdmin)

  /*
   * Cancelar devolve o saldo para a origem — então é da loja que MANDOU, e não
   * de qualquer admin. Era `isAdmin` sozinho, e a admin de Brasília podia
   * cancelar um romaneio de Campinas.
   */
  const podeCancelar = (r: RomaneioT) =>
    isAdmin && r.status === 'enviada' && (!minhaLoja || r.from_store_id === minhaLoja)
    // Lote do fornecedor não volta para "a origem": confere ou exclui a compra.
    && r.kind !== 'lote_fornecedor'

  async function confirmarCancelamento() {
    if (!cancelando) return
    setSalvandoCancel(true)
    setErroCancel(null)
    /* Sem o try, falha de rede ou sessão vencida deixava `salvandoCancel`
       preso em true: botão girando para sempre, sem mensagem. */
    let r: Awaited<ReturnType<typeof cancelarTransferencia>>
    try {
      r = await cancelarTransferencia(cancelando.id, motivo)
    } catch (e) {
      setErroCancel(mensagemDeErroAoSalvar(e))
      return
    } finally {
      setSalvandoCancel(false)
    }
    if (!r.success) { setErroCancel(r.error ?? 'Erro ao cancelar.'); return }
    setCancelando(null)
    setMotivo('')
    router.refresh()
  }

  /*
   * Acerto da consignação entre lojas: só admin (o valor sai do custo), depois
   * da conferência na chegada e uma vez só.
   */
  const podeAcertar = (r: RomaneioT) =>
    isAdmin && r.kind === 'consignacao' && (r.status === 'recebida' || r.status === 'divergente') && !r.acerto_at

  const emTransito = romaneios.filter(r => r.status === 'enviada')
  /* O que a loja de quem está olhando tem para conferir. */
  const aConferir = emTransito.filter(podeConferir)

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
              {aConferir.length > 0 && ` · ${aConferir.length} para você conferir`}
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
                {isAdmin && <th className={`${styles.num} col-num`}>Custo</th>}
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
                      {r.kind !== 'transferencia' && <span className={styles.tipo}>{ROTULO_TIPO[r.kind]}</span>}
                      {r.notes && <span className={styles.obs}>{r.notes}</span>}
                    </td>
                    <td className={`${styles.num} col-num`}>
                      {pecas}
                      <span className={styles.itens}>{enviados.length} {enviados.length === 1 ? 'item' : 'itens'}</span>
                    </td>
                    {isAdmin && <td className={`${styles.num} col-num`}>{formatarDinheiro(r.totals?.custo_total ?? 0)}</td>}
                    <td>
                      <Badge variant={COR[r.status]}>{ROTULO[r.status]}</Badge>
                      {isAdmin && r.kind === 'consignacao' && r.acerto_at && (
                        <span className={styles.obs}>acertada</span>
                      )}
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
                      {podeAcertar(r) && (
                        <button className={styles.acao} onClick={() => setAcertando(r)}
                          title="Acerto da consignação (o que ficou vira conta a pagar)">
                          <HandCoins size={14} />
                        </button>
                      )}
                      {podeCancelar(r) && (
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
          consignacoesAbertas={consignacoesAbertas}
          lojaPadrao={minhaLoja}
          usuarioId={usuarioId}
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

      {acertando && (
        <AcertoConsignacaoModal
          romaneio={acertando}
          onClose={() => setAcertando(null)}
          onAcertado={() => { setAcertando(null); router.refresh() }}
        />
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
