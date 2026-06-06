import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarCompraParaEdicao } from '@/app/(sistema)/compras/actions'
import EditCompraForm from './EditCompraForm'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditarCompraPage({ params }: Props) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/')

  const { data, error } = await buscarCompraParaEdicao(id)
  if (error || !data) redirect('/compras')

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Editar Compra</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Alterações de quantidade ajustam o estoque atual pelo delta.
          Os pagamentos são recalculados por fornecedor conforme o custo dos itens.
        </p>
      </div>
      <EditCompraForm compra={data} />
    </div>
  )
}
