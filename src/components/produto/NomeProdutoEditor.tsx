'use client'

import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import Button from '@/components/ui/Button'
import { corrigirNomeProduto } from '@/app/(sistema)/produtos/nomeActions'
import styles from './NomeProdutoEditor.module.css'

export default function NomeProdutoEditor({ productId, storeId, nome, romaneio, onSaved, onEditing }: {
  productId: string; storeId: string; nome: string
  romaneio?: { transferId: string; itemId: string }
  onSaved: (nome: string) => void | Promise<void>
  onEditing: (editing: boolean) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [draft, setDraft] = useState(nome)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  useEffect(() => { setDraft(nome) }, [nome])

  if (!aberto) return <Button size="sm" variant="outline" data-name-edit-button onClick={() => {
    setDraft(nome); setErro(''); setAberto(true); onEditing(true)
  }}><Pencil size={14} />Editar nome do produto</Button>

  return <form className={styles.editor} data-novidade="editar-nome" onSubmit={async e => {
    e.preventDefault(); setErro(''); setSalvando(true)
    try {
      const res = await corrigirNomeProduto(productId, storeId, draft, nome, romaneio)
      if (!res.success || !res.name) { setErro(res.error ?? 'Não foi possível salvar o nome.'); return }
      await onSaved(res.name)
      setAberto(false); onEditing(false)
    } catch { setErro('Não foi possível confirmar o resultado. Reabra a peça antes de tentar novamente.') }
    finally { setSalvando(false) }
  }}>
    <label>Nome do produto
      <input value={draft} disabled={salvando} onChange={e => setDraft(e.target.value)} autoFocus />
    </label>
    <p>Este nome será usado na nova etiqueta. A categoria e o histórico serão mantidos.</p>
    {erro && <p role="alert">{erro}</p>}
    <div className={styles.acoes}>
      <Button size="sm" type="submit" disabled={salvando || !draft.trim() || draft.trim() === nome}>
        {salvando ? 'Salvando…' : 'Salvar nome'}
      </Button>
      <Button size="sm" variant="ghost" disabled={salvando} onClick={() => { setAberto(false); onEditing(false) }}>Cancelar</Button>
    </div>
  </form>
}
