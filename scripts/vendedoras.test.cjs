// Fonte real com adaptadores de Auth/DB controlados. SQL/RPC/RLS têm suíte separada.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
let perfil = { role: 'admin', is_active: true, store_id: '10000000-0000-0000-0000-000000000001' }
let chamadas = [], gravacoes = [], pessoa = { id: '60000000-0000-0000-0000-000000000001', store_id: perfil.store_id, is_active: true }, erroGravar = null
const loja = perfil.store_id
function query(table) {
  let dados = [], operacao = 'read', filtros = []
  const q = { select(){return q}, order(){return q}, eq(k,v){filtros.push([k,v]);return q}, or(v){filtros.push(['or',v]);return q}, single(){return q}, maybeSingle(){return q},
    insert(v){operacao='write';dados=v;return q},update(v){operacao='write';dados=v;return q},
    then(ok,bad){chamadas.push({table,operacao,filtros}); if(operacao==='write'){gravacoes.push(dados);return Promise.resolve({error:erroGravar}).then(ok,bad)}
      const data=table==='stores'?{id:loja}:table==='sellers'?pessoa:[]
      return Promise.resolve({data,error:null}).then(ok,bad)} }
  return q
}
const admin = {from:query}
const mocks = {
  'server-only': {}, 'next/cache': {revalidatePath(){}}, 'next/navigation': {redirect(to){throw new Error('REDIRECT:'+to)}},
  '@/lib/auth': {getProfile:async()=>perfil,requireProfile:async()=>perfil,lojaDoEscopo:p=>p.store_id},
  '@/lib/supabase/admin': {createAdminClient:()=>admin},
}
function load(name, extra='') {
  const file = path.join(root, name)
  const source = fs.readFileSync(file,'utf8')
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const mod = {exports:{}}
  const req = id => id in mocks ? mocks[id] : id.startsWith('@/') ? load('src/'+id.slice(2)+'.ts') : id.startsWith('.') ? load(path.relative(root,path.resolve(path.dirname(file),id))+'.ts') : require(id)
  vm.runInThisContext('(function(require,module,exports){'+js+'\n'+extra+'\n})',{filename:file})(req,mod,mod.exports)
  return mod.exports
}
async function main() {
  const {salvarVendedora} = load('src/app/(sistema)/configuracoes/vendedoras/actions.ts')
  const dados = {full_name:' Pessoa   Teste ',store_id:loja,is_active:true}
  for(const p of [null,{...perfil,role:'operator'},{...perfil,is_active:false}]) {
    perfil=p; const n=chamadas.length; assert.equal((await salvarVendedora(dados)).success,false); assert.equal(chamadas.length,n)
  }
  console.log('PASS: servidor bloqueia anonima, operadora e admin inativa antes de consultar/gravar')
  perfil={role:'admin',is_active:true,store_id:loja}
  assert.equal((await salvarVendedora({...dados,store_id:'10000000-0000-0000-0000-000000000002'})).success,false)
  assert.equal((await salvarVendedora({...dados,full_name:'  '})).success,false)
  assert.equal((await salvarVendedora({...dados,store_id:'invalida'})).success,false)
  assert.equal((await salvarVendedora(dados)).success,true)
  assert.equal(gravacoes.at(-1).full_name,'Pessoa Teste')
  erroGravar={code:'23505'};assert.equal((await salvarVendedora(dados)).success,false);erroGravar=null
  console.log('PASS: loja, nome, UUID e duplicidade validados no cadastro')
  const {conferirVendedora} = load('src/app/(sistema)/vendas/actions.ts','exports.conferirVendedora=conferirVendedora;')
  const chave='pessoa:'+pessoa.id
  for(const id of [null,'','20000000-0000-0000-0000-000000000001']) assert(await conferirVendedora(admin,loja,{sellerId:id},'operator'))
  assert.equal(await conferirVendedora(admin,loja,{sellerId:chave},'operator'),null)
  assert(chamadas.at(-1).filtros.some(([k,v])=>k==='store_id'&&v===loja))
  pessoa={...pessoa,is_active:false};assert(await conferirVendedora(admin,loja,{sellerId:chave},'operator'))
  const original={seller_id:null,seller_person_id:pessoa.id,store_id:loja}
  const data={sellerId:'pessoa:outra'};assert.equal(await conferirVendedora(admin,loja,data,'operator',original),null);assert.equal(data.sellerId,chave)
  assert.equal(await conferirVendedora(admin,loja,{sellerId:'20000000-0000-0000-0000-000000000001'},'admin',{seller_id:'20000000-0000-0000-0000-000000000001',seller_person_id:null,store_id:loja}),null)
  console.log('PASS: nova venda exige pessoa; edicao conserva inativa/legado e impede reatribuicao pela operadora')
  const {diretorioVendedoras}=load('src/lib/vendedoras-server.ts');pessoa=[];await diretorioVendedoras()
  const ultimas=chamadas.slice(-2);assert(ultimas[0].filtros.some(([k,v])=>k==='store_id'&&v===loja));assert(ultimas[1].filtros.some(([k,v])=>k==='or'&&v.includes(loja)))
  console.log('PASS: diretorio aplica escopo em ambas consultas service_role')
  const {chaveVendedora}=load('src/lib/vendedoras.ts');const {apurarMes,lerConfigMetaLoja}=load('src/lib/metas/loja.ts')
  const resultado=apurarMes([{id:'1',seller_id:chaveVendedora({seller_person_id:'x'}),total:100},{id:'2',seller_id:'x',total:50},{id:'3',seller_id:null,total:0}],new Map(),new Map(),lerConfigMetaLoja(null),'2026-10','2026-10-26')
  assert.equal(resultado.porVendedora.length,2);assert.equal(resultado.progresso.realizado,150)
  console.log('PASS: ranking/comissao separa pessoa e conta legada, inclusive total zero')
  mocks['@/components/ui/PageHeader']={default:()=>null};mocks['./VendedorasClient']={default:()=>null}
  perfil={...perfil,role:'operator'}
  const pagina=load('src/app/(sistema)/configuracoes/vendedoras/page.tsx').default
  const antes=chamadas.length;await assert.rejects(pagina(),/REDIRECT:\/pdv/);assert.equal(chamadas.length,antes)
  console.log('PASS: rota propria bloqueia operadora antes de ler cadastros')
  perfil={...perfil,role:'admin'}
  mocks['@/lib/auth'].ehAdmin=p=>p.role==='admin'
  let devidas=[{sellerId:'pessoa:nova',comissao:3,pct:3},{sellerId:'legada',comissao:2,pct:3}]
  mocks['@/lib/metas/lojaServer']={apurarLoja:async()=>({porVendedora:devidas})}
  mocks['@/lib/vendedoras-server']={diretorioVendedoras:async()=>[{id:'pessoa:nova',full_name:'Pessoa teste'},{id:'legada',full_name:'Conta legada'}]}
  const tx=[{id:'paga',user_id:'legada',seller_person_id:null,status:'completed',amount:99}]
  const mutations=[]
  admin.from=table=>{assert.equal(table,'transactions');let op='read',v,filter;const q={select(){return q},eq(k,val){if(k==='id')filter=val;return q},insert(data){op='insert';v=data;return q},update(data){op='update';v=data;return q},delete(){op='delete';return q},then(ok,bad){if(op==='read')return Promise.resolve({data:tx,error:null}).then(ok,bad);mutations.push({op,id:filter,v});if(op==='insert')tx.push({id:'nova',...v});if(op==='update')Object.assign(tx.find(t=>t.id===filter),v);if(op==='delete')tx.splice(tx.findIndex(t=>t.id===filter),1);return Promise.resolve({error:null}).then(ok,bad)}};return q}
  const {gerarComissoesDoMes}=load('src/app/(sistema)/configuracoes/metas/actions.ts')
  assert.equal((await gerarComissoesDoMes('2026-10')).success,true)
  assert.equal(tx.length,2);assert.equal(tx.find(t=>t.id==='nova').seller_person_id,'nova');assert.equal(tx.find(t=>t.id==='nova').user_id,null)
  assert.equal((await gerarComissoesDoMes('2026-10')).success,true);assert.equal(tx.length,2)
  devidas=[];assert.equal((await gerarComissoesDoMes('2026-10')).success,true);assert.equal(tx.length,1)
  assert.equal(tx[0].id,'paga');assert.equal(tx[0].amount,99);assert(!mutations.some(m=>m.id==='paga'))
  console.log('PASS: gerar comissoes nova/repetida/zero mantem separacao, sem duplicar, preservando paga de 99')
}
main().catch(e=>{console.error(e);process.exitCode=1})
