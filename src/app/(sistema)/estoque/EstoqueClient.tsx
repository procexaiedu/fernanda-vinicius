'use client'

import { useTransition } from 'react'
import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart2, ChevronLeft, ChevronRight, Gem, ArrowLeftRight, ScanLine, Loader2, ClipboardCheck } from 'lucide-react'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import ProdutoDetalheModal from '@/components/produto/ProdutoDetalheModal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import type { ProductWithRelations, StoreOption } from '../produtos/page'
import Paginacao from '@/components/ui/Paginacao'
import ThOrdenavel from '@/components/ui/ThOrdenavel'
import { useOrdenacao } from '@/hooks/useOrdenacao'
import { usePaginacaoServidor } from '@/hooks/usePaginacaoServidor'
import styles from './EstoqueClient.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'

function getStatusVenda(lastSaleDate: string | null, createdAt: string): 'parado' | 'critico' | null {
  const now = Date.now()
  const ref = lastSaleDate ? new Date(lastSaleDate).getTime() : new Date(createdAt).getTime()
  const dias = Math.floor((now - ref) / 86400000)
  if (!lastSaleDate && dias < 30) return null
  if (dias >= 90) return 'critico'
  if (dias >= 60) return 'parado'
  return null
}

/* Dinheiro: um formatador so para o sistema - ver src/lib/dinheiro.ts */
const fmt = formatarDinheiro
function fmtDate(s: string | null) {
  if (!s) return '—'
  const [date] = s.split('T')
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

interface Filters {
  q: string
  store_id: string
  category: string
  material: string
  qty_zero: string
}

interface Props {
  products: ProductWithRelations[]
  total: number
  page: number
  perPage: number
  isAdmin: boolean
  stores: StoreOption[]
  categories: string[]
  materials: string[]
  filters: Filters
}

export default function EstoqueClient({
  products, total, page, perPage, isAdmin, stores, categories, materials, filters,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pendente, startTransition] = useTransition()
  const [detalhe, setDetalhe] = useState<ProductWithRelations | null>(null)

  /*
   * Consulta de balcão: bipar aqui abre a ficha da peça em vez de mandar para a
   * venda. Quem decide é o modo com que o modal abre — clique na linha continua
   * sendo consulta interna (custo, margem, fornecedor); bipe abre virado para a
   * cliente.
   *
   * A captura é local e não a global de `layout-client.tsx`, porque aquela morre
   * assim que existe um `[role="dialog"]` na tela. Como o modal É um dialog,
   * bipar a segunda peça não funcionaria: aqui a troca de conteúdo é o caso de
   * uso principal, não a exceção.
   */
  const [modoBalcao, setModoBalcao] = useState(false)
  const [bipando, setBipando] = useState(false)
  const [bipErro, setBipErro] = useState<string | null>(null)

  const aoBipar = useCallback(async (codigo: string) => {
    setBipErro(null)
    setBipando(true)
    const supabase = createBrowserClient()
    // Sem filtro de loja: o RLS já limita a operadora à loja dela.
    const { data, error } = await supabase
      .from('products')
      .select('*, suppliers(id, name, initials), stores(id, name)')
      .eq('barcode_number', codigo)
      .maybeSingle()
    setBipando(false)

    if (error || !data) {
      setBipErro(`Nenhuma peça com o código ${codigo}.`)
      return
    }
    setModoBalcao(true)
    setDetalhe(data as ProductWithRelations)
  }, [])

  useBarcodeScanner({ onScan: aoBipar })

  function fecharDetalhe() {
    setDetalhe(null)
    setModoBalcao(false)
  }

  /*
   * Ordena o lote que está na tela. Como a paginação é encadeada sobre lotes de 50
   * do servidor, a ordenação vale o lote atual — é o que dá resposta instantânea ao
   * clique. Para ordenar as 970 peças inteiras seria preciso mandar o `order` para
   * o Supabase, e aí cada clique custaria uma ida de ~500ms.
   */
  const ord = useOrdenacao(products, {
    produto:     { valor: p => p.name, tipo: 'texto' },
    codigo:      { valor: p => p.code, tipo: 'texto' },
    fornecedor:  { valor: p => p.suppliers?.name, tipo: 'texto' },
    loja:        { valor: p => p.stores?.name, tipo: 'texto' },
    qtd:         { valor: p => p.quantity_in_stock, tipo: 'numero' },
    venda:       { valor: p => p.sale_price, tipo: 'numero' },
    promo:       { valor: p => p.promotional_price, tipo: 'numero' },
    ultimaVenda: { valor: p => p.last_sale_date, tipo: 'data' },
  })

  const pag = usePaginacaoServidor({
    itens: ord.ordenados,
    paginaServidor: page,
    porLoteServidor: perPage,
    totalItens: total,
    irParaPaginaServidor: pushPage,
    carregando: pendente,
  })

  function pushFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value) p.set(key, value)
    else p.delete(key)
    p.delete('page')
    startTransition(() => router.push(`?${p.toString()}`))
  }

  function pushPage(n: number) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('page', String(n))
    startTransition(() => router.push(`?${p.toString()}`))
  }


  return (
    <>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <input
            className={styles.search}
            placeholder="Buscar nome, código ou barras…"
            defaultValue={filters.q}
            onChange={e => pushFilter('q', e.target.value)}
          />
          {isAdmin && (
            <SearchableSelect
              value={filters.store_id}
              onChange={v => pushFilter('store_id', v)}
              options={stores.map(s => ({ value: s.id, label: s.name }))}
              placeholder="Loja"
              searchable={stores.length > 5}
            />
          )}
          <SearchableSelect
            value={filters.category}
            onChange={v => pushFilter('category', v)}
            options={categories.map(c => ({ value: c, label: c }))}
            placeholder="Categoria"
          />
          <SearchableSelect
            value={filters.material}
            onChange={v => pushFilter('material', v)}
            options={materials.map(m => ({ value: m, label: m }))}
            placeholder="Material"
          />
          {isAdmin && (
            <label className="filtro-toggle">
              <input
                type="checkbox"
                checked={filters.qty_zero === 'true'}
                onChange={e => pushFilter('qty_zero', e.target.checked ? 'true' : '')}
              />
              Mostrar sem estoque
            </label>
          )}
          <span className={styles.counter}>{total} produto{total !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.toolbarRight}>
          <Button size="sm" variant="ghost" onClick={() => router.push('/estoque/conferencia')}>
            <ClipboardCheck size={14} />
            Conferência
          </Button>
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => router.push('/estoque/transferencias')}>
              <ArrowLeftRight size={14} />
              Transferências
            </Button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className={styles.tableWrapper}>
        {products.length === 0 ? (
          <div className={styles.empty}>
            <span>Nenhum produto no estoque.</span>
            <span className={styles.emptyHint}>Tente ajustar os filtros.</span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <ThOrdenavel ord={ord} coluna="produto">Produto</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="codigo">Código</ThOrdenavel>
                {isAdmin && <ThOrdenavel ord={ord} coluna="fornecedor" className="col-secondary col-truncate">Fornecedor</ThOrdenavel>}
                {isAdmin && <ThOrdenavel ord={ord} coluna="loja" className="col-tertiary col-truncate">Loja</ThOrdenavel>}
                <ThOrdenavel ord={ord} coluna="qtd" className="col-num">Qtd.</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="venda" className="col-num">Venda</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="promo" className="col-tertiary col-num">Promo</ThOrdenavel>
                <ThOrdenavel ord={ord} coluna="ultimaVenda" className="col-tertiary col-date">Última venda</ThOrdenavel>
                <th className="col-center">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pag.fatia.map(prod => {
                const statusVenda = getStatusVenda(prod.last_sale_date, prod.created_at)
                return (
                  <tr
                    key={prod.id}
                    className={styles.row}
                    onClick={() => setDetalhe(prod)}
                    title="Clique para ver detalhes"
                  >
                    <td>
                      <div className={styles.productCell}>
                        {prod.photo_url
                          ? <img src={prod.photo_url} alt={prod.name} className={styles.photo} />
                          : <div className={styles.photoPlaceholder}><Gem size={14} /></div>
                        }
                        <div className={styles.productInfo}>
                          <span className={styles.productName}>{prod.name}</span>
                          <span className={styles.productCategory}>{prod.category}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className={styles.code}>{prod.code}</span>
                    </td>

                    {isAdmin && (
                      <td className={`${styles.mutedCell} col-secondary col-truncate`} title={prod.suppliers?.name ?? undefined}>
                        {prod.suppliers?.name ?? '—'}
                      </td>
                    )}
                    {isAdmin && (
                      <td className={`${styles.mutedCell} col-tertiary col-truncate`} title={prod.stores?.name ?? undefined}>
                        {prod.stores?.name ?? '—'}
                      </td>
                    )}

                    <td className="col-num">
                      <span className={`${styles.qty} ${prod.quantity_in_stock <= 1 ? styles.qtyLow : ''}`}>
                        {prod.quantity_in_stock}
                      </span>
                    </td>

                    <td className="col-num"><span className={styles.salePrice}>{fmt(prod.sale_price)}</span></td>

                    <td className="col-tertiary col-num">
                      {prod.promotional_price
                        ? <span className={styles.promoPrice}>{fmt(prod.promotional_price)}</span>
                        : <span className={styles.mutedCell}>—</span>}
                    </td>

                    {/* `col-date` também aqui: o <th> já a tinha, o <td> não — título e
                        coluna acabavam em alinhamentos diferentes. */}
                    <td className={`${styles.mutedCell} col-tertiary col-date`}>{fmtDate(prod.last_sale_date)}</td>

                    <td className="col-center">
                      {statusVenda === 'parado' && <span className={styles.statusParado}>Parado</span>}
                      {statusVenda === 'critico' && <span className={styles.statusCritico}>Crítico</span>}
                      {!statusVenda && <span className={styles.mutedCell}>—</span>}
                    </td>

                    <td onClick={e => e.stopPropagation()}>
                      <button className={styles.iconBtn} title="Ver detalhes" onClick={() => setDetalhe(prod)}>
                        <BarChart2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginação */}
      <Paginacao
        pagina={pag.pagina}
        totalPaginas={pag.totalPaginas}
        totalItens={pag.totalItens}
        rotulo="peça"
        onIr={pag.irPara}
        carregando={pag.carregando}
      />

      {(bipando || bipErro) && (
        <div className={styles.bipToast} role="status" aria-live="polite">
          {bipando
            ? <><Loader2 size={15} className={styles.bipSpin} /><span>Buscando peça…</span></>
            : <><ScanLine size={15} /><span>{bipErro}</span>
                <button className={styles.bipFechar} onClick={() => setBipErro(null)}>Fechar</button></>}
        </div>
      )}

      {detalhe && (
        <ProdutoDetalheModal
          produto={detalhe}
          isAdmin={isAdmin}
          modoBalcao={modoBalcao}
          onClose={fecharDetalhe}
        />
      )}
    </>
  )
}
