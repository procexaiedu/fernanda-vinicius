'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { mensagemDeErroAoSalvar } from '@/lib/erroDeSalvar'
import { cadastrarPecaForaDoSistema } from './actions'
import type { StoreOption, SupplierOption } from './page'
import styles from './ProdutoFormModal.module.css'

type Modo = 'reintegrar' | 'sem_etiqueta'

/* Texto, não type="number": aceita vírgula sem apagar o que já foi digitado. */
function lerValor(texto: string): number {
  /* "1.234,50" tem ponto de milhar; "23.80" tem ponto decimal. */
  const t = texto.trim()
  return parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0
}

const anoAtual = new Date().getFullYear()

export default function PecaForaDoSistemaModal({ modo, stores, suppliers, onClose }: {
  modo: Modo
  stores: StoreOption[]
  suppliers: SupplierOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const reintegrar = modo === 'reintegrar'

  const [etiqueta, setEtiqueta] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [custo, setCusto] = useState('')
  const [venda, setVenda] = useState('')
  const [quantidade, setQuantidade] = useState('1')
  const [loja, setLoja] = useState(stores.length === 1 ? stores[0].id : '')
  const [fornecedor, setFornecedor] = useState('')
  const [mes, setMes] = useState('')
  const [ano, setAno] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setErro('')
    /* Admin de loja não recebe a lista: o servidor usa a loja dela. */
    if (stores.length > 0 && !loja) { setErro('Escolha a loja.'); return }
    setSalvando(true)
    try {
      const res = await cadastrarPecaForaDoSistema({
        modo,
        store_id: loja,
        name: nome,
        cost_price: lerValor(custo),
        sale_price: lerValor(venda),
        quantity: Number(quantidade),
        supplier_id: fornecedor || null,
        barcode_number: etiqueta,
        code: codigo,
        purchase_month: Number(mes),
        purchase_year: Number(ano),
      })
      if (!res.success) { setErro(res.error ?? 'Erro ao cadastrar.'); return }
      router.refresh()
      onClose()
    } catch (e) {
      setErro(mensagemDeErroAoSalvar(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={reintegrar ? 'Reintegrar peça' : 'Cadastrar sem etiqueta'} size="lg">
      <div className={styles.form}>
        {/* Sem o traço da seção: o rodapé já separa, e os dois juntos ficavam duplicados. */}
        <div className={styles.section} style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>
          <div className={styles.sectionTitle}>
            {reintegrar ? 'Dados da etiqueta' : 'Dados da peça'}
          </div>
          <p style={{ margin: '-6px 0 16px', fontSize: 13, textTransform: 'none', lineHeight: 1.45, color: 'var(--text-secondary, var(--text-muted))' }}>
            {reintegrar
              ? 'Copie exatamente o que está impresso na etiqueta. Nenhum número novo é gerado.'
              : 'O sistema gera o número sozinho. Para imprimir a etiqueta, selecione a peça na lista.'}
          </p>

          {reintegrar && (
            <>
              <div className={styles.grid2} style={{ marginBottom: 12 }}>
                <div className={styles.field}>
                  <label className={styles.label}>Número da etiqueta <span className={styles.required}>*</span></label>
                  <input className={styles.input} value={etiqueta} inputMode="numeric" onChange={e => setEtiqueta(e.target.value)} placeholder="Ex: 10523" />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Código <span className={styles.required}>*</span></label>
                  <input className={styles.input} value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="Ex: FLK01238" />
                </div>
              </div>
              <div className={styles.grid3} style={{ marginBottom: 12 }}>
                <div className={styles.field}>
                  <label className={styles.label}>Mês da compra <span className={styles.required}>*</span></label>
                  <SearchableSelect
                    value={mes}
                    onChange={setMes}
                    options={Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({ value: String(m), label: String(m).padStart(2, '0') }))}
                    placeholder="Mês"
                    searchable={false}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Ano <span className={styles.required}>*</span></label>
                  <SearchableSelect
                    value={ano}
                    onChange={setAno}
                    options={Array.from({ length: 5 }, (_, i) => anoAtual - i).map(y => ({ value: String(y), label: String(y) }))}
                    placeholder="Ano"
                    searchable={false}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Fornecedor</label>
                  <SearchableSelect
                    value={fornecedor}
                    onChange={setFornecedor}
                    options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                    placeholder="Opcional"
                    className={styles.fullWidth}
                  />
                </div>
              </div>
            </>
          )}

          <div className={styles.field} style={{ marginBottom: 12 }}>
            <label className={styles.label}>Nome <span className={styles.required}>*</span></label>
            <input className={styles.input} value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Pulseira pedra" />
          </div>

          <div className={styles.grid3} style={{ marginBottom: 12 }}>
            <div className={styles.field}>
              <label className={styles.label}>Custo (R$) <span className={styles.required}>*</span></label>
              <input className={styles.input} value={custo} inputMode="decimal" onChange={e => setCusto(e.target.value)} placeholder="0,00" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Venda (R$) <span className={styles.required}>*</span></label>
              <input className={styles.input} value={venda} inputMode="decimal" onChange={e => setVenda(e.target.value)} placeholder="0,00" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Quantidade <span className={styles.required}>*</span></label>
              <input className={styles.input} value={quantidade} inputMode="numeric" onChange={e => setQuantidade(e.target.value)} />
            </div>
          </div>

          {stores.length > 0 && (
            <div className={styles.field}>
              <label className={styles.label}>Loja <span className={styles.required}>*</span></label>
              <SearchableSelect
                value={loja}
                onChange={setLoja}
                options={stores.map(s => ({ value: s.id, label: s.name }))}
                placeholder="Selecione..."
                searchable={false}
                className={styles.fullWidth}
              />
            </div>
          )}
        </div>

        {erro && <div className={styles.error} role="alert">{erro}</div>}

        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button loading={salvando} onClick={salvar}>{reintegrar ? 'Reintegrar peça' : 'Cadastrar peça'}</Button>
        </div>
      </div>
    </Modal>
  )
}
