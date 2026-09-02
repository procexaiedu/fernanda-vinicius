'use client'

import { useTransition, useEffect} from 'react'
import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart2, ChevronLeft, ChevronRight, Gem, ArrowLeftRight, ScanLine, Loader2, ClipboardCheck } from 'lucide-react'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import ProdutoDetalheModal from '@/components/produto/ProdutoDetalheModal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import BotaoExportar from '@/components/ui/BotaoExportar'
import { exportarEstoque } from '../produtos/exportar'
import type { ProductWithRelations, StoreOption } from '../produtos/page'
import Paginacao from '@/components/ui/Paginacao'
import ThOrdenavel from '@/components/ui/ThOrdenavel'
import { useOrdenacao } from '@/hooks/useOrdenacao'
import { usePaginacaoServidor } from '@/hooks/usePaginacaoServidor'
import styles from './EstoqueClient.module.css'
import { formatarDinheiro } from '@/lib/dinheiro'
import { calcularGiro, ROTULO_FAIXA, textoDias } from '@/lib/giro'

/* getStatusVenda saiu daqui: eram duas cópias com 60 e 90 escritos na mão,
 * enquanto a configuração do negócio diz 30. A regra agora é uma só, em
 * src/lib/giro.ts, e o corte vem de `stale_product_days`. */

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
  /** `stale_product_days` das Configurações — define o corte de parado/encalhado. */
  staleDays: number
  filters: Filters
}

export default function EstoqueClient({
  products, total, page, perPage, isAdmin, stores, categories, materials, staleDays, filters,
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

  /*
   * Modo de baixa em série.
   *
   * A mesma tela atende duas coisas que não podem compartilhar o bipe: a
   * CONSULTA DE BALCÃO (cliente pergunta o preço, a vendedora bipa e mostra a
   * ficha sem custo) e a BAIXA EM PILHA, que foi o pedido do treinamento de
   * 02/09 — "faz o BIP abrir a mesma modal".
   *
   * Um interruptor resolve sem tirar nada de ninguém: ligado, o bipe abre
   * direto a baixa; desligado, segue abrindo a ficha de balcão como sempre.
   * Só admin, porque baixa é dele.
   */
  const [modoBaixa, setModoBaixa] = useState(false)
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
    setModoBalcao(!modoBaixa)
    setDetalhe(data as ProductWithRelations)
  }, [modoBaixa])

  useBarcodeScanner({ onScan: aoBipar })

  /* Esc com nada aberto desliga o modo de baixa — a saída rápida de quem
   * terminou a pilha e não quer que o próximo bipe abra uma baixa sem querer. */
  useEffect(() => {
    if (!modoBaixa) return
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape' && !detalhe) setModoBaixa(false)
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [modoBaixa, detalhe])

  function fecharDetalhe() {
    setDetalhe(null)
    setModoBalcao(false)
    // O modo de baixa NÃO desliga ao fechar: a dona está com uma pilha na mão
    // e a próxima peça vem em seguida. Desliga no botão ou no Esc.
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
    /* Dias parado, não a faixa: a faixa tem quatro degraus e empataria centenas
     * de peças. O que interessa é qual está há mais tempo na gaveta. */
    giro:        { valor: p => calcularGiro(p, staleDays).diasParado, tipo: 'numero' },
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
          {isAdmin && (
            <label className="filtro-toggle" title="Enquanto ligado, bipar abre direto a baixa da peça">
              <input
                type="checkbox"
                checked={modoBaixa}
                onChange={e => setModoBaixa(e.target.checked)}
              />
              Bipar para dar baixa
            </label>
          )}
          <span className="list-count">{total} produto{total !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.toolbarRight}>
          {/*
            Exporta o FILTRO inteiro, não os 50 da página nem os 10 da tela —
            por isso passa `filters` e não `products`. Ver produtos/exportar.ts.
          */}
          <BotaoExportar exportar={() => exportarEstoque(filters)} rotulo="Exportar" />
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
                <ThOrdenavel ord={ord} coluna="giro" className="col-secondary col-num">Em estoque há</ThOrdenavel>
                <th className="col-center">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pag.fatia.map(prod => {
                const giro = calcularGiro(prod, staleDays)
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

                    {/* Tempo em estoque. O título diz de onde vem a conta. */}
                    <td className="col-secondary col-num">
                      <span
                        className={`${styles.giro} ${giro.faixa === 'critico' ? styles.giroCritico : giro.faixa === 'parado' ? styles.giroParado : ''}`}
                        title={
                          `Entrou em ${giro.entrada.toLocaleDateString('pt-BR')}`
                          + (giro.diasAteVender !== null
                              ? ` · vendeu depois de ${textoDias(giro.diasAteVender)}`
                              : ' · nunca vendeu')
                        }
                      >
                        {textoDias(giro.diasParado)}
                      </span>
                    </td>

                    <td className="col-center">
                      {giro.faixa === 'parado'  && <span className={styles.statusParado}>{ROTULO_FAIXA.parado}</span>}
                      {giro.faixa === 'critico' && <span className={styles.statusCritico}>{ROTULO_FAIXA.critico}</span>}
                      {(giro.faixa === 'ok' || giro.faixa === 'novo') && <span className={styles.mutedCell}>—</span>}
                    </td>

                    <td onClick={e => e.stopPropagation()}>
                      <button className="icon-btn" title="Ver detalhes" onClick={() => setDetalhe(prod)}>
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
          staleDays={staleDays}
          produto={detalhe}
          isAdmin={isAdmin}
          modoBalcao={modoBalcao}
          abrirNaBaixa={modoBaixa}
          onClose={fecharDetalhe}
        />
      )}
    </>
  )
}
