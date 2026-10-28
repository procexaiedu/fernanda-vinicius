// Troca o serviço do Swarm para a imagem recém-publicada no ghcr.io (chamado pelo deploy.yml depois do build).
// Mesmo script do iprado-mcp/DevContext (procexaiedu/devcontext-v2), com um passo a mais: o serviço vinha do "git clone + build
// no boot" (node:xx-alpine com um `sh -c` enorme). A imagem já traz o CMD e a pasta certos, então o comando, os
// argumentos e a pasta antigos do serviço saem — senão o container novo repetiria o clone e o build.
// O update_config do serviço vale (start-first/stop-first + rollback/pause).
// Uso: node deploy-portainer.mjs <serviço> <imagem:tag>   (env PORTAINER_TOKEN)
const [servico, imagem] = process.argv.slice(2);
const B = 'https://portainer.procexai.tech/api/endpoints/1/docker';
const H = { 'X-API-Key': process.env.PORTAINER_TOKEN, 'Content-Type': 'application/json' };
const REGISTRO = Buffer.from(JSON.stringify({ registryId: 2 })).toString('base64'); // "GHCR - procexaiedu" no Portainer

const s = await (await fetch(`${B}/services/${servico}`, { headers: H })).json();
if (!s.Spec) throw new Error(`serviço ${servico} não encontrado: ${JSON.stringify(s).slice(0, 200)}`);
const c = s.Spec.TaskTemplate.ContainerSpec;
c.Image = imagem;
delete c.Command;
delete c.Args;
delete c.Dir;
// o token do GitHub só servia para o clone no boot; com a imagem pronta ele sai do serviço
c.Env = (c.Env || []).filter((e) => !/^(GITHUB_PAT|GIT_TOKEN|GITHUB_TOKEN)=/.test(e));
// se a versão nova não passar, o Swarm volta sozinho para a anterior (em vez de pausar com o serviço parado)
s.Spec.UpdateConfig = { Parallelism: 1, Order: 'stop-first', Monitor: 30e9, MaxFailureRatio: 0, ...s.Spec.UpdateConfig, FailureAction: 'rollback' };
s.Spec.TaskTemplate.ForceUpdate = (s.Spec.TaskTemplate.ForceUpdate || 0) + 1;
const r = await fetch(`${B}/services/${s.ID}/update?version=${s.Version.Index}`, {
  method: 'POST', headers: { ...H, 'X-Registry-Auth': REGISTRO }, body: JSON.stringify(s.Spec),
});
if (!r.ok) throw new Error(`update ${r.status}: ${(await r.text()).slice(0, 300)}`);
console.log(`${servico} → ${imagem}: atualização enviada`);

// espera o Swarm terminar (ou desfazer) a troca
for (let i = 0; i < 90; i++) {
  await new Promise((ok) => setTimeout(ok, 10000));
  const u = (await (await fetch(`${B}/services/${s.ID}`, { headers: H })).json()).UpdateStatus;
  console.log(`  ${u?.State ?? '?'} ${u?.Message ?? ''}`);
  if (u?.State === 'completed') process.exit(0);
  if (/rollback|paused/.test(u?.State ?? '')) throw new Error(`a troca não passou e o serviço parou/voltou: ${u.Message}`);
}
throw new Error('a troca não terminou em 15 minutos');
