'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, Check, X, Pencil } from 'lucide-react'
import {
  upsertCategoryMapping,
  renameCategoryMapping,
  deleteCategoryMapping,
  type CategoryMapping,
  type LabelFormat,
} from './actions'
import styles from './CategoryMappingPanel.module.css'

interface Props {
  initialMappings: CategoryMapping[]
}

interface EditState {
  originalCategory: string | null
  category: string
  format: LabelFormat
}

export default function CategoryMappingPanel({ initialMappings }: Props) {
  const [mappings, setMappings] = useState<CategoryMapping[]>(initialMappings)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const isAdding = editState?.originalCategory === null

  function startAdd() {
    setEditState({ originalCategory: null, category: '', format: 'B' })
    setErrorMsg(null)
  }

  function startEdit(m: CategoryMapping) {
    setEditState({ originalCategory: m.category, category: m.category, format: m.label_format })
    setErrorMsg(null)
  }

  function cancelEdit() {
    setEditState(null)
  }

  function save() {
    if (!editState) return
    const cat = editState.category.trim()
    if (!cat) return
    setErrorMsg(null)

    startTransition(async () => {
      let result
      if (editState.originalCategory === null) {
        result = await upsertCategoryMapping(cat, editState.format)
      } else if (editState.originalCategory !== cat) {
        result = await renameCategoryMapping(editState.originalCategory, cat, editState.format)
      } else {
        result = await upsertCategoryMapping(cat, editState.format)
      }

      if (!result.success) {
        setErrorMsg(result.error ?? 'Erro ao salvar.')
        return
      }

      if (editState.originalCategory === null) {
        setMappings(prev =>
          [...prev, { category: cat, label_format: editState.format }]
            .sort((a, b) => a.category.localeCompare(b.category, 'pt-BR'))
        )
      } else {
        setMappings(prev =>
          prev.map(m =>
            m.category === editState.originalCategory
              ? { category: cat, label_format: editState.format }
              : m
          )
        )
      }
      setEditState(null)
    })
  }

  function handleDelete(category: string) {
    setErrorMsg(null)
    startTransition(async () => {
      const result = await deleteCategoryMapping(category)
      if (!result.success) {
        setErrorMsg(result.error ?? 'Erro ao excluir.')
        return
      }
      setMappings(prev => prev.filter(m => m.category !== category))
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>Categorias de etiqueta</h2>
        <p>Formato padrão (A ou B) aplicado ao imprimir por categoria.</p>
      </div>

      {errorMsg && <p className={styles.error}>{errorMsg}</p>}

      {mappings.length === 0 && !isAdding && (
        <p className={styles.empty}>Nenhuma categoria configurada ainda.</p>
      )}

      <div className={styles.grid}>
        {mappings.map(m => {
          const isEditing = editState?.originalCategory === m.category
          return (
            <div
              key={m.category}
              className={`${styles.gridItem} ${isEditing ? styles.gridItemEditing : ''}`}
              style={isEditing ? { gridColumn: 'span 2' } : undefined}
            >
              {isEditing && editState ? (
                <div className={styles.editRow}>
                  <input
                    className={styles.editInput}
                    value={editState.category}
                    onChange={e => setEditState(s => s ? { ...s, category: e.target.value } : s)}
                    placeholder="Nome da categoria"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') save()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                  />
                  <button
                    type="button"
                    className={`${styles.formatBtn} ${editState.format === 'A' ? styles.formatA : styles.formatB}`}
                    onClick={() => setEditState(s => s ? { ...s, format: s.format === 'A' ? 'B' : 'A' } : s)}
                    title="Clique para alternar A/B"
                  >
                    {editState.format}
                  </button>
                  <button className={`${styles.actionBtn} ${styles.actionBtnSave}`} onClick={save} title="Salvar">
                    <Check size={13} />
                  </button>
                  <button className={styles.actionBtn} onClick={cancelEdit} title="Cancelar">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <>
                  <span className={styles.categoryName}>{m.category}</span>
                  <span className={`${styles.formatBadge} ${m.label_format === 'A' ? styles.formatA : styles.formatB}`}>
                    {m.label_format}
                  </span>
                  <div className={styles.itemActions}>
                    <button className={styles.actionBtn} onClick={() => startEdit(m)} title="Editar">
                      <Pencil size={12} />
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => handleDelete(m.category)}
                      title="Excluir"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {isAdding && editState && (
        <div className={styles.addRow}>
          <input
            className={styles.editInput}
            value={editState.category}
            onChange={e => setEditState(s => s ? { ...s, category: e.target.value } : s)}
            placeholder="Nome da nova categoria"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') cancelEdit()
            }}
          />
          <button
            type="button"
            className={`${styles.formatBtn} ${editState.format === 'A' ? styles.formatA : styles.formatB}`}
            onClick={() => setEditState(s => s ? { ...s, format: s.format === 'A' ? 'B' : 'A' } : s)}
            title="Clique para alternar A/B"
          >
            {editState.format}
          </button>
          <button className={`${styles.actionBtn} ${styles.actionBtnSave}`} onClick={save} title="Salvar">
            <Check size={13} />
          </button>
          <button className={styles.actionBtn} onClick={cancelEdit} title="Cancelar">
            <X size={13} />
          </button>
        </div>
      )}

      {!isAdding && (
        <button className={styles.addBtn} onClick={startAdd}>
          <Plus size={13} /> Adicionar categoria
        </button>
      )}
    </div>
  )
}
