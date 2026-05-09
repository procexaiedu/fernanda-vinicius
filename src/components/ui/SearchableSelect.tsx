'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import styles from './SearchableSelect.module.css'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder: string
  searchable?: boolean
  className?: string
}

export default function SearchableSelect({ value, onChange, options, placeholder, searchable = true, className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = searchable && query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    if (open && searchable) setTimeout(() => inputRef.current?.focus(), 50)
    if (!open) setQuery('')
  }, [open, searchable])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function select(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={`${styles.wrapper} ${className ?? ''}`}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className={selected ? styles.selectedLabel : styles.placeholder}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={13} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>

      {open && (
        <div className={styles.dropdown}>
          {searchable && (
            <div className={styles.searchWrapper}>
              <input
                ref={inputRef}
                className={styles.searchInput}
                placeholder="Buscar..."
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          )}
          <div className={styles.list}>
            <div
              className={`${styles.option} ${!value ? styles.optionActive : ''}`}
              onMouseDown={() => select('')}
            >
              {placeholder}
            </div>
            {filtered.map(o => (
              <div
                key={o.value}
                className={`${styles.option} ${value === o.value ? styles.optionActive : ''}`}
                onMouseDown={() => select(o.value)}
              >
                {o.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className={styles.empty}>Nenhuma opção encontrada</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
