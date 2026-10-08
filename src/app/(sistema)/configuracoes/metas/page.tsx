import { redirect } from 'next/navigation'
import { requireProfile, ehAdmin, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMesValido, limitesDoMesSP, metaDoMes } from '@/lib/metas/loja'
import { apurarLoja, mesAtualSP } from '@/lib/metas/lojaServer'
import MetasClient, { type LinhaComissao } from './MetasClient'
import MetaLojaCard from '@/components/metas/MetaLojaCard'
import PageHeader from '@/components/ui/PageHeader'

interface PageProps {
  searchParams: Promise<{ month?: string }>
}

/*
 * Meta da LOJA e comissão em faixas (06/10/2026). Admin global e admin de loja
 * entram; cada uma só vê e mexe na loja da própria sessão (lojaDoEscopo).
 */
export default async function MetasPage({ searchParams }: PageProps) {
  const { month } = await searchParams
  const profile = await requireProfile()
  if (!ehAdmin(profile)) redirect('/')
  const loja = lojaDoEscopo(profile)
  if (!loja) redirect('/escolher-loja')

  const mes = isMesValido(month) ? month : mesAtualSP()
  const admin = createAdminClient()

  const [apuracao, usersRes, txRes, lojaRes] = await Promise.all([
    apurarLoja(loja, mes),
    admin.from('users').select('id, full_name'),
    admin.from('transactions').select('user_id, amount, status')
      .eq('reference_type', 'seller_commission').eq('store_id', loja)
      .gte('transaction_date', `${mes}-01`).lt('transaction_date', limitesDoMesSP(mes).fim.slice(0, 10)),
    admin.from('stores').select('name').eq('id', loja).single(),
  ])
  if (usersRes.error) throw new Error(`Não foi possível ler as vendedoras: ${usersRes.error.message}`)
  if (txRes.error) throw new Error(`Não foi possível ler as comissões lançadas: ${txRes.error.message}`)

  const nomes = new Map((usersRes.data ?? []).map(u => [u.id as string, u.full_name as string]))
  const lancadas = new Map((txRes.data ?? []).map(t => [t.user_id as string, { valor: Number(t.amount), paga: t.status === 'completed' }]))

  const linhas: LinhaComissao[] = apuracao.porVendedora
    .map(c => ({
      sellerId: c.sellerId,
      nome: nomes.get(c.sellerId) ?? 'Vendedora',
      vendas: c.vendas,
      base: c.base,
      pct: c.pct,
      comissao: c.comissao,
      lancada: lancadas.get(c.sellerId) ?? null,
    }))
    .sort((a, b) => b.base - a.base)

  const nomeLoja = lojaRes.data?.name ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        title="Meta da loja"
        subtitle={`Meta do mês e comissão das vendedoras${nomeLoja ? ` de ${nomeLoja}` : ''}. Bateu a meta: todas recebem a faixa maior.`}
      />
      <MetaLojaCard progresso={apuracao.progresso} nomeLoja={nomeLoja} />
      <MetasClient
        mes={mes}
        mesAtual={mesAtualSP()}
        config={apuracao.config}
        metaDoMes={metaDoMes(apuracao.config, mes)}
        temMetaPropria={mes in apuracao.config.porMes}
        linhas={linhas}
        semVendedora={apuracao.semVendedora}
        bateu={apuracao.progresso.bateu}
      />
    </div>
  )
}
