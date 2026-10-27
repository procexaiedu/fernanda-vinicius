-- Banco local isolado com schema fv completo e filiais fictícias configuradas.
-- Rodar após a migration. Todos os dados deste cenário terminam em ROLLBACK.
BEGIN;
INSERT INTO auth.users(id) VALUES ('18000000-0000-0000-0000-000000000001');
INSERT INTO fv.users(id,full_name,role) VALUES ('18000000-0000-0000-0000-000000000001','Admin teste','admin');
INSERT INTO auth.users(id) VALUES ('18000000-0000-0000-0000-000000000004'),('18000000-0000-0000-0000-000000000005');
INSERT INTO fv.users(id,full_name,role,store_id)
 SELECT '18000000-0000-0000-0000-000000000004','Admin Campinas teste','admin',id FROM fv.stores WHERE name='Campinas' AND state='SP';
INSERT INTO fv.users(id,full_name,role,store_id)
 SELECT '18000000-0000-0000-0000-000000000005','Admin Brasília teste','admin',id FROM fv.stores WHERE name='Brasília' AND state='DF';
INSERT INTO fv.suppliers(id,name,initials,phones) VALUES ('18000000-0000-0000-0000-000000000002','Fornecedor teste','FT','[]');
INSERT INTO fv.stores(id,name,city,state) VALUES ('18000000-0000-0000-0000-000000000003','Nova filial teste','Teste','SP');

