import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { createAdminClient } from '@/lib/supabase/admin'
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
  const [consertos, clientesRes] = await Promise.all([
    listarConsertos(),
    (() => {
      // Só as clientes da loja — mesmo corte de 04/09.
      let q = admin.from('customers').select('id, name, phone')
      if (escopoLoja) q = q.eq('origin_store_id', escopoLoja)
      return q.order('name').limit(400)
    })(),
  ])

  return (
    <div>
      <PageHeader
        title="Consertos"
        subtitle="Peças das clientes que estão na loja ou com o ourives."
      />
      <ConsertosClient
        inicial={consertos}
        clientes={(clientesRes.data ?? []) as { id: string; name: string; phone: string | null }[]}
        podeApagar={!ehOperadora(profile)}
      />
    </div>
  )
}
