import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assinaturaValida, cnpjDaLoja, interpretar, type CorpoProcex } from '@/lib/fiscal/procexFiscal'
import { gravarResultado } from '@/lib/fiscal/gravarNota'

/**
 * Webhook da procex-fiscal: ela avisando que uma nota mudou (autorizada,
 * rejeitada, cancelada, contingência transmitida).
 *
 * É o que fecha a nota que ficou `pendente`: SEFAZ lenta (o POST voltou 202),
 * rede caindo no meio, contingência offline. Sem ele, a venda fica "pendente"
 * até alguém clicar em "Consultar na Receita".
 *
 * Público (`/api/*` é liberado em src/proxy.ts), mas só aceita corpo ASSINADO:
 * `X-ProceX-Signature: sha256=<HMAC-SHA256(corpo cru, segredo)>`. O segredo é
 * o `segredo_assinatura` devolvido UMA vez por `POST /v2/hooks` e fica em
 * PROCEX_FISCAL_WEBHOOK_SEGREDO. Sem a variável, recusa tudo (fecha, não abre).
 *
 * Cadastro (uma vez por ambiente da procex-fiscal):
 *   POST {PROCEX_FISCAL_URL}/v2/hooks  {"event":"nfce","cnpj":"<cnpj>","url":"https://fevinicius.procexai.tech/api/procex-fiscal-webhook"}
 *
 * Idempotente: o mesmo aviso pode chegar mais de uma vez (a plataforma reenvia
 * por até 24 h) e fora de ordem; `gravarResultado` não rebaixa nota autorizada
 * nem ressuscita cancelada.
 */

const resposta = (status: number, corpo: Record<string, unknown>) => NextResponse.json(corpo, { status })

export async function POST(req: NextRequest) {
  const segredo = process.env.PROCEX_FISCAL_WEBHOOK_SEGREDO ?? ''
  const cru = await req.text() // a assinatura é do corpo CRU: ler antes de parsear

  if (!(await assinaturaValida(cru, req.headers.get('x-procex-signature'), segredo))) {
    return resposta(401, { ok: false })
  }

  let corpo: CorpoProcex
  try { corpo = JSON.parse(cru) as CorpoProcex } catch { return resposta(400, { ok: false, erro: 'json_invalido' }) }

  /* Só NFC-e de venda nossa (`venda-<uuid>`). O resto é reconhecido e
   * ignorado com 200, senão a plataforma reenvia por 24 h. */
  const ref = corpo.ref ?? ''
  if (!/^venda-[0-9a-f-]{36}$/i.test(ref)) return resposta(200, { ok: true, ignorado: 'ref' })

  const admin = createAdminClient()
  const { data: venda, error } = await admin
    .from('sales').select('id, stores(cnpj)').eq('nfce_ref', ref).maybeSingle()

  // Falha de leitura: 500 para a plataforma tentar de novo mais tarde.
  if (error) {
    console.error('[procex-fiscal-webhook] falha ao ler a venda', error)
    return resposta(500, { ok: false })
  }
  if (!venda) return resposta(200, { ok: true, ignorado: 'venda' })

  /* O CNPJ do aviso tem de ser o da loja da venda: a mesma ref não pode mexer
   * na nota de outra empresa. */
  const cnpjLoja = (cnpjDaLoja(venda.stores) ?? '').replace(/\D/g, '')
  const cnpjAviso = (corpo.cnpj_emitente ?? '').replace(/\D/g, '')
  if (!cnpjLoja || cnpjLoja !== cnpjAviso) return resposta(200, { ok: true, ignorado: 'cnpj' })

  const r = await gravarResultado(venda.id, interpretar(200, corpo), ref)
  if (r.error) {
    console.error('[procex-fiscal-webhook] falha ao gravar', r.error)
    return resposta(500, { ok: false })
  }
  return resposta(200, { ok: true })
}
