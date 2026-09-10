'use client'

import { useState, useRef, useLayoutEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import styles from './DatePicker.module.css'

const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]
const WEEKDAYS = ['D','S','T','Q','Q','S','S']

interface Props {
  value: string        // YYYY-MM-DD
  onChange: (v: string) => void
  className?: string
}

export default function DatePicker({ value, onChange, className }: Props) {
  const btnRef   = useRef<HTMLButtonElement>(null)
  const calRef   = useRef<HTMLDivElement>(null)
  const [open, setOpen]   = useState(false)

  /*
   * De que lado o calendário abre.
   *
   * Ele nascia sempre colado à esquerda do campo, com largura fixa. No último
   * campo da linha — "Prometido para", em Consertos — isso jogava metade do
   * calendário para fora da janela: a coluna de sábado e os dias 4, 11, 18 e
   * 25 ficavam inalcançáveis.
   *
   * A medida é feita DEPOIS de renderizar, com o tamanho real do calendário, e
   * não com a largura escrita no CSS: as duas divergem (padding, borda, fonte
   * do sistema) e foi assim que a estimativa "itens × altura" já errou antes
   * nos dropdowns. `useLayoutEffect` corre antes da pintura, então ninguém vê
   * o calendário pular de lado.
   */
  const [lado, setLado] = useState<{ direita: boolean; acima: boolean }>({
    direita: false, acima: false,
  })

  useLayoutEffect(() => {
    if (!open) return
    const campo = btnRef.current?.getBoundingClientRect()
    const cal   = calRef.current
    if (!campo || !cal) return

    const MARGEM = 8   // respiro para a borda da janela
    const larg = cal.offsetWidth
    const alt  = cal.offsetHeight

    // Só vira para a direita se, virando, ele passa a caber. Numa janela
    // estreita demais os dois lados vazam — aí é melhor manter o de sempre.
    const vazaNaDireita = campo.left + larg + MARGEM > window.innerWidth
    const cabeVirado    = campo.right - larg >= MARGEM

    // Mesma regra dos outros menus: sobe só quando embaixo não cabe e em cima
    // cabe. Subir por pouco desorienta — o calendário aparece onde o olho não
    // está.
    const vazaEmbaixo = campo.bottom + alt + MARGEM > window.innerHeight
    const cabeAcima   = campo.top - alt - MARGEM >= 0

    const novo = {
      direita: vazaNaDireita && cabeVirado,
      acima:   vazaEmbaixo && cabeAcima,
    }
    setLado(atual =>
      atual.direita === novo.direita && atual.acima === novo.acima ? atual : novo)
  }, [open])

  // Cursor mês/ano do calendário — inicia no mês do value ou hoje
  const parsed   = value ? new Date(value + 'T00:00:00') : new Date()
  const [curYear, setCurYear]   = useState(parsed.getFullYear())
  const [curMonth, setCurMonth] = useState(parsed.getMonth())   // 0-based

  function toggle() {
    if (open) { setOpen(false); return }
    // sincroniza cursor ao abrir
    const p = value ? new Date(value + 'T00:00:00') : new Date()
    setCurYear(p.getFullYear())
    setCurMonth(p.getMonth())
    setOpen(true)
  }

  function close() { setOpen(false) }

  function prevMonth() {
    if (curMonth === 0) { setCurYear(y => y - 1); setCurMonth(11) }
    else setCurMonth(m => m - 1)
  }

  function nextMonth() {
    if (curMonth === 11) { setCurYear(y => y + 1); setCurMonth(0) }
    else setCurMonth(m => m + 1)
  }

  function selectDay(day: number) {
    const mm = String(curMonth + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    onChange(`${curYear}-${mm}-${dd}`)
    close()
  }

  // Gerar dias do calendário
  const firstDow   = new Date(curYear, curMonth, 1).getDay()  // 0=dom
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate()

  const selectedDate = value ? new Date(value + 'T00:00:00') : null
  const today = new Date(); today.setHours(0,0,0,0)

  function isSelected(day: number) {
    return selectedDate?.getFullYear() === curYear &&
           selectedDate?.getMonth() === curMonth &&
           selectedDate?.getDate() === day
  }

  function isToday(day: number) {
    return today.getFullYear() === curYear &&
           today.getMonth() === curMonth &&
           today.getDate() === day
  }

  // Formatar label do botão
  function fmtLabel() {
    if (!value) return 'Selecione...'
    const [y, m, d] = value.split('-')
    return `${d}/${m}/${y}`
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        ref={btnRef}
        className={`${styles.trigger} ${className ?? ''}`}
        onClick={toggle}
        onBlur={() => setTimeout(close, 150)}
      >
        <Calendar size={13} className={styles.icon} />
        <span>{fmtLabel()}</span>
      </button>

      {open && (
        <div
          ref={calRef}
          className={[
            styles.calendar,
            lado.direita ? styles.aDireita : '',
            lado.acima   ? styles.acima    : '',
          ].join(' ')}
          onMouseDown={e => e.preventDefault()}
        >
          {/* Nav mês */}
          <div className={styles.nav}>
            <button type="button" className={styles.navBtn} onClick={prevMonth}>
              <ChevronLeft size={14} />
            </button>
            <span className={styles.navLabel}>
              {MONTHS[curMonth]} {curYear}
            </span>
            <button type="button" className={styles.navBtn} onClick={nextMonth}>
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Dias da semana */}
          <div className={styles.weekdays}>
            {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
          </div>

          {/* Grid de dias */}
          <div className={styles.days}>
            {Array.from({ length: firstDow }).map((_, i) => <span key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
              <button
                key={day}
                type="button"
                className={[
                  styles.day,
                  isSelected(day) ? styles.daySelected : '',
                  isToday(day) && !isSelected(day) ? styles.dayToday : '',
                ].join(' ')}
                onClick={() => selectDay(day)}
              >
                {day}
              </button>
            ))}
          </div>

          {/* Rodapé */}
          <div className={styles.footer}>
            <button type="button" className={styles.footerBtn} onClick={() => { onChange(''); close() }}>
              Limpar
            </button>
            <button type="button" className={styles.footerBtn} onClick={() => {
              const t = new Date()
              const mm = String(t.getMonth() + 1).padStart(2, '0')
              const dd = String(t.getDate()).padStart(2, '0')
              onChange(`${t.getFullYear()}-${mm}-${dd}`)
              close()
            }}>
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
