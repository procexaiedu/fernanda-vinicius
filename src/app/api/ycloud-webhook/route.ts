import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneBR, recebidaNoFv } from '@/lib/ycloud'
import { excluirTelefone, motivoDaFalha, pedeOptOut } from '@/lib/disparo/exclusoes'

/**
 * Webhook da YCloud — é ela ligando de volta pra cá.
 *
 * Quando uma mensagem muda de estado (enviada → entregue → lida → falhou), a
 * YCloud faz um POST nesta URL. Sem isso, toda mensagem fica congelada em
 * "enviado" para sempre e a tela de métricas (v_disparo_metrics) morre: o envio
 * funciona, o retorno é que some.
 *
 * Veio da Edge Function `ycloud-webhook`. Precisa ser público — a YCloud não
 * manda JWT do Supabase — e `/api/*` já é liberado em src/proxy.ts.
 *
 * A URL nova precisa ser cadastrada no painel da YCloud:
 *   https://fevinicius.procexai.tech/api/ycloud-webhook
 * Enquanto a antiga (Supabase Cloud) continuar lá, os status não atualizam.
 */

const STATUS = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' } as const

/* Status só avança: um "entregue" que chega atrasado não pode rebaixar um "lido"
   que já veio. A YCloud não garante ordem de entrega dos eventos. */
const ORDEM: Record<string, number> = { enviado: 1, entregue: 2, lido: 3, falhou: 9 }

const ok = () => new NextResponse('ok', { status: 200 })

export async function POST(req: NextRequest) {
  try {
    /* Rota pública. Se YCLOUD_WEBHOOK_TOKEN estiver definida, exige ?token=;
       sem ela, aceita qualquer chamada — que é como a Edge Function funcionava.
       Sem o token, um terceiro que descubra a URL consegue, no máximo, mexer no
       status de mensagens cujo id ele já conheça. */
    const esperado = process.env.YCLOUD_WEBHOOK_TOKEN
    if (esperado && req.nextUrl.searchParams.get('token') !== esperado) {
      return new NextResponse('unauthorized', { status: 401 })
    }

    const evt = await req.json().catch(() => ({}))
    const tipo = evt?.type ?? ''

    if (tipo === 'whatsapp.inbound_message.received') {
      await respostaRecebida(evt?.whatsappInboundMessage ?? {})
      return ok()
    }

    if (tipo !== 'whatsapp.message.updated' && !evt?.whatsappMessage) {
      // template.reviewed e o resto: reconhece e ignora, senão a YCloud reenvia.
      return ok()
    }

    const msg = evt?.whatsappMessage ?? evt?.data ?? evt
    const id = msg?.id
    const novo = STATUS[msg?.status as keyof typeof STATUS]
    if (!id || !novo) return ok()

    const db = createAdminClient()

    const { data: linha, error: eLeitura } = await db
      .from('disparo_destinatarios')
      .select('status, customer_id, telefone_e164, disparos(store_id)')
      .eq('ycloud_message_id', id)
      .maybeSingle()

    if (eLeitura) throw new Error(eLeitura.message)
    if (!linha) return ok()
    if (novo !== 'falhou' && (ORDEM[novo] ?? 0) <= (ORDEM[linha.status] ?? 0)) return ok()

    // A YCloud manda o código em whatsappApiError (Meta) ou errorCode (dela).
    const codigo = msg?.whatsappApiError?.code ?? msg?.errorCode ?? msg?.errors?.[0]?.code ?? null
    const texto = msg?.whatsappApiError?.message ?? msg?.errorMessage
      ?? msg?.error?.message ?? msg?.errors?.[0]?.message ?? null

    const { error: eUpd } = await db.from('disparo_destinatarios').update({
      status: novo,
      erro: novo === 'falhou' ? [codigo, texto].filter(Boolean).join(' ') || null : null,
      updated_at: new Date().toISOString(),
    }).eq('ycloud_message_id', id)
    if (eUpd) throw new Error(eUpd.message)

    /* Falha permanente (sem WhatsApp, bloqueio, parou de receber marketing)
       entra na lista de exclusão da loja. Saldo e taxa não: são passageiros. */
    const motivo = novo === 'falhou' ? motivoDaFalha(codigo) : null
    const disp = (Array.isArray(linha.disparos) ? linha.disparos[0] : linha.disparos) as { store_id: string } | null
    const tel = linha.telefone_e164 ?? msg?.to
    if (motivo && disp?.store_id && tel) {
      const r = await excluirTelefone(db, {
        store_id: disp.store_id, telefone: tel, customer_id: linha.customer_id,
        motivo, origem: 'webhook', detalhe: `${codigo} ${texto ?? ''}`.trim(),
      })
      if (!r.ok) throw new Error(r.error)
    }

    return ok()
  } catch (e) {
    // 500 faz a YCloud reenviar, que é o certo para falha transitória.
    return new NextResponse(String(e), { status: 500 })
  }
}

/**
 * Resposta da cliente. Marca `responded_at` no último envio para ela e, se o
 * texto pede para parar ("pare", "sair", "não quero"...), exclui da loja que
 * mandou a campanha. A loja sai do disparo, não do número: Campinas e Brasília
 * mandam pelo mesmo número.
 *
 * Com o número em coexistência (app + API), a YCloud só manda este evento se a
 * assinatura `whatsapp.inbound_message.received` estiver ligada no webhook.
 */
async function respostaRecebida(m: { from?: string; to?: string; wabaId?: string; type?: string; text?: { body?: string }; button?: { text?: string } }) {
  // Evento de outro número da conta (Joana, iPrado...): reconhece e ignora.
  if (!recebidaNoFv(m)) return
  const tel = normalizePhoneBR(m.from ?? '')
  if (!tel) return
  const db = createAdminClient()

  const { data: ultimo, error } = await db.from('disparo_destinatarios')
    .select('id, customer_id, disparos(store_id)')
    .eq('telefone_e164', tel)
    .not('ycloud_message_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!ultimo) return   // nunca recebeu campanha: não é resposta de disparo

  await db.from('disparo_destinatarios').update({ responded_at: new Date().toISOString() }).eq('id', ultimo.id)

  const texto = m.text?.body ?? m.button?.text ?? ''
  const palavra = pedeOptOut(texto)
  const disp = (Array.isArray(ultimo.disparos) ? ultimo.disparos[0] : ultimo.disparos) as { store_id: string } | null
  if (!palavra || !disp?.store_id) return

  const r = await excluirTelefone(db, {
    store_id: disp.store_id, telefone: tel, customer_id: ultimo.customer_id,
    motivo: 'opt_out', origem: 'resposta', detalhe: `respondeu "${palavra}"`,
  })
  if (!r.ok) throw new Error(r.error)
}

/** A YCloud valida a URL com um GET ao cadastrar. */
export async function GET() {
  return ok()
}
