// Edge Function: disparo-send — dispara uma campanha de forma SEGURA e RESUMÍVEL.
// POST { disparo_id, batch_size? }
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente pelo Supabase.
// Único secret a configurar:  supabase secrets set YCLOUD_API_KEY=...
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizePhoneBR, sendTemplate } from "../_shared/ycloud.ts";

const TIME_BUDGET_MS = 110_000;

Deno.serve(async (req) => {
  const t0 = Date.now();
  try {
    const { disparo_id, batch_size = 50 } = await req.json();
    if (!disparo_id) return json({ error: "disparo_id obrigatório" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "fv" } },
    );

    const { data: disparo, error: e1 } = await db
      .from("disparos")
      .select("id,status,template_name,template_language,store_id,stores(whatsapp_phone,name)")
      .eq("id", disparo_id).single();
    if (e1 || !disparo) return json({ error: "disparo não encontrado" }, 404);
    if (disparo.status === "concluido") return json({ ok: true, done: true, msg: "já concluído" });

    const from = (disparo as any).stores?.whatsapp_phone;
    if (!from) return json({ error: `loja "${(disparo as any).stores?.name}" sem whatsapp_phone` }, 400);
    if (!/^\+\d{12,13}$/.test(from)) return json({ error: `whatsapp_phone inválido: ${from}` }, 400);

    const apiKey = Deno.env.get("YCLOUD_API_KEY");
    if (!apiKey) return json({ error: "YCLOUD_API_KEY ausente" }, 500);

    await db.from("disparos").update({ status: "enviando" }).eq("id", disparo_id)
      .in("status", ["rascunho", "pronto", "enviando"]);

    let enviados = 0, falhas = 0;
    while (Date.now() - t0 < TIME_BUDGET_MS) {
      const { data: batch, error: e2 } = await db.rpc("claim_disparo_batch", {
        p_disparo_id: disparo_id, p_limit: batch_size,
      });
      if (e2) return json({ error: "claim falhou: " + e2.message }, 500);
      if (!batch || batch.length === 0) break;

      for (const d of batch as any[]) {
        const to = normalizePhoneBR(d.telefone);
        if (!to) { await mark(db, d.id, "falhou", { erro: "telefone inválido" }); falhas++; continue; }

        const r = await sendTemplate({
          apiKey, from, to,
          templateName: disparo.template_name,
          language: disparo.template_language,
          params: [d.nome, d.param2 ?? "", d.param3 ?? "."],
          externalId: d.id,
        });

        if (r.ok) { await mark(db, d.id, "enviado", { telefone_e164: to, ycloud_message_id: r.messageId, erro: null }); enviados++; }
        else      { await mark(db, d.id, "falhou",  { telefone_e164: to, erro: r.error }); falhas++; }
      }
    }

    const { count: restantes } = await db.from("disparo_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("disparo_id", disparo_id).eq("status", "pendente");

    const done = (restantes ?? 0) === 0;
    if (done) await db.from("disparos").update({ status: "concluido", sent_at: new Date().toISOString() }).eq("id", disparo_id);
    return json({ ok: true, done, enviados, falhas, restantes: restantes ?? 0 });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function mark(db: any, id: string, status: string, extra: Record<string, unknown>) {
  return db.from("disparo_destinatarios")
    .update({ status, updated_at: new Date().toISOString(), ...extra }).eq("id", id);
}
function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
}
