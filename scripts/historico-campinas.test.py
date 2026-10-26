"""Ensaio sintético, somente Docker local. Nunca recebe conexão de produção."""
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'fv-w10-historico-test'
UP = (ROOT / 'supabase/migrations/20261026000001_historico_vendedoras_campinas.sql').read_text(encoding='utf-8')
DOWN = (ROOT / 'supabase/migrations/20261026000001_historico_vendedoras_campinas.down.sql').read_text(encoding='utf-8')
STORE = '7d992017-5eda-4f26-8855-2663bbef843b'
ROSI = '456a2633-a6bd-4c85-aadd-ee379696bc18'
FER = 'f5a59aab-8409-4a52-a6f4-e5dff887f7b5'
PERSON = '3d27830e-5cc3-45b5-b877-40397d222257'

def sql(source, ok=True, message=None):
    p = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off'], input=source, text=True, encoding='utf-8', capture_output=True)
    if (p.returncode == 0) != ok or (message and message not in p.stderr):
        raise AssertionError(p.stdout + p.stderr)
    return p.stdout

def apply(source):
    return sql('BEGIN;\n' + source + '\nCOMMIT;')

def assertion(condition):
    sql("DO $$ BEGIN IF NOT (" + condition + ") THEN RAISE EXCEPTION 'ASSERT falhou'; END IF; END $$;")

def state():
    return sql("SELECT md5(string_agg(j,'|' ORDER BY j)) FROM (" + ' UNION ALL '.join("SELECT to_jsonb(t)::text j FROM fv." + table + " t" for table in ['sales','sale_items','sale_payments','products','transactions','seller_goals']) + ") a;")

label = subprocess.run(['docker','inspect','--format','{{index .Config.Labels "maestro.task"}}',CONTAINER],text=True,capture_output=True,check=True).stdout.strip()
if label != 'w10-mvpu56cb':
    raise RuntimeError('Container sem rotulo de isolamento esperado; nenhuma limpeza permitida')
for _ in range(30):
    p = subprocess.run(['docker','exec',CONTAINER,'pg_isready','-U','postgres'], capture_output=True)
    if p.returncode == 0: break
    time.sleep(1)
else: raise RuntimeError('Postgres local indisponivel')

sql('DROP SCHEMA IF EXISTS fv_historico CASCADE; DROP SCHEMA IF EXISTS fv CASCADE; DROP SCHEMA IF EXISTS auth CASCADE;')
for file in ['supabase/tests/sellers_local/bootstrap.sql','supabase/migrations/20261001_venda_transacional.sql','supabase/migrations/20261026_cadastro_vendedoras.sql']:
    sql((ROOT/file).read_text(encoding='utf-8'))
sql(f"""
INSERT INTO fv.stores(id,name) VALUES('{STORE}','Campinas sintetica');
INSERT INTO fv.users(id,full_name,store_id,is_active,role) VALUES
('{ROSI}','Rosi','{STORE}',true,'operator'),('{FER}','Fernanda',null,true,'admin'),
('3d0828ce-9013-4e98-8482-9f87ebd21b0a','Conta sintetica',null,true,'admin');
INSERT INTO fv.sellers(id,full_name,store_id) VALUES
('{PERSON}','Rosi','{STORE}'),('43b48878-a1e4-46a7-9011-350afe0ee6ad','Fernanda','{STORE}');
INSERT INTO fv.sales(id,store_id,user_id,seller_id,total,status,sale_date,notes)
SELECT md5('rosi-fixture-'||g)::uuid,'{STORE}','{FER}','{ROSI}',CASE WHEN g=105 THEN 526.62 ELSE 500 END,'completed','2026-09-10 12:00-03','FICTICIO' FROM generate_series(1,105) g;
INSERT INTO fv.sales(id,store_id,user_id,seller_id,total,status,sale_date,notes)
SELECT md5('fer-fixture-'||g)::uuid,'{STORE}','{FER}','{FER}',CASE WHEN g=26 THEN 1544 ELSE 500 END,'completed','2026-09-10 12:00-03','FICTICIO' FROM generate_series(1,26) g;
INSERT INTO fv.sales(id,store_id,user_id,seller_id,total,status) VALUES
('60000000-0000-0000-0000-000000000001','{STORE}','3d0828ce-9013-4e98-8482-9f87ebd21b0a','3d0828ce-9013-4e98-8482-9f87ebd21b0a',164,'completed');
INSERT INTO fv.sale_payments(sale_id,payment_method,amount) VALUES(md5('rosi-fixture-1')::uuid,'pix',500);
INSERT INTO fv.sale_items(sale_id,product_id,quantity,unit_price,subtotal) VALUES(md5('rosi-fixture-1')::uuid,'30000000-0000-0000-0000-000000000001',1,500,500);
INSERT INTO fv.transactions(store_id,reference_type,reference_id,amount,status) VALUES('{STORE}','sale',md5('rosi-fixture-1')::uuid,500,'completed');
""")
baseline = state()
apply(UP)
assertion("(SELECT count(*)=131 AND sum((antes->>'total')::numeric)=66570.62 FROM fv_historico.campinas_20261026000001)")
after = state()
apply(UP)
assert state() == after
print('PASS up e reaplicacao idempotente; 131 vendas/66570.62')
assertion("(SELECT relrowsecurity FROM pg_class WHERE oid='fv_historico.campinas_20261026000001'::regclass) AND NOT has_schema_privilege('anon','fv_historico','USAGE') AND NOT has_schema_privilege('authenticated','fv_historico','USAGE') AND NOT has_table_privilege('anon','fv_historico.campinas_20261026000001','SELECT') AND NOT has_table_privilege('authenticated','fv_historico.campinas_20261026000001','SELECT')")
print('PASS snapshot RLS e sem acesso anon/authenticated')
for role in ['anon','authenticated']:
    sql('BEGIN; SET LOCAL ROLE '+role+'; SELECT * FROM fv_historico.campinas_20261026000001;',False,'permission denied')
