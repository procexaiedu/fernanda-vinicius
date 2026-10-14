import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PageHeader from '@/components/ui/PageHeader'
import TaxasClient from './TaxasClient'
import { lojasDasTaxas } from './lojas'
import { MAQUINA, type TaxaCelula } from '@/lib/taxasCartao'

export default async function TaxasCartaoPage({ searchParams }: { searchParams: Promise<{ loja?: string }> }) {
  const profile = await requireProfile()
  const lojas = await lojasDasTaxas(profile)
  if (lojas.length === 0) redirect('/')

  // A loja pedida só vale se for uma das dela; senão a da sessão, senão a primeira.
  const pedida = (await searchParams).loja
  const loja =
    lojas.find(l => l.id === pedida) ??
    lojas.find(l => l.id === profile.lojaSelecionada) ??
    lojas[0]

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('card_fees')
    .select('brand, card_type, installments, fee_pct')
    .eq('store_id', loja.id)
    .eq('acquirer', MAQUINA)
  if (error || !data) throw new Error('Não consegui ler as taxas de cartão.')

  const taxas: TaxaCelula[] = (data as TaxaCelula[]).map(t => ({ ...t, fee_pct: Number(t.fee_pct) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Taxas de cartão"
        subtitle={`Maquininha ${MAQUINA} de ${loja.name}. Cada venda no cartão da loja vira recebimentos já descontada a taxa: crédito a cada 31 dias, débito no próximo dia útil.`}
      />
      {/* key: trocar de loja remonta a grade com os valores da outra loja. */}
      <TaxasClient key={loja.id} taxas={taxas} lojas={lojas} lojaId={loja.id} />
    </div>
  )
}
