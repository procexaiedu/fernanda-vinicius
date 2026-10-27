// Somente container local de testes. Não usa .env nem credenciais da aplicação.
// Pré-requisito: clone fv completo, com filiais fictícias Campinas/SP e Brasília/DF.
// node scripts/compras-filial-db.test.mjs fv-compras-w18-db
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
const container = process.argv[2]
if (!container || !/^fv-[a-z0-9-]*(?:test|w18)[a-z0-9-]*-db$/.test(container)) throw Error('Exige container local de testes explícito')
const sql = text => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
const read = f => fs.readFileSync(f, 'utf8')
const up = read('supabase/migrations/20261027_compra_por_filial.sql')
const down = read('supabase/migrations/20261027_compra_por_filial.down.sql')
const test = read('supabase/tests/20261027_compra_por_filial.test.sql')
const c = sql("SELECT id FROM fv.stores WHERE name='Campinas' AND city='Campinas' AND state='SP';")
const b = sql("SELECT id FROM fv.stores WHERE name='Brasília' AND city='Brasília' AND state='DF';")
assert.match(c, /^[a-f0-9-]{36}$/)
assert.match(b, /^[a-f0-9-]{36}$/)
const configure = `SET fv.compra_direta_campinas_id='${c}';\n`
const snapshot = () => sql(`SELECT tablename||':'||md5(coalesce(string_agg(row_to_json(p)::text,',' ORDER BY policyname),'')) FROM pg_policies p WHERE schemaname='fv' GROUP BY tablename ORDER BY tablename;`)
const policies = snapshot()
// Reverter só esta mudança num clone descartável, para provar o antes.
sql(down)
sql(read('supabase/tests/20261012_compra_entra_na_conferencia.test.sql'))
console.log('PASS baseline: suíte anterior, incluindo RLS, financeiro, faltas e consignação')
for (const setup of ['', `SET fv.compra_direta_campinas_id='${b}';\n`]) {
  assert.throws(() => sql(setup + up))
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='fv' AND table_name='stores' AND column_name='purchase_enters_directly';"), '0')
}
console.log('PASS migration: sem confirmação ou com ID de Brasília, aborta sem criar coluna')
// O payload usa só dados fictícios criados dentro da transação de teste.
const helper = test.slice(test.indexOf('CREATE FUNCTION pg_temp.payload_compra'), test.indexOf('\nDO $$'))
const seed = test.slice(test.indexOf('INSERT INTO auth.users'), test.indexOf('CREATE FUNCTION pg_temp.payload_compra'))
const probe = expected => `BEGIN;${seed}${helper}
DO $$ DECLARE r jsonb; pid uuid; BEGIN
r:=fv.salvar_compra_conferida(pg_temp.payload_compra('${c}'),false); pid:=(r->>'purchase_id')::uuid;
ASSERT (SELECT sum(pr.quantity_in_stock) FROM fv.purchase_items i JOIN fv.products pr ON pr.id=i.product_id WHERE i.purchase_id=pid)=${expected ? 3 : 0};
ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id=pid)=${expected ? 0 : 1}; END $$; ROLLBACK;`
sql(probe(false))
sql(configure + up)
sql(configure + up)
sql(probe(true))
sql(test)
assert.equal(snapshot(), policies)
console.log('PASS antes/depois: Campinas 0→3 disponíveis, remessas 1→0; políticas RLS idênticas')

// Duas conexões concorrentes com o mesmo pedido, usando cadastros fictícios do clone.
const user = sql("SELECT id FROM fv.users WHERE role='admin' AND store_id IS NULL AND is_active ORDER BY id LIMIT 1;")
const supplier = sql('SELECT id FROM fv.suppliers ORDER BY id LIMIT 1;')
const request = sql('SELECT gen_random_uuid();')
const payload = { client_request_id: request, user_id: user, purchase_date: '2026-10-27', is_consignment: false,
  fornecedores_novos: [], linhas: [{ product_id: null, supplier_id: supplier, store_id: c, code: 'W18TEST', name: 'Concorrência teste', category: 'anel', material: 'prata', cost_price: 20, sale_price: 60, quantity: 1, purchase_month: 10, purchase_year: 2026 }],
  compra: { total_cost: 20, total_items: 1 }, pagamentos: [{ supplier_id: supplier, payment_method: 'pix', amount: 20, due_date: '2026-10-27', status: 'completed', description: 'Teste concorrência' }] }
const save = `SELECT fv.salvar_compra_conferida('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb,false);`
function run(input, barrier) {
  const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'])
  let out = '', err = ''
  p.stdout.on('data', chunk => { out += chunk; if (out.includes('LOCK_HELD')) barrier?.() })
  p.stderr.on('data', chunk => { err += chunk })
  const done = new Promise((resolve, reject) => { p.on('error', reject); p.on('close', code => code ? reject(Error(err)) : resolve(out)) })
  p.stdin.end(input)
  return done
}
let readyResolve
const ready = new Promise(resolve => { readyResolve = resolve })
try {
  const first = run(`BEGIN;${save}\n\\echo LOCK_HELD\nSELECT pg_sleep(1);COMMIT;`, readyResolve)
  await Promise.race([ready, first.then(() => { throw Error('Sem barreira de concorrência') })])
  const results = await Promise.all([first, run(save)])
  assert.match(results.join(''), /"ja_existia": true/)
  assert.equal(sql(`SELECT count(*) FROM fv.purchases WHERE client_request_id='${request}';`), '1')
  assert.equal(sql(`SELECT sum(pr.quantity_in_stock) FROM fv.products pr JOIN fv.purchase_items i ON i.product_id=pr.id JOIN fv.purchases p ON p.id=i.purchase_id WHERE p.client_request_id='${request}';`), '1')
  assert.equal(sql(`SELECT count(*) FROM fv.transactions t JOIN fv.purchases p ON p.id=t.reference_id WHERE p.client_request_id='${request}' AND t.reference_type='purchase';`), '1')
  console.log('PASS concorrência real: 2 sessões, 1 compra, 1 unidade, 1 despesa')
} finally {
  sql(`SELECT fv.excluir_compra_conferida(id,'${user}') FROM fv.purchases WHERE client_request_id='${request}';`)
}
sql(down)
assert.equal(snapshot(), policies)
sql(configure + up)
sql(test)
console.log('PASS down/up e reaplicação; nenhuma política RLS alterada; clone pronto para preview')
