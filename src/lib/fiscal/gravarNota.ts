import { createAdminClient } from '@/lib/supabase/admin'
import type { RespostaNota } from './procexFiscal'

/**
 * Grava na venda o que o emissor devolveu. Usada pela emissão, pela consulta
 * ("Consultar na Receita") e pelo webhook da procex-fiscal.
 *
 * Mora fora de `vendas/fiscal.ts` porque lá é `'use server'`: tudo que é
 * exportado de lá vira server action chamável pelo navegador, e isto não pode.
 *
 * O XML é guardado no NOSSO banco, não só referenciado por link: a lei exige
 * guarda de 5 anos mais o ano corrente, e é o que permite trocar de provedor
 * sem migração (foi o que deixou a troca Focus → procex-fiscal sem dor).
 *
 * Regras que esta função garante:
 * - Se o download do XML falhar, a nota **continua autorizada**. Só o arquivo
 *   fica para depois (o cupom busca de novo).
 * - **Nunca apaga** chave, XML ou data de emissão de uma nota que já tem. Antes,
 *   consultar uma nota cancelada gravava `nfce_xml = null` (o XML só era baixado
 *   quando `ok`), e o arquivo que a lei manda guardar sumia.
 * - **Não ressuscita nota cancelada**: um "autorizado" atrasado (webhook fora de
 *   ordem) não desfaz um cancelamento.
 */
export async function gravarResultado(saleId: string, resp: RespostaNota, ref: string): Promise<{ error: string | null }> {
  const admin = createAdminClient()

  const { data: atual, error: erroAtual } = await admin
    .from('sales').select('store_id, nfce_status, nfce_xml').eq('id', saleId).single()
  if (erroAtual || !atual) return { error: 'Não consegui ler a venda para gravar a nota.' }

  // Nota a caminho: nada muda além do motivo, que diz o que está acontecendo.
  if (resp.status === 'processando_autorizacao') {
    if (atual.nfce_status === 'autorizada' || atual.nfce_status === 'cancelada') return { error: null }
    const { error } = await admin.from('sales').update({
      nfce_status: 'pendente', nfce_ref: ref,
      nfce_motivo_rejeicao: resp.mensagem ?? 'A SEFAZ ainda está processando a nota.',
    }).eq('id', saleId)
    return { error: error?.message ?? null }
  }

  if (resp.status === 'cancelado') {
    const { error } = await admin.from('sales').update({ nfce_status: 'cancelada' }).eq('id', saleId)
    return { error: error?.message ?? null }
  }

  if (!resp.ok) {
    /* Rejeição que chega DEPOIS de uma autorização (ou de um cancelamento) é
     * ruído de entrega fora de ordem: a SEFAZ não volta atrás numa nota
     * autorizada. Erro de cancelamento também não mexe no estado da nota. */
    if (atual.nfce_status === 'autorizada' || atual.nfce_status === 'cancelada') return { error: null }
    const { error } = await admin.from('sales').update({
      nfce_status:          resp.status === 'nao_encontrado' ? 'erro' : 'rejeitada',
      nfce_ref:             ref,
      nfce_motivo_rejeicao: resp.mensagem ?? 'A nota não foi autorizada.',
    }).eq('id', saleId)
    return { error: error?.message ?? null }
  }

  // ── Autorizada ──
  if (atual.nfce_status === 'cancelada') return { error: null }

  let xml: string | null = resp.xml ?? (atual.nfce_xml as string | null)
  if (!xml && resp.xmlUrl) {
    try {
      const r = await fetch(resp.xmlUrl, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
      if (r.ok) xml = await r.text()
    } catch { /* nota vale, arquivo fica para depois */ }
  }

  /* O POST não traz o protocolo (só a consulta completa); o XML autorizado traz. */
  const protocolo = resp.protocolo ?? xml?.match(/<nProt>(\d+)<\/nProt>/)?.[1]

  const { error } = await admin.from('sales').update({
    nfce_status:          'autorizada',
    nfce_ref:             ref,
    nfce_chave:           resp.chave ?? null,
    nfce_numero:          resp.numero ? Number(resp.numero) : null,
    nfce_serie:           resp.serie ? Number(resp.serie) : null,
    nfce_danfe_url:       resp.danfeUrl ?? null,
    /* O cupom 80mm (/cupom/[id]) usa estes dois quando o XML não foi baixado. */
    nfce_qrcode_url:      resp.qrcodeUrl ?? null,
    ...(protocolo ? { nfce_protocolo: protocolo } : {}),
    ...(xml ? { nfce_xml: xml } : {}),
    nfce_motivo_rejeicao: null,
    ...(atual.nfce_status !== 'autorizada' ? { nfce_emitida_em: new Date().toISOString() } : {}),
  }).eq('id', saleId)
  if (error) return { error: error.message }

  /* Registro da numeração da loja. Quem controla a sequência de verdade é a
   * procex-fiscal; isto só mostra no cadastro até onde a série foi. */
  if (resp.numero && atual.store_id) {
    await admin.from('fiscal_emitentes')
      .update({ proximo_numero_nfce: Number(resp.numero) + 1, updated_at: new Date().toISOString() })
      .eq('store_id', atual.store_id)
  }
  return { error: null }
}
