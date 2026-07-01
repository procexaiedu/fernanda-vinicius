// Edge Function: disparo-templates — lista os templates aprovados da WABA da Fernanda.
// GET/POST -> { templates: TemplateMeta[] }  (apenas APPROVED)
//
// Secrets: YCLOUD_API_KEY (obrigatório). FV_WABA_ID (opcional; default = WABA da Fernanda).
import { listTemplates } from "../_shared/ycloud.ts";

const DEFAULT_WABA_ID = "2640848569584957"; // Fernanda Vinícius

Deno.serve(async (_req) => {
  try {
    const apiKey = Deno.env.get("YCLOUD_API_KEY");
    if (!apiKey) return json({ error: "YCLOUD_API_KEY ausente" }, 500);
    const wabaId = Deno.env.get("FV_WABA_ID") ?? DEFAULT_WABA_ID;

    const all = await listTemplates(apiKey, wabaId);
    const templates = all
      .filter((t) => t.status === "APPROVED")
      .sort((a, b) => a.name.localeCompare(b.name));

    return json({ templates });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
