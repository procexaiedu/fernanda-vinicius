import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiKey, wabaId, getTemplateMeta, normalizePhoneBR, sendTemplate } from '@/lib/ycloud'

/**
 * Uma passada de envio de campanha — segura e resumível.
 *
 * Veio da Edge Function `disparo-send`. O desenho em lotes foi mantido de
 * propósito, mesmo agora que roda dentro do app e não tem mais o limite de
 * tempo da Edge Function: quem reserva o lote é `fv.claim_disparo_batch`, com
 * `FOR UPDATE SKIP LOCKED`, então duas execuções simultâneas nunca pegam o
 * mesmo destinatário, e uma queda no meio não duplica mensagem nem perde a
 * fila. Isso vale mais que a economia de reescrever.
 */

const ORCAMENTO_MS = 110_000

export interface ResultadoLote {
  ok: boolean
  done?: boolean
  error?: string
  enviados: number
  falhas: number
  restantes: number
}

interface Destinatario {
  id: string
  nome: string | null
  telefone: string
  param2: string | null
  param3: string | null
}

export async function enviarLote(disparoId: string, tamanhoLote = 50): Promise<ResultadoLote> {
  const t0 = Date.now()
  const vazio = { enviados: 0, falhas: 0, restantes: 0 }

  const chave = apiKey()
  if (!chave) return { ok: false, error: 'YCLOUD_API_KEY não configurada no servidor.', ...vazio }

  const db = createAdminClient()

  const { data: disparo, error: e1 } = await db
    .from('disparos')
    .select('id, status, template_name, template_language, image_url, store_id, stores(whatsapp_phone, name)')
    .eq('id', disparoId)
    .single()

  if (e1 || !disparo) return { ok: false, error: 'Disparo não encontrado.', ...vazio }
  if (disparo.status === 'concluido') return { ok: true, done: true, ...vazio }

  const loja = (Array.isArray(disparo.stores) ? disparo.stores[0] : disparo.stores) as
    { whatsapp_phone: string | null; name: string } | null

  const from = loja?.whatsapp_phone
  if (!from) return { ok: false, error: `A loja "${loja?.name ?? '—'}" não tem whatsapp_phone cadastrado.`, ...vazio }
  if (!/^\+\d{12,13}$/.test(from)) return { ok: false, error: `whatsapp_phone inválido: ${from}`, ...vazio }

  // Estrutura do template: tem header de imagem? quantas variáveis no corpo?
  const meta = await getTemplateMeta(chave, wabaId(), disparo.template_name, disparo.template_language)
    .catch(() => null)
  const headerImagem = meta?.headerFormat === 'IMAGE'
  const qtdVariaveis = meta?.bodyVarCount ?? 3   // fallback: template antigo, 3 variáveis

  if (headerImagem && !disparo.image_url) {
    return { ok: false, error: 'O template tem header de imagem, mas o disparo não tem imagem.', ...vazio }
  }
  const imageUrl = headerImagem ? (disparo.image_url as string) : undefined

  await db.from('disparos').update({ status: 'enviando' })
    .eq('id', disparoId).in('status', ['rascunho', 'pronto', 'enviando'])

  let enviados = 0, falhas = 0

  while (Date.now() - t0 < ORCAMENTO_MS) {
    const { data: lote, error: e2 } = await db.rpc('claim_disparo_batch', {
      p_disparo_id: disparoId,
      p_limit: tamanhoLote,
    })
    if (e2) return { ok: false, error: 'Falha ao reservar o lote: ' + e2.message, enviados, falhas, restantes: 0 }

    const destinatarios = (lote ?? []) as Destinatario[]
    if (!destinatarios.length) break

    for (const d of destinatarios) {
      const to = normalizePhoneBR(d.telefone)
      if (!to) {
        await marcar(db, d.id, 'falhou', { erro: 'telefone inválido' })
        falhas++
        continue
      }

      // {{1}} = PRIMEIRO nome da cliente; {{2}}/{{3}} = parâmetros da campanha.
      const primeiroNome = String(d.nome ?? '').trim().split(/\s+/)[0] || String(d.nome ?? '')
      const params = [primeiroNome, d.param2 ?? '', d.param3 ?? '.'].slice(0, qtdVariaveis)

      const r = await sendTemplate({
        apiKey: chave,
        from,
        to,
        templateName: disparo.template_name,
        language: disparo.template_language,
        bodyParams: params,
        imageUrl,
        externalId: d.id,
      })

      if (r.ok) {
        await marcar(db, d.id, 'enviado', { telefone_e164: to, ycloud_message_id: r.messageId, erro: null })
        enviados++
      } else {
        await marcar(db, d.id, 'falhou', { telefone_e164: to, erro: r.error })
        falhas++
      }
    }
  }

  const { count: restantes } = await db
    .from('disparo_destinatarios')
    .select('id', { count: 'exact', head: true })
    .eq('disparo_id', disparoId)
    .eq('status', 'pendente')

  const done = (restantes ?? 0) === 0
  if (done) {
    await db.from('disparos')
      .update({ status: 'concluido', sent_at: new Date().toISOString() })
      .eq('id', disparoId)
  }

  return { ok: true, done, enviados, falhas, restantes: restantes ?? 0 }
}

function marcar(
  db: ReturnType<typeof createAdminClient>,
  id: string,
  status: string,
  extra: Record<string, unknown>,
) {
  return db.from('disparo_destinatarios')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq('id', id)
}
