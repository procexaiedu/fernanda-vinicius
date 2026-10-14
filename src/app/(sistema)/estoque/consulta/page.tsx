import PageHeader from '@/components/ui/PageHeader'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { aplicarFiltrosProdutos } from '@/lib/estoque/consulta'
import { formatarDinheiro } from '@/lib/dinheiro'
import styles from './Consulta.module.css'

const LIMITE = 50

/**
 * Consulta de estoque da vendedora (pedido da Eleandra, 13/10).
 *
 * Código, descrição, quantidade e preço de venda. NADA de custo, margem ou
 * fornecedor, e isso é decidido AQUI, no select: as colunas de custo nem saem
 * do banco, então não há o que vazar no HTML nem no payload do RSC. Não use
 * `select('*')` nesta página.
 *
 * A loja vem de `lojaDoEscopo`: a operadora está presa à dela (Campinas não vê
 * Brasília). Nenhum parâmetro de loja é lido da URL.
 *
 * Sem termo, mostra o que tem saldo; com termo, mostra também o que zerou,
 * porque "não tem mais" é resposta que ela precisa dar à cliente.
 */
export default async function ConsultaEstoquePage({ searchParams }: {
  searchParams: Promise<{ q?: string }>
}) {
  const profile = await requireProfile()
  const loja = lojaDoEscopo(profile)
  const q = (await searchParams).q?.trim() ?? ''

  const admin = createAdminClient()
  const consulta = aplicarFiltrosProdutos(
    admin
      .from('products')
      .select('id, code, name, sale_price, quantity_in_stock, stores(name)', { count: 'exact' })
      .eq('is_service', false),
    'estoque',
    { q: q || undefined, qty_zero: q ? 'true' : undefined },
    loja,
  )
    .order('name')
    .order('id')
    .limit(LIMITE)

  const { data, error, count } = await consulta
  /* Falha não é "não tem a peça": lança e a tela de erro aparece. */
  if (error) throw new Error(`Não foi possível consultar o estoque: ${error.message}`)

  const pecas = (data ?? []) as unknown as {
    id: string; code: string; name: string; sale_price: number | null
    quantity_in_stock: number; stores: { name: string } | null
  }[]
  const total = count ?? pecas.length
  const mostraLoja = !loja

  return (
    <div>
      <PageHeader
        title="Consulta de estoque"
        subtitle={profile.store_name ? `Peças da loja ${profile.store_name}.` : 'Peças das lojas.'}
      />

      <form className={styles.busca} method="get">
        <input
          className={styles.input}
          name="q"
          defaultValue={q}
          placeholder="Código, nome ou bipe a etiqueta"
          autoFocus
          autoComplete="off"
        />
        <button className={styles.botao} type="submit">Buscar</button>
      </form>

      <div className={styles.resumo}>
        {total === 0
          ? (q ? `Nenhuma peça encontrada para "${q}".` : 'Nenhuma peça com saldo.')
          : total > pecas.length
            ? `Mostrando ${pecas.length} de ${total}. Refine a busca para achar a peça.`
            : `${total} peça${total > 1 ? 's' : ''}`}
      </div>

      {pecas.length > 0 && (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              {mostraLoja && <th>Loja</th>}
              <th className={styles.num}>Qtd.</th>
              <th className={styles.num}>Preço</th>
            </tr>
          </thead>
          <tbody>
            {pecas.map(p => (
              <tr key={p.id}>
                <td className={styles.codigo}>{p.code}</td>
                <td>{p.name}</td>
                {mostraLoja && <td>{p.stores?.name ?? '—'}</td>}
                <td className={`${styles.num} ${p.quantity_in_stock <= 0 ? styles.zerado : ''}`}>
                  {p.quantity_in_stock}
                </td>
                <td className={`${styles.num} ${styles.preco}`}>{formatarDinheiro(p.sale_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