print('PASS acesso real anon/authenticated recusado')
sql('BEGIN; SET LOCAL ROLE authenticated;'+DOWN,False,'permission denied')
print('PASS down sem privilegio recusado')
sql("BEGIN; UPDATE fv.sales SET notes='EDITADA' WHERE id=md5('rosi-fixture-1')::uuid;" + DOWN, False, 'venda alterada')
assert state() == after
sql('BEGIN; DELETE FROM fv_historico.campinas_20261026000001 WHERE sale_id=md5(\'rosi-fixture-1\')::uuid;'+DOWN,False,'snapshot ausente/incompleto')
sql("BEGIN; UPDATE fv_historico.campinas_20261026000001 SET depois=depois || '{\"total\":0}'::jsonb WHERE sale_id=md5('rosi-fixture-1')::uuid;"+DOWN,False,'conteudo do snapshot divergente')
print('PASS down recusa snapshot incompleto/adulterado')
sql("BEGIN;" + DOWN.replace('get diagnostics n = row_count;', "raise exception 'FALHA INJETADA';"), False, 'FALHA INJETADA')
assert state() == after
assertion("(SELECT tgenabled='O' FROM pg_trigger WHERE tgrelid='fv.sales'::regclass AND tgname='sales_check_seller')")
print('PASS down recusa edicao posterior; falha intermediaria restaura dados e trigger')
apply(DOWN)
assert state() == baseline
apply(DOWN)
assert state() == baseline
print('PASS down e down repetido; todas tabelas identicas, incluindo ProceX164 e loja vizinha')
sql("BEGIN; CREATE FUNCTION fv.test_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$; CREATE TRIGGER test_touch BEFORE UPDATE ON fv.sales FOR EACH ROW EXECUTE FUNCTION fv.test_touch();"+UP,False,'resultado divergente')
assert state() == baseline
print('PASS trigger adicional updated_at mantido ativo: efeito inesperado aborta UP')
for label, mutation in [
    ('valor', "UPDATE fv.sales SET total=total+1 WHERE id=md5('rosi-fixture-1')::uuid;"),
    ('status', "UPDATE fv.sales SET status='cancelled' WHERE id=md5('rosi-fixture-1')::uuid;"),
    ('pessoa inativa', f"UPDATE fv.sellers SET is_active=false WHERE id='{PERSON}';"),
    ('loja pessoa', f"ALTER TABLE fv.sellers DISABLE TRIGGER sellers_store_immutable; UPDATE fv.sellers SET store_id='10000000-0000-0000-0000-000000000001' WHERE id='{PERSON}';"),
    ('comissao', f"INSERT INTO fv.transactions(store_id,reference_type,amount,status) VALUES('{STORE}','seller_commission',1,'completed');"),
    ('meta', f"INSERT INTO fv.seller_goals(user_id,target_amount,commission_pct) VALUES('{ROSI}',100,3);"),
    ('contagem', f"INSERT INTO fv.sales(store_id,user_id,seller_id,total,status) VALUES('{STORE}','{FER}','{ROSI}',0,'completed');"),
]:
    sql('BEGIN;'+mutation+UP, False, 'GUARDA:')
    assert state() == baseline
    print('PASS guarda '+label)
apply(UP)
sql("BEGIN; UPDATE fv.sales SET notes='EDITADA' WHERE id=md5('rosi-fixture-1')::uuid;"+UP, False, 'GUARDA:')
assert state() == after
print('PASS up recusa estado posterior divergente')
apply(DOWN)
assert state() == baseline
apply(UP)
assert state() == after
print('PASS ciclo completo up/down/up, sem regenerar comissoes/metas')
