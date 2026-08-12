'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import styles from './SeletorPeriodo.module.css'

/**
 * Seletor de PERÍODO — um botão, um popover.
 *
 * Substitui os dois DatePicker separados de "de" e "até". Dois campos para uma
 * única ideia obrigavam abrir dois calendários, e nada impedia escolher um fim
 * anterior ao início (cada tela remendava isso por conta própria).
 *
 * Decisões:
 * - Dois meses lado a lado: intervalo que cruza a virada do mês (o caso comum,
 *   "últimos 15 dias") se resolve sem navegar.
 * - Mês em dropdown e ano em stepper: voltar um ano com seta de mês custava 12
 *   cliques.
 * - Atalhos à esquerda: na prática 90% das consultas são um deles.
 * - Popover em `position: fixed` com coordenadas medidas, não `absolute`: as
 *   barras de filtro têm `overflow` e cortariam o calendário.
 */

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export interface Periodo {
  /** YYYY-MM-DD — string vazia = sem limite */
  de: string
  ate: string
}

interface Props {
  value: Periodo
  onChange: (v: Periodo) => void
  /** Rótulo quando nada está selecionado. */
  placeholder?: string
  className?: string
}

// ─── Helpers de data (locais, sem fuso) ───────────────────────────────────────

function iso(ano: number, mes: number, dia: number) {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function hojeIso() {
  const t = new Date()
  return iso(t.getFullYear(), t.getMonth(), t.getDate())
}

function fmtCurta(s: string) {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

/** "01/08 – 12/08/2026" quando o ano é o mesmo; senão mostra os dois anos. */
function fmtIntervalo(p: Periodo) {
  if (!p.de && !p.ate) return null
  if (p.de && !p.ate) return `desde ${fmtCurta(p.de)}`
  if (!p.de && p.ate) return `até ${fmtCurta(p.ate)}`
  if (p.de === p.ate) return fmtCurta(p.de)
  const [ay] = p.de.split('-')
  const [by] = p.ate.split('-')
  if (ay === by) {
    const [, am, ad] = p.de.split('-')
    const [, bm, bd] = p.ate.split('-')
    return `${ad}/${am} – ${bd}/${bm}/${by}`
  }
  return `${fmtCurta(p.de)} – ${fmtCurta(p.ate)}`
}

function ultimoDia(ano: number, mes: number) {
  return new Date(ano, mes + 1, 0).getDate()
}

/** Atalhos — 90% das consultas reais caem em um destes. */
function atalhos(): Array<{ rotulo: string; periodo: Periodo }> {
  const t = new Date()
  const y = t.getFullYear(), m = t.getMonth(), d = t.getDate()
  const menos = (n: number) => {
    const x = new Date(y, m, d - n)
    return iso(x.getFullYear(), x.getMonth(), x.getDate())
  }
  const mesPassado = new Date(y, m - 1, 1)
  const mpY = mesPassado.getFullYear(), mpM = mesPassado.getMonth()
  return [
    { rotulo: 'Hoje',           periodo: { de: hojeIso(), ate: hojeIso() } },
    { rotulo: 'Últimos 7 dias', periodo: { de: menos(6),  ate: hojeIso() } },
    { rotulo: 'Últimos 30 dias',periodo: { de: menos(29), ate: hojeIso() } },
    { rotulo: 'Este mês',       periodo: { de: iso(y, m, 1), ate: iso(y, m, ultimoDia(y, m)) } },
    { rotulo: 'Mês passado',    periodo: { de: iso(mpY, mpM, 1), ate: iso(mpY, mpM, ultimoDia(mpY, mpM)) } },
    { rotulo: 'Este ano',       periodo: { de: iso(y, 0, 1), ate: iso(y, 11, 31) } },
  ]
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function SeletorPeriodo({ value, onChange, placeholder = 'Período', className }: Props) {
  const refBtn = useRef<HTMLButtonElement>(null)
  const refPop = useRef<HTMLDivElement>(null)
  /*
   * `top` OU `bottom`, nunca os dois.
   *
   * Abrindo para cima é `bottom` que vale: ancorar pela borda de baixo cola o
   * popover 6px acima do botão sem precisar saber a altura dele. A primeira versão
   * calculava `top = topoDoBotão - ALTURA` com ALTURA cravada em 340px; a altura
   * real é ~355px, então sobrava um vão de ~60px e o calendário parecia solto no
   * meio da tela, longe do botão que o abriu.
   */
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const [menuMes, setMenuMes] = useState(false)

  // Cursor do calendário: o mês da ESQUERDA. O da direita é sempre o seguinte.
  const base = value.de || value.ate || hojeIso()
  const [ano, setAno] = useState(() => Number(base.slice(0, 4)))
  const [mes, setMes] = useState(() => Number(base.slice(5, 7)) - 1)

  /** Primeiro clique arma o início; o segundo fecha o intervalo. */
  const [inicioParcial, setInicioParcial] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const aberto = pos !== null

  const fechar = useCallback(() => {
    setPos(null); setInicioParcial(null); setHover(null); setMenuMes(false)
  }, [])

  function abrir() {
    if (aberto) { fechar(); return }
    const r = refBtn.current?.getBoundingClientRect()
    if (!r) return
    // Ancora à esquerda do gatilho, mas puxa para dentro se não couber na janela.
    const LARGURA = 560
    const left = Math.max(8, Math.min(r.left, window.innerWidth - LARGURA - 8))

    /*
     * Abre para baixo quando houver espaço; senão para cima, ancorado por `bottom`.
     * Os 300px são só para DECIDIR o lado (a altura real medida é 289px) — a
     * posição em si não depende de estimativa nenhuma, então o vão fica sempre nos
     * mesmos 6px dos dois lados.
     */
    const espacoAbaixo = window.innerHeight - r.bottom
    const b = value.de || value.ate || hojeIso()
    setAno(Number(b.slice(0, 4)))
    setMes(Number(b.slice(5, 7)) - 1)
    setPos(espacoAbaixo >= 300
      ? { left, top: r.bottom + 6 }
      : { left, bottom: window.innerHeight - r.top + 6 })
  }

  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      const alvo = e.target as Node
      if (refPop.current?.contains(alvo) || refBtn.current?.contains(alvo)) return
      fechar()
    }
    function aoTeclar(e: KeyboardEvent) { if (e.key === 'Escape') fechar() }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto, fechar])

  function andarMes(n: number) {
    const d = new Date(ano, mes + n, 1)
    setAno(d.getFullYear()); setMes(d.getMonth())
  }

  function clicarDia(dataIso: string) {
    if (!inicioParcial) {
      setInicioParcial(dataIso)
      setHover(null)
      return
    }
    // Clicar antes do início inverte, em vez de recusar — é o que a pessoa quis.
    const [de, ate] = dataIso < inicioParcial ? [dataIso, inicioParcial] : [inicioParcial, dataIso]
    onChange({ de, ate })
    fechar()
  }

  // Faixa a pintar: a confirmada, ou a prévia enquanto o 2º clique não vem.
  const faixa = inicioParcial
    ? (hover && hover < inicioParcial ? { de: hover, ate: inicioParcial } : { de: inicioParcial, ate: hover ?? inicioParcial })
    : value

  const rotulo = fmtIntervalo(value)

  function Mes({ deslocamento }: { deslocamento: number }) {
    const d = new Date(ano, mes + deslocamento, 1)
    const y = d.getFullYear(), m = d.getMonth()
    const primeiroDow = new Date(y, m, 1).getDay()
    const total = ultimoDia(y, m)
    const hoje = hojeIso()

    return (
      <div className={styles.mes}>
        <div className={styles.mesTitulo}>{MESES[m]} {y}</div>
        <div className={styles.diasSemana}>
          {DIAS_SEMANA.map((s, i) => <span key={i}>{s}</span>)}
        </div>
        <div className={styles.grade}>
          {Array.from({ length: primeiroDow }).map((_, i) => <span key={`v${i}`} />)}
          {Array.from({ length: total }, (_, i) => i + 1).map(dia => {
            const s = iso(y, m, dia)
            const naFaixa = !!(faixa.de && faixa.ate && s >= faixa.de && s <= faixa.ate)
            const ehInicio = s === faixa.de
            const ehFim    = s === faixa.ate
            return (
              <button
                key={dia}
                type="button"
                className={[
                  styles.dia,
                  naFaixa ? styles.diaNaFaixa : '',
                  ehInicio ? styles.diaInicio : '',
                  ehFim ? styles.diaFim : '',
                  s === hoje ? styles.diaHoje : '',
                ].filter(Boolean).join(' ')}
                onClick={() => clicarDia(s)}
                onMouseEnter={() => inicioParcial && setHover(s)}
              >
                {dia}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        ref={refBtn}
        className={`${styles.gatilho} ${aberto ? styles.gatilhoAberto : ''} ${className ?? ''}`}
        onClick={abrir}
      >
        <CalendarRange size={13} className={styles.icone} />
        <span className={rotulo ? styles.gatilhoAtivo : styles.gatilhoVazio}>
          {rotulo ?? placeholder}
        </span>
        <ChevronDown size={11} className={styles.seta} />
      </button>

      {pos && (
        <div ref={refPop} className={styles.popover} style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}>
          <div className={styles.atalhos}>
            {atalhos().map(a => {
              const igual = value.de === a.periodo.de && value.ate === a.periodo.ate
              return (
                <button
                  key={a.rotulo}
                  type="button"
                  className={`${styles.atalho} ${igual ? styles.atalhoAtivo : ''}`}
                  onClick={() => { onChange(a.periodo); fechar() }}
                >
                  {a.rotulo}
                </button>
              )
            })}
          </div>

          <div className={styles.corpo}>
            {/* Navegação: seta de mês, mês em dropdown, ano em stepper */}
            <div className={styles.nav}>
              <button type="button" className={styles.navBtn} onClick={() => andarMes(-1)} title="Mês anterior">
                <ChevronLeft size={14} />
              </button>

              <div className={styles.navCentro}>
                <div className={styles.seletorMesWrap}>
                  <button type="button" className={styles.seletorMes} onClick={() => setMenuMes(v => !v)}>
                    {MESES[mes]} <ChevronDown size={11} />
                  </button>
                  {menuMes && (
                    <div className={styles.menuMes}>
                      {MESES_CURTOS.map((nome, i) => (
                        <button
                          key={nome}
                          type="button"
                          className={`${styles.menuMesItem} ${i === mes ? styles.menuMesItemAtivo : ''}`}
                          onClick={() => { setMes(i); setMenuMes(false) }}
                        >
                          {nome}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.stepperAno}>
                  <button type="button" className={styles.stepBtn} onClick={() => setAno(a => a - 1)} title="Ano anterior">
                    <ChevronLeft size={12} />
                  </button>
                  <span className={styles.anoValor}>{ano}</span>
                  <button type="button" className={styles.stepBtn} onClick={() => setAno(a => a + 1)} title="Ano seguinte">
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>

              <button type="button" className={styles.navBtn} onClick={() => andarMes(1)} title="Mês seguinte">
                <ChevronRight size={14} />
              </button>
            </div>

            <div className={styles.meses}>
              <Mes deslocamento={0} />
              <Mes deslocamento={1} />
            </div>

            <div className={styles.rodape}>
              <span className={styles.dica}>
                {inicioParcial
                  ? `Início ${fmtCurta(inicioParcial)} — escolha o fim`
                  : 'Clique no início e no fim do período'}
              </span>
              <button
                type="button"
                className={styles.limpar}
                onClick={() => { onChange({ de: '', ate: '' }); fechar() }}
              >
                Limpar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
