import { redirect } from 'next/navigation'
import { requireProfile, podeConfigurarRede } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PageHeader from '@/components/ui/PageHeader'
import TaxasClient from './TaxasClient'
import { MAQUINA, type TaxaCelula } from '@/lib/taxasCartao'

export default async function TaxasCartaoPage() {
  const profile = await requireProfile()
  if (!podeConfigurarRede(profile)) redirect('/')

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('card_fees')
    .select('brand, card_type, installments, fee_pct')
    .eq('acquirer', MAQUINA)
  if (error) throw new Error('Não consegui ler as taxas de cartão.')

  const taxas: TaxaCelula[] = (data as TaxaCelula[]).map(t => ({ ...t, fee_pct: Number(t.fee_pct) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Taxas de cartão"
        subtitle={`Maquininha ${MAQUINA}. Cada venda no cartão vira recebimentos já descontada a taxa: crédito a cada 31 dias, débito no próximo dia útil.`}
      />
      <TaxasClient taxas={taxas} />
    </div>
  )
}
