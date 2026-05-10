'use client'

import { useState, useRef } from 'react'
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
  const [open, setOpen]   = useState(false)
  const [pos, setPos]     = useState<{ top: number; left: number } | null>(null)

  // Cursor mês/ano do calendário — inicia no mês do value ou hoje
  const parsed   = value ? new Date(value + 'T00:00:00') : new Date()
  const [curYear, setCurYear]   = useState(parsed.getFullYear())
  const [curMonth, setCurMonth] = useState(parsed.getMonth())   // 0-based

  function toggle() {
    if (open) { setOpen(false); setPos(null); return }
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left })
    // sincroniza cursor ao abrir
    const p = value ? new Date(value + 'T00:00:00') : new Date()
    setCurYear(p.getFullYear())
    setCurMonth(p.getMonth())
    setOpen(true)
  }

  function close() { setOpen(false); setPos(null) }

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

      {open && pos && (
        <div
          className={styles.calendar}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
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
