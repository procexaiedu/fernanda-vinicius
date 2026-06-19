// Edge Function: ycloud-webhook — recebe eventos da YCloud e atualiza status.
// DEPLOY com --no-verify-jwt (a YCloud não manda JWT do Supabase):
//   supabase functions deploy ycloud-webhook --no-verify-jwt
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.
import { createClient } from "jsr:@supabase/supabase-js@2";

const STATUS_MAP: Record<string, string> = {
  sent: "enviado", delivered: "entregue", read: "lido", failed: "falhou",
};
const RANK: Record<string, number> = { enviado: 1, entregue: 2, lido: 3, falhou: 9 };

Deno.serve(async (req) => {
  try {
    const evt = await req.json().catch(() => ({}));
    const type = evt?.type ?? "";

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "fv" } },
    );

    if (type === "whatsapp.message.updated" || evt?.whatsappMessage) {
      const msg = evt?.whatsappMessage ?? evt?.data ?? evt;
      const id = msg?.id;
      const novo = STATUS_MAP[msg?.status];
      if (!id || !novo) return ok();

      const { data: row } = await db.from("disparo_destinatarios")
        .select("status").eq("ycloud_message_id", id).maybeSingle();
      if (!row) return ok();

      if (novo !== "falhou" && (RANK[novo] ?? 0) <= (RANK[row.status] ?? 0)) return ok();

      await db.from("disparo_destinatarios").update({
        status: novo,
        erro: msg?.error?.message ?? msg?.errors?.[0]?.message ?? null,
        updated_at: new Date().toISOString(),
      }).eq("ycloud_message_id", id);
      return ok();
    }

    if (type === "whatsapp.template.reviewed") {
      const tpl = evt?.whatsappTemplate ?? evt?.data ?? {};
      console.log(`[template] ${tpl?.name}: ${tpl?.status} (${tpl?.category ?? "-"})`);
      return ok();
    }

    return ok();
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});

const ok = () => new Response("ok", { status: 200 });
