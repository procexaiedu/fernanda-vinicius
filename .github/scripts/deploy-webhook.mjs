// Troca o serviço do Swarm para a imagem recém-publicada pelo webhook do Portainer (04/11/2026).
// Substitui o deploy-portainer.mjs (que usava um token de ADMINISTRADOR do Portainer, vazado no ataque de 25/10).
// O webhook só consegue trocar a versão do próprio serviço: não lê variáveis nem mexe em outros serviços.
// O update_config do serviço continua valendo (start-first + rollback): se a versão nova cair, o Swarm volta.
//
// Uso: node deploy-webhook.mjs <serviço> <imagem:tag> [--dry] [outros argumentos antigos são ignorados]
// env PORTAINER_WEBHOOKS = JSON { "<serviço>": { "url": "<webhook>", "conferir": "<https://... opcional>" } }
//   (secret do repositório; só tem os serviços deste repositório)
// --dry: só confere se há webhook para o serviço (não troca nada).
// A tag precisa existir no ghcr.io; se não existir, o Portainer recusa (404) e nada muda.
const [servico, imagem, ...resto] = process.argv.slice(2);
const dry = resto.includes('--dry');
if (!servico || !imagem) { console.error('uso: node deploy-webhook.mjs <serviço> <imagem:tag> [--dry]'); process.exit(2); }
let mapa = {};
try { mapa = JSON.parse(process.env.PORTAINER_WEBHOOKS || '{}'); } catch { console.error('PORTAINER_WEBHOOKS não é um JSON válido'); process.exit(2); }
const alvo = mapa[servico];
if (!alvo?.url) { console.error(`sem webhook para ${servico} no secret PORTAINER_WEBHOOKS`); process.exit(1); }
const tag = imagem.slice(imagem.lastIndexOf(':') + 1);
if (!tag || tag.includes('/')) { console.error(`imagem sem tag: ${imagem}`); process.exit(2); }
if (dry) { console.log(`[ensaio] ${servico} → tag ${tag} (webhook configurado)`); process.exit(0); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// O Portainer às vezes demora (CPU da VPS alta): repete falha de rede ou 5xx até 6 vezes.
let r;
for (let i = 1; i <= 6; i++) {
  try {
    r = await fetch(`${alvo.url}?tag=${encodeURIComponent(tag)}`, { method: 'POST', signal: AbortSignal.timeout(120000) });
    if (r.status < 500) break;
    console.log(`tentativa ${i}: Portainer respondeu ${r.status}`);
  } catch (e) { console.log(`tentativa ${i}: ${e.message}`); }
  await espera(i * 15000);
}
if (!r || !r.ok) { console.error(`webhook falhou: ${r?.status} ${r ? (await r.text()).slice(0, 300) : ''}`); process.exit(1); }
console.log(`Portainer aceitou a troca de ${servico} para a tag ${tag}`);

// Sem acesso de leitura ao Swarm, a conferência é pelo endereço do serviço (quando ele tem um):
// precisa responder sem 5xx 4 vezes seguidas.
if (alvo.conferir) {
  await espera(45000);
  let seguidas = 0;
  for (let i = 0; i < 40 && seguidas < 4; i++) {
    const s = await fetch(alvo.conferir, { redirect: 'manual', signal: AbortSignal.timeout(20000) }).then((x) => x.status).catch(() => 0);
    seguidas = s > 0 && s < 500 ? seguidas + 1 : 0;
    console.log(`conferindo ${alvo.conferir}: ${s || 'sem resposta'}`);
    await espera(15000);
  }
  if (seguidas < 4) { console.error('o serviço não ficou de pé depois da troca (o Swarm deve ter voltado para a versão anterior)'); process.exit(1); }
  console.log('serviço respondendo');
}
