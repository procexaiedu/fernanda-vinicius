// Harness isolado: componentes e Server Actions reais; somente identidade é fixture.
// Não carrega .env da aplicação. Banco REST local descartável, sem produção.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const root = path.resolve(__dirname, '..'), dir = path.join(os.tmpdir(), 'fv-romaneio-w14')
fs.mkdirSync(dir, { recursive: true })
fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true, filter: p => path.basename(p) !== 'proxy.ts' })
const write = (p, s) => { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), {recursive:true}); fs.writeFileSync(f,s) }
write('package.json', JSON.stringify({private:true,scripts:{dev:'next dev --webpack'}}))
write('next.config.js', `module.exports={devIndicators:false,experimental:{cpus:1},typescript:{ignoreBuildErrors:true}}`)
write('tsconfig.json', JSON.stringify({compilerOptions:{target:'ES2017',lib:['dom','esnext'],jsx:'react-jsx',module:'esnext',moduleResolution:'bundler',esModuleInterop:true,resolveJsonModule:true,paths:{'@/*':['./src/*']},plugins:[{name:'next'}]},include:['**/*.ts','**/*.tsx','.next/types/**/*.ts']}))
if (!fs.existsSync(path.join(dir,'node_modules'))) fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'junction')
write('src/app/layout.tsx', `import './globals.css';export default function Layout({children}:any){return <html lang="pt-BR"><body>{children}</body></html>}`)
write('src/app/(sistema)/layout.tsx', `export default function Layout({children}:any){return <main style={{padding:16,maxWidth:1200,margin:'auto'}}><p>AMBIENTE ISOLADO: dados fictícios, identidade de teste. Componentes e ações reais.</p>{children}</main>}`)
write('src/lib/auth.ts', `import {cookies} from 'next/headers'; export type UserProfile=any; export const COOKIE_LOJA='fv_loja'; export async function requireProfile(){const c=await cookies();const role=c.get('fixture_role')?.value||'admin';const store=c.get('fixture_store')?.value;return {id:role==='operator'?'20000000-0000-0000-0000-000000000002':'20000000-0000-0000-0000-000000000001',role,store_id:null,lojaSelecionada:store||null,is_active:true,full_name:'Admin teste'}};export const getProfile=requireProfile;export async function getAuthUser(){return {id:(await requireProfile()).id}};export function lojaDoEscopo(p:any){return p.store_id||p.lojaSelecionada||null};export function ehAdminGlobal(p:any){return p.role==='admin'&&!p.store_id}`)
write('src/lib/supabase/admin.ts', `import {createClient} from '@supabase/supabase-js';export function createAdminClient(){return createClient('http://127.0.0.1:55414','fixture-local-only',{db:{schema:'fv'},global:{fetch:(input,init)=>{const headers=new Headers(init?.headers);headers.delete('authorization');return fetch(String(input).replace('/rest/v1',''),{...init,headers})}}})}`)
write('src/app/fixture/route.ts', `import {NextResponse} from 'next/server';export async function GET(req:Request){const u=new URL(req.url),r=NextResponse.redirect(new URL('/estoque/transferencias',req.url));r.cookies.set('fixture_role',u.searchParams.get('role')||'admin');r.cookies.set('fixture_store',u.searchParams.get('store')||'');return r}`)
console.log(dir)