CREATE FUNCTION pg_temp.payload_compra(loja uuid, qtd int DEFAULT 3, consig boolean DEFAULT false, produto uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object(
 'client_request_id',gen_random_uuid(),'user_id','18000000-0000-0000-0000-000000000001',
 'purchase_date','2026-10-27','is_consignment',consig,'fornecedores_novos','[]'::jsonb,
 'linhas',jsonb_build_array(jsonb_build_object(
   'product_id',produto,'supplier_id','18000000-0000-0000-0000-000000000002',
   'store_id',loja,'code','FT1020','name','Peça teste','category','anel','material','prata',
   'cost_price',20,'sale_price',60,'quantity',qtd,'purchase_month',10,'purchase_year',2026)),
 'consignacao',CASE WHEN consig THEN jsonb_build_object('supplier_id','18000000-0000-0000-0000-000000000002',
   'store_id',loja,'return_deadline','2026-12-27','total_pieces',qtd,'total_cost_value',qtd*20) ELSE NULL END,
 'compra',jsonb_build_object('total_cost',qtd*20,'total_items',qtd),
 'pagamentos',CASE WHEN consig THEN '[]'::jsonb ELSE jsonb_build_array(
   jsonb_build_object('supplier_id','18000000-0000-0000-0000-000000000002','payment_method','check',
     'amount',qtd*10,'due_date','2026-11-27','status','pending','installment_number',1,'description','Teste 1/2'),
   jsonb_build_object('supplier_id','18000000-0000-0000-0000-000000000002','payment_method','check',
     'amount',qtd*10,'due_date','2026-12-27','status','pending','installment_number',2,'description','Teste 2/2')) END)
$$;

DO $$
DECLARE
 c uuid := (SELECT id FROM fv.stores WHERE name='Campinas' AND city='Campinas' AND state='SP');
 b uuid := (SELECT id FROM fv.stores WHERE name='Brasília' AND city='Brasília' AND state='DF');
 a uuid := '18000000-0000-0000-0000-000000000001';
 p jsonb; r jsonb; r2 jsonb; rec json; cid uuid; bid uuid; pid uuid; bp uuid; t uuid;
 mixed uuid; z uuid; n int; before_count int; before_stock int; cash numeric;
BEGIN
 ASSERT (SELECT purchase_enters_directly FROM fv.stores WHERE id=c), 'Campinas configurada direta';
 ASSERT NOT (SELECT purchase_enters_directly FROM fv.stores WHERE id=b), 'Brasília exige conferência';
 ASSERT NOT (SELECT purchase_enters_directly FROM fv.stores WHERE id='18000000-0000-0000-0000-000000000003'), 'nova loja exige conferência';
 ASSERT NOT has_function_privilege('authenticated','fv.salvar_compra_conferida(jsonb,boolean)','EXECUTE'), 'RPC não pública';
 ASSERT NOT has_function_privilege('anon','fv.abrir_remessas_do_fornecedor(uuid,uuid,uuid[])','EXECUTE'), 'helper não anônimo';

 -- Campinas: entra direto sem checkbox; parcelas e despesas nascem uma vez.
 p := pg_temp.payload_compra(c);
 r := fv.salvar_compra_conferida(p,false); cid := (r->>'purchase_id')::uuid;
 SELECT product_id INTO pid FROM fv.purchase_items WHERE purchase_id=cid;
 ASSERT (SELECT quantity_in_stock=3 AND is_active FROM fv.products WHERE id=pid), 'Campinas disponível';
 ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id=cid)=0, 'Campinas sem remessa';
 ASSERT (SELECT count(*) FROM fv.purchase_payments WHERE purchase_id=cid)=2, 'duas parcelas';
 ASSERT (SELECT sum(amount) FROM fv.purchase_payments WHERE purchase_id=cid)=60, 'financeiro fecha';
 r2 := fv.salvar_compra_conferida(p,true);
 ASSERT r2->>'purchase_id'=cid::text AND (r2->>'ja_existia')::boolean, 'reenvio mesma compra';
 ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id=pid)=3, 'reenvio não soma';
 ASSERT (SELECT count(*) FROM fv.purchase_payments WHERE purchase_id=cid)=2, 'reenvio não duplica parcelas';
 ASSERT (SELECT count(*) FROM fv.transactions WHERE reference_type='purchase' AND reference_id=cid)=2, 'reenvio não duplica despesas';
 r := fv.salvar_compra_conferida(pg_temp.payload_compra(c,2,false,pid),false);
 ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id=pid)=5, 'reutilização soma somente compra';
 r2 := fv.excluir_compra_conferida((r->>'purchase_id')::uuid,a);
 ASSERT NOT r2 ? 'erro' AND (SELECT quantity_in_stock FROM fv.products WHERE id=pid)=3, 'exclusão direta estorna somente compra';

 -- Brasília: checkbox forjado não libera; só a quantidade recebida fica disponível.
 p := pg_temp.payload_compra(b);
 r := fv.salvar_compra_conferida(p,true); bid := (r->>'purchase_id')::uuid;
 SELECT product_id INTO bp FROM fv.purchase_items WHERE purchase_id=bid;
 SELECT id INTO t FROM fv.transfers WHERE purchase_id=bid;
 ASSERT (SELECT quantity_in_stock=0 AND NOT is_active FROM fv.products WHERE id=bp), 'Brasília indisponível antes de conferir';
 ASSERT (SELECT kind='lote_fornecedor' AND status='enviada' AND from_store_id IS NULL AND to_store_id=b FROM fv.transfers WHERE id=t), 'lote fornecedor correto';
 rec := fv.receber_transferencia(t,jsonb_build_array(jsonb_build_object('product_id',bp,'quantity',2)),a,'Faltou uma peça');
 ASSERT (rec->>'success')::boolean, rec::text;
 ASSERT (SELECT quantity_in_stock=2 AND is_active FROM fv.products WHERE id=bp), 'somente recebidas disponíveis';
 rec := fv.receber_transferencia(t,jsonb_build_array(jsonb_build_object('product_id',bp,'quantity',2)),a,NULL);
 ASSERT NOT (rec->>'success')::boolean AND (SELECT quantity_in_stock FROM fv.products WHERE id=bp)=2, 'reconferência não duplica';
 r2 := fv.decidir_falta_do_lote(t,a,true,true);
 ASSERT (r2->>'success')::boolean, r2::text;
 ASSERT (SELECT sum(amount) FROM fv.purchase_payments WHERE purchase_id=bid)=40, 'falta abate parcela';
 r2 := fv.excluir_compra_conferida(bid,a);
 ASSERT NOT r2 ? 'erro' AND (SELECT quantity_in_stock FROM fv.products WHERE id=bp)=0, 'exclusão estorna somente recebidas';

 -- Saldo preexistente da mesma peça em Brasília continua vendável em nova remessa.
 r := fv.salvar_compra_conferida(pg_temp.payload_compra(b,3,false,bp),false);
 SELECT id INTO t FROM fv.transfers WHERE purchase_id=(r->>'purchase_id')::uuid;
 rec := fv.receber_transferencia(t,jsonb_build_array(jsonb_build_object('product_id',bp,'quantity',3)),a,NULL);
 ASSERT (rec->>'success')::boolean, rec::text;
 r := fv.salvar_compra_conferida(pg_temp.payload_compra(b,2,false,bp),false);
 bid := (r->>'purchase_id')::uuid;
 ASSERT (SELECT quantity_in_stock=3 AND is_active FROM fv.products WHERE id=bp), 'saldo anterior preservado';
 r2 := fv.excluir_compra_conferida(bid,a);
 ASSERT NOT r2 ? 'erro' AND (SELECT quantity_in_stock FROM fv.products WHERE id=bp)=3, 'exclusão em trânsito preserva saldo anterior';

 -- Mista: apenas Brasília vai para remessa, sem lote vazio em Campinas.
 p := pg_temp.payload_compra(c,1);
 p := jsonb_set(p,'{linhas}',(p->'linhas') || (pg_temp.payload_compra(b,1)->'linhas'));
 p := jsonb_set(jsonb_set(p,'{compra,total_items}','2'),'{compra,total_cost}','40');
 p := jsonb_set(p,'{pagamentos}',pg_temp.payload_compra(b,2)->'pagamentos');
 r := fv.salvar_compra_conferida(p,true); mixed := (r->>'purchase_id')::uuid;
 ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id=mixed)=1, 'mista só uma remessa';
 ASSERT (SELECT to_store_id=b FROM fv.transfers WHERE purchase_id=mixed), 'mista só Brasília';
 ASSERT (SELECT sum(pr.quantity_in_stock) FROM fv.purchase_items i JOIN fv.products pr ON pr.id=i.product_id WHERE i.purchase_id=mixed AND pr.store_id=c)=1, 'mista Campinas disponível';
 PERFORM set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id=mixed)=0, 'RLS Campinas não vê lote de Brasília';
 ASSERT (SELECT count(*) FROM fv.transfer_items WHERE transfer_id IN (SELECT id FROM fv.transfers WHERE purchase_id=mixed))=0, 'RLS sem itens de outra filial';
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id=mixed)=1, 'RLS admin destino vê lote';
 RESET ROLE;
 r2 := fv.abrir_remessas_do_fornecedor(mixed,a,ARRAY[]::uuid[]);
 ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id=mixed)=1, 'helper repetido sem novo lote';
 r2 := fv.abrir_remessas_do_fornecedor(cid,a,ARRAY[]::uuid[]);
 ASSERT jsonb_array_length(r2->'remessas')=0, 'array vazio não cria remessa';

 -- Zero recebido, zero disponível, falta integral. Loja nova falha fechada.
 r := fv.salvar_compra_conferida(pg_temp.payload_compra('18000000-0000-0000-0000-000000000003'),true);
 SELECT id INTO t FROM fv.transfers WHERE purchase_id=(r->>'purchase_id')::uuid;
 SELECT product_id INTO z FROM fv.purchase_items WHERE purchase_id=(r->>'purchase_id')::uuid;
 rec := fv.receber_transferencia(t,'[]'::jsonb,a,'Nenhuma peça recebida');
 ASSERT (rec->>'success')::boolean AND (SELECT quantity_in_stock=0 AND NOT is_active FROM fv.products WHERE id=z), 'zero não ativa estoque';

 -- Falha depois de gravar a compra, na abertura da remessa: desfaz tudo.
 SELECT count(*) INTO before_count FROM fv.purchases;
 BEGIN
   p := pg_temp.payload_compra(b);
   p := jsonb_set(p,'{user_id}',to_jsonb('18000000-0000-0000-0000-000000000099'::text));
   PERFORM fv.salvar_compra_conferida(p,false);
   RAISE EXCEPTION 'falha deveria impedir compra';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 ASSERT (SELECT count(*) FROM fv.purchases)=before_count, 'falha não deixa compra parcial';

 -- Compras históricas: simula os dois caminhos antigos e repete após nova política.
 p := pg_temp.payload_compra(c,1);
 r := fv.salvar_compra(p); bid := (r->>'purchase_id')::uuid;
 r2 := fv.abrir_remessas_do_fornecedor(bid,a);
 SELECT id INTO t FROM fv.transfers WHERE purchase_id=bid;
 r := fv.salvar_compra_conferida(p,true);
 ASSERT (r->>'ja_existia')::boolean AND (SELECT status='enviada' FROM fv.transfers WHERE id=t), 'Campinas histórica em trânsito preservada';
 p := pg_temp.payload_compra(b,1);
 r := fv.salvar_compra(p); bid := (r->>'purchase_id')::uuid;
 r := fv.salvar_compra_conferida(p,false);
 ASSERT (r->>'ja_existia')::boolean AND (SELECT count(*) FROM fv.transfers WHERE purchase_id=bid)=0, 'Brasília histórica direta preservada';

 -- Consignações mantêm escolha manual em ambas as filiais e sem financeiro.
 FOREACH t IN ARRAY ARRAY[c,b] LOOP
   FOR n IN 0..1 LOOP
     r := fv.salvar_compra_conferida(pg_temp.payload_compra(t,1,true),n=1);
     bid := (r->>'purchase_id')::uuid;
     ASSERT (SELECT count(*) FROM fv.purchase_payments WHERE purchase_id=bid)=0, 'consignação sem parcela';
     ASSERT (SELECT count(*) FROM fv.transactions WHERE reference_type='purchase' AND reference_id=bid)=0, 'consignação sem despesa';
     ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id=bid)=CASE WHEN n=1 THEN 0 ELSE 1 END, 'consignação fluxo preservado';
   END LOOP;
 END LOOP;
 RAISE NOTICE 'PASS: política, direta, remessa, mista, saldo anterior, reenvio, financeiro, falta, zero, exclusão, rollback e consignação';
END;
$$;
ROLLBACK;
