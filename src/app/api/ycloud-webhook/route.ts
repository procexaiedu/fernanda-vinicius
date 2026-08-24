import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

    if (tipo !== 'whatsapp.message.updated' && !evt?.whatsappMessage) {
      // template.reviewed e o resto: reconhece e ignora, senão a YCloud reenvia.
      return ok()
    }

    const msg = evt?.whatsappMessage ?? evt?.data ?? evt
    const id = msg?.id
    const novo = STATUS[msg?.status as keyof typeof STATUS]
    if (!id || !novo) return ok()

    const db = createAdminClient()

    const { data: linha } = await db
      .from('disparo_destinatarios')
      .select('status')
      .eq('ycloud_message_id', id)
      .maybeSingle()

    if (!linha) return ok()
    if (novo !== 'falhou' && (ORDEM[novo] ?? 0) <= (ORDEM[linha.status] ?? 0)) return ok()

    await db.from('disparo_destinatarios').update({
      status: novo,
      erro: msg?.error?.message ?? msg?.errors?.[0]?.message ?? null,
      updated_at: new Date().toISOString(),
    }).eq('ycloud_message_id', id)

    return ok()
  } catch (e) {
    // 500 faz a YCloud reenviar, que é o certo para falha transitória.
    return new NextResponse(String(e), { status: 500 })
  }
}

/** A YCloud valida a URL com um GET ao cadastrar. */
export async function GET() {
  return ok()
}
