'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import styles from './Modal.module.css'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xl2'
  /** Oculta o header padrão (título + X). Use quando o conteúdo tiver cabeçalho próprio. */
  hideHeader?: boolean
}

export default function Modal({ isOpen, onClose, title, children, size = 'md', hideHeader = false }: ModalProps) {
  const [mounted, setMounted] = useState(false)
  const didMouseDownOnBackdrop = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!mounted || !isOpen) return null

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(e) => { didMouseDownOnBackdrop.current = e.target === e.currentTarget }}
      onClick={() => { if (didMouseDownOnBackdrop.current) onClose() }}
    >
      <div
        className={`${styles.dialog} ${styles[size]}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {!hideHeader && (
          <div className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
            <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
        )}
        <div className={hideHeader ? styles.bodyFull : styles.body}>{children}</div>
      </div>
    </div>,
    document.body
  )
}
