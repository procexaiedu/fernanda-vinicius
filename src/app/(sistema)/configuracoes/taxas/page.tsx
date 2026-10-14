import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import PageHeader from '@/components/ui/PageHeader'
import TaxasClient from './TaxasClient'
import PrazosClient from './PrazosClient'
import { lojaDaConfiguracao } from '@/lib/lojasQueAdministra'
import { MAQUINA, type TaxaCelula, type PrazoLinha } from '@/lib/taxasCartao'

export default async function TaxasCartaoPage() {
  const profile = await requireProfile()
  // Sempre a loja da sessão: ?loja= na URL é ignorado (Campinas e Brasília são
  // sistemas separados; para ver a outra, troca-se a loja no menu).
  const loja = await lojaDaConfiguracao(profile)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('card_fees')
    .select('brand, card_type, installments, fee_pct')
    .eq('store_id', loja.id)
    .eq('acquirer', MAQUINA)
  if (error || !data) throw new Error('Não consegui ler as taxas de cartão.')

  const { data: prazosRaw, error: errPrazos } = await admin
    .from('card_prazos')
    .select('brand, card_type, prazo_dias, intervalo_dias, dia_util')
    .eq('store_id', loja.id)
    .eq('acquirer', MAQUINA)
  if (errPrazos || !prazosRaw) throw new Error('Não consegui ler os prazos de recebimento.')
  const prazos = prazosRaw as PrazoLinha[]

  const taxas: TaxaCelula[] = (data as TaxaCelula[]).map(t => ({ ...t, fee_pct: Number(t.fee_pct) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Taxas de cartão"
        subtitle={`Maquininha ${MAQUINA} de ${loja.name}. Cada venda no cartão da loja vira recebimentos já descontada a taxa, nas datas dos prazos abaixo.`}
      />
      <TaxasClient key={loja.id} taxas={taxas} lojaId={loja.id} />
      <PrazosClient key={`p-${loja.id}`} prazos={prazos} lojaId={loja.id} />
    </div>
  )
}
