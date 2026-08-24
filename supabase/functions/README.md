# Estas Edge Functions NÃO estão mais em uso

Em 24/08/2026 o sistema saiu do Supabase Cloud e foi para o self-hosted da
ProceX (`db.procexai.tech`). **Aquele servidor não tem runtime de Edge
Functions** — nenhum dos 9 projetos hospedados nele usa, e o serviço nem existe
na stack.

As três funções foram portadas para dentro do app Next.js. Nada se perdeu: elas
nunca dependeram de Deno, só de `fetch` e do service role.

| antes (Edge Function)  | agora |
|------------------------|-------|
| `disparo-templates`    | `listarTemplates()` em `src/app/(sistema)/disparos/actions.ts` |
| `disparo-send`         | `enviarLote()` em `src/lib/disparo/enviarLote.ts` |
| `ycloud-webhook`       | `src/app/api/ycloud-webhook/route.ts` |
| `_shared/ycloud.ts`    | `src/lib/ycloud.ts` |

O desenho em lotes de `disparo-send` foi mantido de propósito, mesmo sem o
limite de tempo que a Edge Function impunha: quem reserva cada lote é
`fv.claim_disparo_batch` com `FOR UPDATE SKIP LOCKED`, então uma queda no meio
não duplica mensagem nem perde a fila.

## Configuração que o app precisa

- `YCLOUD_API_KEY` — obrigatória; sem ela nada envia
- `FV_WABA_ID` — opcional, tem default no código
- `YCLOUD_WEBHOOK_TOKEN` — opcional; se definida, o webhook exige `?token=`

## E no painel da YCloud

A URL do webhook precisa apontar para:

```
https://fevinicius.procexai.tech/api/ycloud-webhook
```

Enquanto estiver apontando para o Supabase Cloud, o envio funciona mas o
**retorno some**: toda mensagem fica parada em "enviado" e a tela de métricas
(`v_disparo_metrics`) não sai do zero.

---

Os arquivos ficam aqui como referência da origem. **Não reimplante.**
