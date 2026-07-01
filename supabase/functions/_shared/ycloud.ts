// Helper YCloud — envio de template (com/sem imagem) + listagem de templates.
// Doc: https://docs.ycloud.com/reference/whatsapp-messaging-examples
// Send:  POST https://api.ycloud.com/v2/whatsapp/messages   (header X-API-Key)
// List:  GET  https://api.ycloud.com/v2/whatsapp/templates?filter.wabaId=...

const YCLOUD_MSG = "https://api.ycloud.com/v2/whatsapp/messages";
const YCLOUD_TPL = "https://api.ycloud.com/v2/whatsapp/templates";
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

// ---------------------------------------------------------------------------
// Metadados de template
// ---------------------------------------------------------------------------
export type HeaderFormat = "IMAGE" | "TEXT" | "VIDEO" | "DOCUMENT" | "NONE";

export interface TemplateMeta {
  name: string;
  language: string;
  category: string;      // MARKETING | UTILITY | AUTHENTICATION
  status: string;        // APPROVED | PENDING | REJECTED | ...
  headerFormat: HeaderFormat;
  bodyText: string;
  bodyVarCount: number;  // quantas variáveis {{n}} tem no corpo
  bodyExample: string[]; // valores de exemplo de cada variável
  footer: string | null;
}

/** Conta variáveis {{1}}, {{2}}... distintas num texto. */
export function countVars(text: string): number {
  const nums = new Set<number>();
  for (const m of (text || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]));
  return nums.size;
}

function parseTemplate(t: any): TemplateMeta {
  const comps: any[] = t.components ?? [];
  const header = comps.find((c) => (c.type || "").toUpperCase() === "HEADER");
  const body   = comps.find((c) => (c.type || "").toUpperCase() === "BODY");
  const footer = comps.find((c) => (c.type || "").toUpperCase() === "FOOTER");
  const bodyText = body?.text ?? "";
  return {
    name: t.name,
    language: t.language,
    category: t.category ?? "",
    status: (t.status ?? "").toUpperCase(),
    headerFormat: (header?.format ?? "NONE").toUpperCase() as HeaderFormat,
    bodyText,
    bodyVarCount: countVars(bodyText),
    bodyExample: body?.example?.body_text?.[0] ?? [],
    footer: footer?.text ?? null,
  };
}

/** Lista templates de uma WABA (já parseados). */
export async function listTemplates(apiKey: string, wabaId: string): Promise<TemplateMeta[]> {
  const url = `${YCLOUD_TPL}?filter.wabaId=${encodeURIComponent(wabaId)}&limit=100&includeTotal=false`;
  const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!res.ok) throw new Error(`YCloud templates HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.items ?? []).map(parseTemplate);
}

/** Busca 1 template específico (nome + idioma) de uma WABA. */
export async function getTemplateMeta(
  apiKey: string, wabaId: string, name: string, language: string,
): Promise<TemplateMeta | null> {
  const url = `${YCLOUD_TPL}?filter.wabaId=${encodeURIComponent(wabaId)}` +
              `&filter.name=${encodeURIComponent(name)}&limit=100`;
  const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!res.ok) throw new Error(`YCloud templates HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  const items = (data.items ?? []).map(parseTemplate) as TemplateMeta[];
  return items.find((t) => t.name === name && t.language === language) ??
         items.find((t) => t.name === name) ?? null;
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------
export interface SendTemplateInput {
  apiKey: string;
  from: string;
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];   // já cortado no nº de variáveis do template
  imageUrl?: string;      // preenchido só se o template tem header de imagem
  externalId?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  retriable?: boolean;
}

export async function sendTemplate(i: SendTemplateInput): Promise<SendResult> {
  const components: any[] = [];
  if (i.imageUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: i.imageUrl } }],
    });
  }
  if (i.bodyParams.length) {
    components.push({
      type: "body",
      parameters: i.bodyParams.map((t) => ({ type: "text", text: sanitizeParam(t) })),
    });
  }

  const body = {
    from: i.from,
    to: i.to,
    type: "template",
    ...(i.externalId ? { externalId: i.externalId } : {}),
    template: {
      name: i.templateName,
      language: { code: i.language },
      components,
    },
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(YCLOUD_MSG, {
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
