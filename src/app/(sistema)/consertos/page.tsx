import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { requireProfile, ehOperadora, lojaDoEscopo } from '@/lib/auth'
import { listarConsertos } from './actions'
import ConsertosClient from './ConsertosClient'

/**
 * Onde está a peça da cliente.
 *
 * A operadora entra: é ela quem recebe a peça no balcão e quem a cliente
 * procura ao voltar. Diferente das telas de gestão, aqui não há custo, margem
 * nem fornecedor — só de quem é a peça, o que foi feito e onde ela está.
 */
export default async function ConsertosPage() {
  const profile = await requireProfile()

  const escopoLoja = lojaDoEscopo(profile)

  const admin = createAdminClient()
  /*
   * Todas as clientes da loja, paginado. Era `.limit(400)` com o erro
   * engolido: a partir da 401ª em ordem alfabética a cliente simplesmente não
   * aparecia no seletor — não dava para receber a peça da Zuleide — e uma
   * falha de leitura virava seletor vazio. `fetchAll` lê até o fim e LANÇA
   * se o banco falhar.
   */
  const [consertos, clientes] = await Promise.all([
    listarConsertos(),
    fetchAll<{ id: string; name: string; phone: string | null }>((de, ate) => {
      // Só as clientes da loja — mesmo corte de 04/09.
      let q = admin.from('customers').select('id, name, phone')
      if (escopoLoja) q = q.eq('origin_store_id', escopoLoja)
      // `id` desempata nomes iguais: sem ordem total, a paginação pula/repete.
      return q.order('name').order('id').range(de, ate)
    }),
  ])

  return (
    <div>
      <PageHeader
        title="Consertos"
        subtitle="Peças das clientes que estão na loja ou com o ourives."
      />
      <ConsertosClient
        inicial={consertos}
        clientes={clientes}
        podeApagar={!ehOperadora(profile)}
      />
    </div>
  )
}
