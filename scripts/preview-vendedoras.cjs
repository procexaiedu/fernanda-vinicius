// Prévia visual com componentes reais e dados FICTÍCIOS, sempre fora do repo.
// Não valida Auth, RLS ou persistência. Não usa .env nem faz conexão com Supabase.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const root = path.resolve(__dirname, '..'), dir = path.join(os.tmpdir(), 'fv-sellers-w6')
fs.mkdirSync(dir,{recursive:true})
fs.cpSync(path.join(root,'src'),path.join(dir,'src'),{recursive:true,filter:p=>path.basename(p)!=='proxy.ts'})
function mock(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){const f=path.join(folder,e.name);if(e.isDirectory()){mock(f);continue}if(!/\.tsx?$/.test(f))continue;const s=fs.readFileSync(f,'utf8');if(!/^['"]use server['"]/.test(s))continue;const names=[...s.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>m[1]);fs.writeFileSync(f,names.map(n=>`export async function ${n}(...args:any[]):Promise<any>{
 if(${JSON.stringify(n)}==='salvarVendedora'){
 const d=args[0],list=JSON.parse(localStorage.getItem('demo-vendedoras')||'[]');
 if(list.some((p:any)=>p.id!==d.id&&p.store_id===d.store_id&&p.full_name.trim().toLowerCase()===d.full_name.trim().toLowerCase()))return {success:false,error:'Nome repetido nesta loja.'};
 const nova={...d,id:d.id||crypto.randomUUID()};localStorage.setItem('demo-vendedoras',JSON.stringify([...list.filter((p:any)=>p.id!==nova.id),nova]));window.dispatchEvent(new Event('demo-vendedoras'));return {success:true};}
 if(${JSON.stringify(n)}==='salvarVenda'||${JSON.stringify(n)}==='editarVenda'){(window as any).__sales=[...((window as any).__sales||[]),args.at(-1)];return {success:true,saleId:'demo'};}
 if(${JSON.stringify(n)}==='buscarCreditoDaCliente')return {saldo:0};return [];
}`).join('\n'))}}
mock(path.join(dir,'src'))
const write=(f,s)=>{fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.writeFileSync(path.join(dir,f),s)}
write('src/app/layout.tsx',`import './globals.css';export default function Layout({children}:any){return <html lang="pt-BR"><body>{children}</body></html>}`)
write('src/app/(sistema)/layout.tsx',`export default function Layout({children}:any){return <main style={{padding:16,maxWidth:1200,margin:'auto'}}><p>PRÉVIA COM DADOS FICTÍCIOS. Sem acesso ao banco ou login real.</p><nav style={{display:'flex',gap:24,marginBottom:24}}><a href="/pdv">PDV</a><a href="/configuracoes/vendedoras">Configurações · Vendedoras</a></nav>{children}</main>}`)
write('src/app/(sistema)/configuracoes/layout.tsx',`import Tabs from './ConfigNavTabs';export default function Layout({children}:any){return <><Tabs daRede />{children}</>}`)
write('src/app/DemoDados.tsx',`'use client'
import {useEffect,useState} from 'react'
export const lojas=[{id:'10000000-0000-0000-0000-000000000001',name:'Loja de teste A',city:'Brasília'},{id:'10000000-0000-0000-0000-000000000002',name:'Loja de teste B',city:'Campinas'}]
const initial=[{id:'60000000-0000-0000-0000-000000000001',full_name:'Pessoa teste A',store_id:lojas[0].id,is_active:true},{id:'60000000-0000-0000-0000-000000000002',full_name:'Pessoa teste B',store_id:lojas[0].id,is_active:true},{id:'60000000-0000-0000-0000-000000000003',full_name:'Pessoa inativa',store_id:lojas[0].id,is_active:false},{id:'60000000-0000-0000-0000-000000000004',full_name:'Pessoa outra loja',store_id:lojas[1].id,is_active:true}]
export function usePessoas(){const [p,setP]=useState(initial);useEffect(()=>{function ler(){const data=localStorage.getItem('demo-vendedoras');if(data)setP(JSON.parse(data));else localStorage.setItem('demo-vendedoras',JSON.stringify(initial))}ler();window.addEventListener('demo-vendedoras',ler);return()=>window.removeEventListener('demo-vendedoras',ler)},[]);return p}
`)
write('src/app/(sistema)/configuracoes/vendedoras/page.tsx',`'use client'
import Client from './VendedorasClient';import Header from '@/components/ui/PageHeader';import {usePessoas,lojas} from '@/app/DemoDados';export default function Page(){return <><Header title="Vendedoras" subtitle="Cadastre quem vende em cada loja. O acesso ao sistema continua em Usuários."/><Client pessoas={usePessoas().filter(p=>p.store_id===lojas[0].id)} lojas={lojas.slice(0,1)}/></>}`)
write('src/app/(sistema)/pdv/page.tsx',`'use client'
import {useState} from 'react';import Form from '@/app/(sistema)/vendas/nova/NovaVendaForm';import {usePessoas,lojas} from '@/app/DemoDados';export default function Page(){const [key,setKey]=useState(0);return <><h1>PDV · Loja de teste A</h1><Form key={key} stores={lojas.slice(0,1)} users={usePessoas().filter(p=>p.is_active&&p.store_id===lojas[0].id).map(p=>({...p,id:'pessoa:'+p.id}))} products={[{id:'30000000-0000-0000-0000-000000000001',name:'Anel de teste',code:'TESTE',barcode_number:'10100',category:'Anel',store_id:lojas[0].id,sale_price:100,promotional_price:null,promotional_active:false,quantity_in_stock:10,is_service:false}]} customers={[]} userProfile={{role:'operator',storeId:lojas[0].id,storeName:lojas[0].name,fullName:'Conta compartilhada',userId:'20000000-0000-0000-0000-000000000003'}} settings={{pixDiscountPct:5,birthdayDiscountPct:10,installmentThreshold:3000,maxInstallmentsDefault:5,maxInstallmentsAbove:6}} onSaved={()=>setKey(v=>v+1)}/></>}`)
write('package.json',JSON.stringify({private:true,scripts:{dev:'next dev --webpack'}}))
write('next.config.js',`module.exports={devIndicators:false,experimental:{cpus:1},typescript:{ignoreBuildErrors:true}}`)
write('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2017',lib:['dom','esnext'],jsx:'react-jsx',module:'esnext',moduleResolution:'bundler',esModuleInterop:true,resolveJsonModule:true,paths:{'@/*':['./src/*']},plugins:[{name:'next'}]},include:['**/*.ts','**/*.tsx','.next/types/**/*.ts']}))
if(!fs.existsSync(path.join(dir,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'junction')
console.log('Prévia fictícia preparada em '+dir)
