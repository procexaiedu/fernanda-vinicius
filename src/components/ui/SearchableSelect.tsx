'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { matchText } from '@/lib/normalize'
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
  /**
   * Oferece a opção vazia (o próprio placeholder) para limpar a escolha.
   *
   * Ligado faz sentido em FILTRO — "todas as lojas" é resposta legítima. Em
   * CAMPO OBRIGATÓRIO não: o motivo de uma baixa de estoque não pode ficar em
   * branco, e a linha vazia ali só oferece um estado inválido.
   */
  permitirLimpar?: boolean
  disabled?: boolean
  id?: string
}

/**
 * O select do sistema.
 *
 * Existe porque `<select>` nativo não é estilizável: o menu é desenhado pelo
 * SISTEMA OPERACIONAL, fora da janela do navegador. Isso tem duas
 * consequências que apareceram na prática:
 *
 *  - no tema escuro ele abre branco, como qualquer varredura de tela mostra;
 *  - ele **não é capturado no compartilhamento de tela**. No treinamento de
 *    02/09 a dona precisou escolher o motivo da baixa às cegas, guiada por voz,
 *    porque a lista não aparecia para quem assistia.
 *
 * Ao trocar o nativo por HTML, o que vem de graça no nativo passa a ser
 * responsabilidade nossa — por isso teclado e ARIA estão implementados aqui, e
 * não são enfeite: sem eles a troca melhora a demonstração e piora o uso.
 *
 * O menu vai para um portal com posição fixa. Dentro de modal — que é onde ele
 * mais aparece — um menu `absolute` é cortado pelo `overflow-y: auto` do
 * corpo do modal.
 */
export default function SearchableSelect({
  value, onChange, options, placeholder,
  searchable = true, className, permitirLimpar = true, disabled = false, id,
}: Props) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [ativo, setAtivo] = useState(-1)
  const [pos, setPos]     = useState<{ top: number; left: number; width: number; acima: boolean } | null>(null)

  const wrapRef  = useRef<HTMLDivElement>(null)
  const btnRef   = useRef<HTMLButtonElement>(null)
  const menuRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listaId  = useId()

  const selected = options.find(o => o.value === value)
  const filtered = searchable && query
    ? options.filter(o => matchText(o.label, query))
    : options

  /** As opções navegáveis, na ordem em que aparecem. */
  const navegaveis: SelectOption[] = permitirLimpar
    ? [{ value: '', label: placeholder }, ...filtered]
    : filtered

  /*
   * Mede a partir do gatilho e decide se abre para cima.
   *
   * Sem isso, um select no rodapé de um modal abre para fora da tela — e como
   * o menu é `fixed`, não há rolagem que o alcance.
   */
  const posicionar = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const alturaMenu = Math.min(280, navegaveis.length * 34 + (searchable ? 44 : 0) + 12)
    const abaixo = window.innerHeight - r.bottom
    const acima  = abaixo < alturaMenu && r.top > abaixo
    setPos({
      top:   acima ? r.top - 4 - alturaMenu : r.bottom + 4,
      left:  r.left,
      width: r.width,
      acima,
    })
  }, [navegaveis.length, searchable])

  function abrir() {
    if (disabled) return
    posicionar()
    setAtivo(Math.max(0, navegaveis.findIndex(o => o.value === value)))
    setOpen(true)
  }

  const fechar = useCallback(() => { setOpen(false); setPos(null); setQuery(''); setAtivo(-1) }, [])

  useEffect(() => {
    if (open && searchable) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open, searchable])

  // Fecha ao clicar fora — contando o menu, que vive no portal e não é filho.
  useEffect(() => {
    if (!open) return
    function foraDaqui(e: MouseEvent) {
      const alvo = e.target as Node
      if (wrapRef.current?.contains(alvo) || menuRef.current?.contains(alvo)) return
      fechar()
    }
    document.addEventListener('mousedown', foraDaqui)
    return () => document.removeEventListener('mousedown', foraDaqui)
  }, [open, fechar])

  /*
   * Menu `fixed` não acompanha rolagem: ou reposiciona, ou fecha. Fecha — é o
   * que o nativo faz, e reposicionar durante a rolagem de um modal fica trêmulo.
   */
  useEffect(() => {
    if (!open) return
    const aoMexer = () => fechar()
    window.addEventListener('scroll', aoMexer, true)
    window.addEventListener('resize', aoMexer)
    return () => {
      window.removeEventListener('scroll', aoMexer, true)
      window.removeEventListener('resize', aoMexer)
    }
  }, [open, fechar])

  function escolher(v: string) {
    onChange(v)
    fechar()
    btnRef.current?.focus()
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); abrir() }
      return
    }
    switch (e.key) {
      case 'Escape':    e.preventDefault(); fechar(); btnRef.current?.focus(); break
      case 'ArrowDown': e.preventDefault(); setAtivo(i => Math.min(navegaveis.length - 1, i + 1)); break
      case 'ArrowUp':   e.preventDefault(); setAtivo(i => Math.max(0, i - 1)); break
      case 'Home':      e.preventDefault(); setAtivo(0); break
      case 'End':       e.preventDefault(); setAtivo(navegaveis.length - 1); break
      case 'Enter':
      case 'Tab':
        if (navegaveis[ativo]) { e.preventDefault(); escolher(navegaveis[ativo].value) }
        break
    }
  }

  // Mantém a opção destacada visível ao navegar pelo teclado.
  useEffect(() => {
    if (!open || ativo < 0) return
    menuRef.current?.querySelector(`[data-i="${ativo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [ativo, open])

  const menu = open && pos && (
    <div
      ref={menuRef}
      id={listaId}
      role="listbox"
      className={styles.dropdown}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1200 }}
    >
      {searchable && (
        <div className={styles.searchWrapper}>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Buscar..."
            value={query}
            onChange={e => { setQuery(e.target.value); setAtivo(0) }}
            onKeyDown={aoTeclar}
          />
        </div>
      )}
      <div className={styles.list}>
        {navegaveis.map((o, i) => (
          <div
            key={o.value || '__vazio'}
            data-i={i}
            role="option"
            aria-selected={value === o.value}
            className={[
              styles.option,
              value === o.value ? styles.optionActive : '',
              i === ativo ? styles.optionFocada : '',
            ].filter(Boolean).join(' ')}
            onMouseEnter={() => setAtivo(i)}
            onMouseDown={e => { e.preventDefault(); escolher(o.value) }}
          >
            {o.label}
          </div>
        ))}
        {navegaveis.length === 0 && (
          <div className={styles.empty}>Nenhuma opção encontrada</div>
        )}
      </div>
    </div>
  )

  return (
    <div ref={wrapRef} className={`${styles.wrapper} ${className ?? ''}`}>
      <button
        type="button"
        id={id}
        ref={btnRef}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listaId : undefined}
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => (open ? fechar() : abrir())}
        onKeyDown={aoTeclar}
      >
        <span className={selected ? styles.selectedLabel : styles.placeholder}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={13} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>

      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
