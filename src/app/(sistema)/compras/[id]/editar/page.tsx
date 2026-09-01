import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { buscarCompraParaEdicao } from '@/app/(sistema)/compras/actions'
import EditCompraForm from './EditCompraForm'
import PageHeader from '@/components/ui/PageHeader'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditarCompraPage({ params }: Props) {
  const { id } = await params

  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/')

  const { data, error } = await buscarCompraParaEdicao(id)
  if (error || !data) redirect('/compras')

  return (
    <div className="page-pad" style={{ maxWidth: 1400 }}>
      <PageHeader
        title="Editar Compra"
        subtitle="Alterações de quantidade ajustam o estoque atual pelo delta. Os pagamentos são recalculados por fornecedor conforme o custo dos itens."
        backHref="/compras"
        backLabel="Voltar para Compras"
      />
      <EditCompraForm compra={data} />
    </div>
  )
}
