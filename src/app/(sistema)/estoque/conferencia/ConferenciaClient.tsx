'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine, AlertTriangle, ChevronRight, Store } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { abrirConferencia } from './actions'
import type { SessaoResumo, EscopoDisponivel } from './page'
import styles from './ConferenciaClient.module.css'

interface Props {
  sessoes: SessaoResumo[]
  escopos: EscopoDisponivel[]
  totalLoja: { pecas: number; unidades: number; cadastros: number }
  stores: { id: string; name: string; pecas: number; unidades: number; cadastros: number }[]
  /** Loja cujos escopos estão na tela — resolvida no servidor. */
  lojaAtual: string | null
  isAdmin: boolean
  abertaId: string | null
}

function fmtDataHora(s: string) {
  const d = new Date(s)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function duracao(inicio: string, fim: string | null) {
  if (!fim) return '—'
  const min = Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60000)
  if (min < 60) return `${min}min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

export default function ConferenciaClient({ sessoes, escopos, totalLoja, stores, lojaAtual, isAdmin, abertaId }: Props) {
  const router = useRouter()
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [escolhido, setEscolhido] = useState<string | null>(null)   // categoria, ou '__loja__'

  /*
   * Trocar de loja vai pela URL, não por estado local: os escopos e as
   * contagens são calculados no servidor. Com estado local, o seletor mudava e
   * os cards continuavam os da loja anterior — e a conferência abriria com o
   * escopo errado.
   */
  function trocarLoja(id: string) {
    setEscolhido(null)
    router.push(`/estoque/conferencia?store_id=${id}`)
  }

  async function comecar() {
    if (!escolhido) return
    setErro(null)
    setAbrindo(true)
    const res = await abrirConferencia({
      store_id:    isAdmin ? (lojaAtual ?? undefined) : undefined,
      scope_type:  escolhido === '__loja__' ? 'loja' : 'categoria',
      scope_value: escolhido === '__loja__' ? null : escolhido,
    })
    setAbrindo(false)
    if (!res.success || !res.session_id) {
      setErro(res.error ?? 'Não foi possível abrir a conferência.')
      return
    }
    router.push(`/estoque/conferencia/${res.session_id}`)
  }

  return (
    <>
      {/* Conferência em andamento tem precedência sobre tudo: se existe uma
          aberta, o caminho é voltar para ela, não começar outra. */}
      {abertaId && (
        <button className={styles.emAndamento} onClick={() => router.push(`/estoque/conferencia/${abertaId}`)}>
          <span className={styles.pulso} aria-hidden />
          <span>Existe uma conferência em andamento — continuar de onde parou</span>
          <ChevronRight size={16} />
        </button>
      )}

      {!abertaId && (
        <div className={styles.novaCard}>
          <h2 className={styles.novaTitulo}>O que você vai conferir agora?</h2>

          {isAdmin && stores.length > 1 && (
            <div className={styles.lojaSelect}>
              <Store size={14} />
              <SearchableSelect
                value={lojaAtual ?? ''}
                onChange={trocarLoja}
                /* O tamanho de cada loja no rótulo: sem isso a escolha é às
                   cegas, e abrir na loja errada só se descobre no fim. */
                options={stores.map(s => ({
                  value: s.id,
                  label: `${s.name} — ${s.unidades} unidade${s.unidades !== 1 ? 's' : ''}`,
                }))}
                placeholder="Loja"
              />
            </div>
          )}

          <div className={styles.escopoGrid}>
            {escopos.map(e => (
              <button
                key={e.categoria}
                className={`${styles.escopo} ${escolhido === e.categoria ? styles.escopoAtivo : ''}`}
                onClick={() => setEscolhido(e.categoria)}
              >
                <span className={styles.escopoNome}>{e.categoria}</span>
                {/*
                  UNIDADES em destaque: é um bipe por unidade, então é ele que
                  diz o tamanho do trabalho. "Peças" é secundário — peça com 3
                  unidades exige 3 leituras.
                */}
                <span className={styles.escopoQtd}>{e.unidades} unidade{e.unidades !== 1 ? 's' : ''}</span>
                <span className={styles.escopoDetalhe}>
                  {e.pecas} peça{e.pecas !== 1 ? 's' : ''}
                  {e.cadastros > e.pecas && ` · ${e.cadastros - e.pecas} sem saldo`}
                </span>
              </button>
            ))}
          </div>

          <button
            className={`${styles.escopoLoja} ${escolhido === '__loja__' ? styles.escopoAtivo : ''}`}
            onClick={() => setEscolhido('__loja__')}
          >
            <span className={styles.escopoNome}>Loja inteira</span>
            <span className={styles.escopoQtd}>
              {totalLoja.unidades} unidades
              <span className={styles.escopoDetalhe}>
                {totalLoja.pecas} peças
                {totalLoja.cadastros > totalLoja.pecas && ` · ${totalLoja.cadastros - totalLoja.pecas} sem saldo`}
              </span>
            </span>
          </button>

          {/* O escopo não é filtro: é ele que define o que conta como falta. */}
          <div className={styles.aviso}>
            <AlertTriangle size={15} />
            <span>
              Peça com saldo que não for bipada conta como <strong>falta</strong> e tem o
              saldo zerado no fim. Escolha um escopo que você vai varrer inteiro — parar no
              meio dá baixa em tudo que faltou alcançar.
              {' '}Cadastro <em>sem saldo</em> também entra no escopo, mas não vira falta:
              bipar um deles <strong>devolve</strong> a peça ao estoque.
            </span>
          </div>

          {erro && <div className={styles.erro}>{erro}</div>}

          <div className={styles.novaAcoes}>
            <Button onClick={comecar} disabled={!escolhido} loading={abrindo}>
              <ScanLine size={15} /> Começar a contar
            </Button>
          </div>
        </div>
      )}

      <h2 className={styles.historicoTitulo}>Conferências anteriores</h2>

      {sessoes.length === 0 ? (
        <div className={styles.vazio}>Nenhuma conferência registrada ainda.</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Escopo</th>
                <th>Quem</th>
                <th className="col-num">Duração</th>
                <th className="col-num">Bate</th>
                <th className="col-num">Falta</th>
                <th className="col-num">Sobra</th>
                <th className="col-center">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessoes.map(s => {
                const t = s.totals ?? {}
                return (
                  <tr key={s.id} className={styles.row} onClick={() => router.push(`/estoque/conferencia/${s.id}`)}>
                    <td>{fmtDataHora(s.started_at)}</td>
                    <td className={styles.escopoCel}>
                      {s.scope_type === 'loja' ? 'Loja inteira' : s.scope_value}
                      <span className={styles.escopoCount}> · {s.em_escopo} peças</span>
                    </td>
                    <td className={styles.muted}>{s.users?.full_name ?? '—'}</td>
                    <td className="col-num">{duracao(s.started_at, s.closed_at)}</td>
                    <td className="col-num">{s.status === 'fechada' ? (t.bate ?? 0) : '—'}</td>
                    <td className="col-num">
                      {s.status === 'fechada'
                        ? <span className={(t.falta ?? 0) > 0 ? styles.falta : undefined}>{t.falta ?? 0}</span>
                        : '—'}
                    </td>
                    <td className="col-num">
                      {s.status === 'fechada'
                        ? <span className={(t.sobra ?? 0) > 0 ? styles.sobra : undefined}>{t.sobra ?? 0}</span>
                        : '—'}
                    </td>
                    <td className="col-center">
                      {s.status === 'contando'  && <Badge variant="warning">Em andamento</Badge>}
                      {s.status === 'fechada'   && <Badge variant="success">Fechada</Badge>}
                      {s.status === 'cancelada' && <Badge variant="muted">Cancelada</Badge>}
                    </td>
                    <td><ChevronRight size={15} className={styles.muted} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
