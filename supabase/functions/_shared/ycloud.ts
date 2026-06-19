// Helper YCloud — envio de template + utilidades. (Deno / Supabase Edge Functions)
// Doc: https://docs.ycloud.com/reference/whatsapp-message-sending-guide
// Endpoint: POST https://api.ycloud.com/v2/whatsapp/messages  (header X-API-Key)

const YCLOUD_API = "https://api.ycloud.com/v2/whatsapp/messages";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normaliza telefone BR -> E.164 (+55...). Cadastro vem como "(DD) 9XXXX-XXXX". */
export function normalizePhoneBR(raw: string): string | null {
  let n = (raw || "").replace(/\D/g, "");
  if (n.startsWith("55") && (n.length === 12 || n.length === 13)) {
    // já tem DDI 55
  } else if (n.length === 10 || n.length === 11) {
    n = "55" + n;
  } else {
    return null;
  }
  return "+" + n;
}

/** WhatsApp recusa parâmetros com quebras de linha/tabs/4+ espaços. Nunca devolve vazio. */
export function sanitizeParam(v: string | null | undefined): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s.length ? s : ".";
}

export interface SendTemplateInput {
  apiKey: string;
  from: string;
  to: string;
  templateName: string;
  language: string;
  params: string[];
  externalId?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  retriable?: boolean;
}

export async function sendTemplate(i: SendTemplateInput): Promise<SendResult> {
  const body = {
    from: i.from,
    to: i.to,
    type: "template",
    ...(i.externalId ? { externalId: i.externalId } : {}),
    template: {
      name: i.templateName,
      language: { code: i.language },
      components: [
        { type: "body", parameters: i.params.map((t) => ({ type: "text", text: sanitizeParam(t) })) },
      ],
    },
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(YCLOUD_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": i.apiKey },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts) { await sleep(600 * attempt); continue; }
        return { ok: false, retriable: true, error: `HTTP ${res.status} (transitório)` };
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message || data?.message || `HTTP ${res.status}` };
      return { ok: true, messageId: data?.id };
    } catch (e) {
      if (attempt < maxAttempts) { await sleep(600 * attempt); continue; }
      return { ok: false, retriable: true, error: String(e) };
    }
  }
  return { ok: false, error: "inalcançável" };
}
