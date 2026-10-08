import { notFound } from 'next/navigation'
import { requireProfile, lojaDoEscopo } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { consultarNfce, cnpjDaLoja } from '@/lib/fiscal/procexFiscal'
import {
  lerXmlNfce,
} from '@/lib/fiscal/cupom'
import CupomNfceView from './CupomNfceView'
import styles from './cupom.module.css'

/**
 * Cupom da NFC-e em 80mm, para a impressora térmica do balcão.
 *
 * Mora FORA de (sistema) de propósito: dentro, o papel sairia com a barra
 * lateral. A trava de acesso que o layout de lá faria fica aqui: precisa estar
 * logado e a venda tem de ser da loja de quem pede (admin global passa).
 *
 * O PDF do emissor (procex-fiscal) continua existindo (botão "Baixar DANFE") e é o que vai no
 * WhatsApp. Este é o papel.
 */

export const dynamic = 'force-dynamic'

export default async function CupomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  /* Login ativo obrigatório (o proxy já manda para /login sem sessão; isto
   * barra também o usuário inativado). Não há link público: o que vai para a
   * cliente no WhatsApp é o PDF do emissor. */
  const perfil = await requireProfile()

  const admin = createAdminClient()
  const { data: venda, error } = await admin
    .from('sales')
    .select('id, store_id, nfce_status, nfce_ref, nfce_xml, nfce_danfe_url, stores(cnpj)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error('Não consegui ler a venda. Tente de novo em instantes.')
  if (!venda) notFound()

  /* Venda de outra loja responde como inexistente: nem confirma que o id existe.
   * Admin global (escopo null) passa, como em fiscal.ts (`daMinhaLoja`). */
  const escopo = lojaDoEscopo(perfil)
  if (escopo && escopo !== venda.store_id) notFound()

  if (venda.nfce_status !== 'autorizada') {
    return (
      <main className={styles.pagina}>
        <p className={styles.aviso}>Esta venda não tem nota autorizada, então não há cupom para imprimir.</p>
      </main>
    )
  }

  /*
   * XML ainda não baixado (o download depois da emissão falhou): pede de novo
   * ao emissor pela referência e guarda — é o mesmo arquivo que a lei manda
   * guardar, então a viagem também conserta o que faltava no banco.
   */
  let xml = venda.nfce_xml as string | null
  if (!xml && venda.nfce_ref) {
    /* `completa` traz o XML autorizado no próprio corpo: uma viagem só. */
    const cnpj = cnpjDaLoja(venda.stores)
    const resp = await consultarNfce(venda.nfce_ref, true, cnpj)
    if (resp.ok && resp.xml) {
      xml = resp.xml
      await admin.from('sales').update({ nfce_xml: xml }).eq('id', venda.id)
    }
  }

  const c = lerXmlNfce(xml)
  if (!c) {
    return (
      <main className={styles.pagina}>
        <p className={styles.aviso}>
          Não consegui montar o cupom agora (o arquivo da nota não chegou do emissor fiscal).
          {venda.nfce_danfe_url && <> Use o <a href={venda.nfce_danfe_url} target="_blank" rel="noopener noreferrer">PDF da nota</a> para imprimir.</>}
        </p>
      </main>
    )
  }

  return <CupomNfceView c={c} />
}
