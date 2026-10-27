// Banco descartável REPRESENTATIVO. Exige romaneio.fixture.sql já carregada.
// Nunca aponta para uma URL/banco de produção.
import {spawn, execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), container='fv-romaneio-w14-db'
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim()}
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const quoted=v=>`'${String(v).replaceAll("'","''")}'`
const tid='50000000-0000-0000-0000-000000000001', iid='60000000-0000-0000-0000-000000000001', uid='20000000-0000-0000-0000-000000000001', pid='40000000-0000-0000-0000-000000000001'
function reset(){sql(`UPDATE fv.transfers SET status='enviada',received_at=NULL,received_by=NULL,updated_at=clock_timestamp(),totals=jsonb_set(totals,'{venda_total}','2377');UPDATE fv.products SET sale_price=2377,promotional_price=NULL,promotional_active=false,quantity_in_stock=0,is_active=false,updated_at=clock_timestamp();UPDATE fv.transfer_items SET unit_sale_price=2377,quantity_received=NULL,dest_product_id=NULL;DELETE FROM fv.stock_movements;DELETE FROM fv.romaneio_price_changes;`)}
function version(){return sql(`SELECT jsonb_build_object('transfer_updated_at',t.updated_at,'product_updated_at',p.updated_at,'sale_price',p.sale_price,'promotional_price',p.promotional_price,'promotional_active',p.promotional_active,'unit_sale_price',i.unit_sale_price) FROM fv.transfers t JOIN fv.transfer_items i ON i.transfer_id=t.id JOIN fv.products p ON p.id=i.product_id;`)}
const correction=v=>`SELECT fv.corrigir_preco_romaneio('${tid}','${iid}',237,${quoted(v)}::jsonb,'${uid}',NULL);`
const receive=`SELECT fv.receber_transferencia('${tid}','[{"product_id":"${pid}","quantity":1}]'::jsonb,'${uid}',NULL);`
// A primeira sessão mantém as travas enquanto a segunda tenta a operação.
async function race(first, second){
 let output='',errors='';let readyResolve;const ready=new Promise(r=>{readyResolve=r})
 const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'])
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c?reject(new Error(errors)):resolve(output))})
 p.stdout.on('data',b=>{output+=b;if(output.includes('LOCKS_HELD'))readyResolve()});p.stderr.on('data',b=>{errors+=b})
 p.stdin.end(`BEGIN;${first}\n\\echo LOCKS_HELD\nSELECT pg_sleep(2);COMMIT;`)
 await Promise.race([ready,done.then(()=>{throw new Error('No lock barrier')})])
 const other=spawn('docker',['exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1']);let secondOut='',secondErr=''
 const otherDone=new Promise((resolve,reject)=>{other.on('error',reject);other.on('close',c=>c?reject(new Error(secondErr)):resolve(secondOut))})
 other.stdout.on('data',b=>{secondOut+=b});other.stderr.on('data',b=>{secondErr+=b});other.stdin.end(second)
 const a=await done,b=await otherDone;return [a,b]
}
(async()=>{
 sql(read('supabase/migrations/20261027_romaneio_corrigir_preco.sql'))
 sql(read('supabase/tests/20261027_romaneio_corrigir_preco.test.sql'))
 console.log('PASS SQL: permissions, prices, states, promotions, stale version, invariants, rollback')
 // Completa somente as colunas usadas pelo ramo lote_fornecedor do recebimento REAL.
 sql('ALTER TABLE fv.stock_movements ADD COLUMN IF NOT EXISTS quantity_before int, ADD COLUMN IF NOT EXISTS quantity_after int, ADD COLUMN IF NOT EXISTS reason text, ADD COLUMN IF NOT EXISTS ref_type text, ADD COLUMN IF NOT EXISTS ref_id uuid, ADD COLUMN IF NOT EXISTS user_id uuid;')
 sql(read('supabase/migrations/20261007_receber_duas_remessas_mesma_peca.sql'))
 reset();let v=version();let result=await race(correction(v),correction(v));assert.match(result[0],/"success": true/);assert.match(result[1],/"success": false/);assert.equal(sql('SELECT count(*) FROM fv.romaneio_price_changes;'),'1');console.log('PASS concurrent corrections: one audit, stale competitor blocked')
 reset();v=version();result=await race(receive,correction(v));assert.match(result[0],/"success"\s*:\s*true/);assert.match(result[1],/"success": false/);assert.equal(sql('SELECT sale_price FROM fv.products;'),'2377.00');console.log('PASS receiving first: correction blocked after waiting')
 reset();v=version();result=await race(correction(v),receive);assert.match(result[0],/"success": true/);assert.match(result[1],/"success"\s*:\s*true/);assert.equal(sql('SELECT sale_price||\',\'||quantity_in_stock FROM fv.products;'),'237.00,1');assert.equal(sql('SELECT count(*) FROM fv.stock_movements;'),'1');assert.match(sql(receive),/"success"\s*:\s*false/);console.log('PASS correction first: actual receipt adds exactly one unit/movement; replay blocked')
 sql(read('supabase/migrations/20261027_romaneio_corrigir_preco.down.sql'));assert.equal(sql("SELECT to_regprocedure('fv.corrigir_preco_romaneio(uuid,uuid,numeric,jsonb,uuid,uuid)') IS NULL;"),'t');assert.equal(sql('SELECT count(*) FROM fv.romaneio_price_changes;'),'1');sql(read('supabase/migrations/20261027_romaneio_corrigir_preco.sql'));console.log('PASS down/up: function removed/restored, audit retained')
 reset();sql("NOTIFY pgrst, 'reload schema';");console.log('Fixture restored: 12724 / R$2377, ready for UI')
})().catch(e=>{console.error(e);process.exitCode=1})
