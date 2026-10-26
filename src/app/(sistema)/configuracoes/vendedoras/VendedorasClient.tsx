'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { salvarVendedora } from './actions'
import styles from './page.module.css'

export interface Pessoa { id: string; full_name: string; store_id: string; is_active: boolean }
export default function VendedorasClient({ pessoas, lojas }: { pessoas: Pessoa[]; lojas: { id: string; name: string }[] }) {
  const router = useRouter()
  const [editando, setEditando] = useState<Pessoa | null>(null)
  const [nome, setNome] = useState('')
  const [loja, setLoja] = useState(lojas[0]?.id ?? '')
  const [ativa, setAtiva] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const [pending, startTransition] = useTransition()
  const [pronto, setPronto] = useState(false)
  useEffect(() => { setPronto(true) }, [])
  function limpar() { setEditando(null); setNome(''); setAtiva(true); setLoja(lojas[0]?.id ?? '') }
  return <section className={styles.area} data-novidade="cadastro-vendedoras">
    <form className={styles.form} onSubmit={e => { e.preventDefault(); setErro(''); setMensagem(''); startTransition(async () => {
      try {
        const r = await salvarVendedora({ id: editando?.id, full_name: nome, store_id: loja, is_active: ativa })
        if (!r.success) { setErro(r.error ?? 'Não foi possível salvar.'); return }
        setMensagem('Vendedora salva.'); limpar(); router.refresh()
      } catch { setErro('Não foi possível salvar. Tente novamente.') }
    }) }}>
      <h2>{editando ? 'Editar vendedora' : 'Nova vendedora'}</h2>
      <label>Nome<input name="full_name" required maxLength={120} value={nome} onChange={e => setNome(e.target.value)} autoComplete="off" /></label>
      <label>Loja<select name="store_id" required value={loja} disabled={!!editando || lojas.length === 1} onChange={e => setLoja(e.target.value)}>{lojas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className={styles.check}><input type="checkbox" checked={ativa} onChange={e => setAtiva(e.target.checked)} />Ativa para novas vendas</label>
      <p>Inativar mantém o histórico. Nomes repetidos na mesma loja não são permitidos.</p>
      <div className={styles.botoes}><button className="btn btn-primary" disabled={!pronto || pending || !loja}>{pending ? 'Salvando…' : 'Salvar vendedora'}</button>{editando && <button className="btn btn-secondary" type="button" disabled={pending} onClick={limpar}>Cancelar edição</button>}</div>
      {erro && <p role="alert">{erro}</p>}{mensagem && <p role="status">{mensagem}</p>}
    </form>
    <div className={styles.lista}><h2>Vendedoras cadastradas</h2>{!pessoas.length && <p>Nenhuma vendedora cadastrada nesta loja. Cadastre uma pessoa para selecioná-la no PDV.</p>}
      {pessoas.map(p => <article className={styles.pessoa} key={p.id}><div><strong>{p.full_name}</strong><p>{lojas.find(l => l.id === p.store_id)?.name ?? 'Loja'} · {p.is_active ? 'Ativa' : 'Inativa'}</p></div><button type="button" className="btn btn-secondary" disabled={pending} onClick={() => { setEditando(p); setNome(p.full_name); setLoja(p.store_id); setAtiva(p.is_active); setErro(''); setMensagem('') }}>Editar<span className={styles.sr}> {p.full_name}</span></button></article>)}
    </div>
  </section>
}
