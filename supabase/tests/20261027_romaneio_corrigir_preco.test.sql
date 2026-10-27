-- Executar SOMENTE após romaneio.fixture.sql e migration, em DB descartável.
-- A fixture declara explicitamente o schema representativo usado neste teste.
BEGIN;
DELETE FROM fv.romaneio_price_changes;
UPDATE fv.products SET sale_price=2377,promotional_active=false,promotional_price=NULL;
UPDATE fv.transfer_items SET unit_sale_price=2377;
UPDATE fv.transfers SET totals=jsonb_set(totals,'{venda_total}','2377');
CREATE FUNCTION pg_temp.versao() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('transfer_updated_at', t.updated_at, 'product_updated_at', p.updated_at,
 'sale_price',p.sale_price,'promotional_price',p.promotional_price,'promotional_active',p.promotional_active,'unit_sale_price',i.unit_sale_price)
 FROM fv.transfers t JOIN fv.transfer_items i ON i.transfer_id=t.id JOIN fv.products p ON p.id=i.product_id LIMIT 1;
$$;
CREATE FUNCTION pg_temp.corrigir(preco numeric DEFAULT 237, usuario uuid DEFAULT '20000000-0000-0000-0000-000000000001', loja uuid DEFAULT NULL, versao jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT fv.corrigir_preco_romaneio('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',preco,COALESCE(versao,pg_temp.versao()),usuario,loja);
$$;
DO $$
DECLARE r jsonb; antiga jsonb; n int;
BEGIN
 ASSERT NOT has_function_privilege('anon','fv.corrigir_preco_romaneio(uuid,uuid,numeric,jsonb,uuid,uuid)','EXECUTE'), 'anon RPC';
 ASSERT NOT has_function_privilege('authenticated','fv.corrigir_preco_romaneio(uuid,uuid,numeric,jsonb,uuid,uuid)','EXECUTE'), 'authenticated RPC';
 ASSERT NOT has_table_privilege('authenticated','fv.romaneio_price_changes','SELECT'), 'audit privilege';
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='fv.romaneio_price_changes'::regclass), 'RLS audit';
 ASSERT NOT (pg_temp.corrigir(237,'20000000-0000-0000-0000-000000000002')->>'success')::boolean, 'operator';
 ASSERT NOT (pg_temp.corrigir(237,loja=>'10000000-0000-0000-0000-000000000002')->>'success')::boolean, 'store scope';
 UPDATE fv.users SET store_id='10000000-0000-0000-0000-000000000002' WHERE role='admin';
 ASSERT NOT (pg_temp.corrigir()->>'success')::boolean, 'admin wrong fixed store';
 UPDATE fv.users SET store_id=NULL;
 UPDATE fv.users SET is_active=false WHERE role='admin';
 ASSERT NOT (pg_temp.corrigir()->>'success')::boolean, 'inactive';
 UPDATE fv.users SET is_active=true;
 ASSERT NOT (pg_temp.corrigir(0)->>'success')::boolean, 'zero';
 ASSERT NOT (pg_temp.corrigir(-1)->>'success')::boolean, 'negative';
 ASSERT NOT (pg_temp.corrigir(2.377)->>'success')::boolean, 'precision';
 ASSERT NOT (pg_temp.corrigir('NaN')->>'success')::boolean, 'NaN';
 FOREACH n IN ARRAY ARRAY[1,2,3] LOOP
   UPDATE fv.transfers SET status=(ARRAY['recebida','divergente','cancelada'])[n];
   ASSERT NOT (pg_temp.corrigir()->>'success')::boolean, 'closed status';
 END LOOP;
 UPDATE fv.transfers SET status='enviada',kind='transferencia';
 ASSERT NOT (pg_temp.corrigir()->>'success')::boolean, 'kind';
 UPDATE fv.transfers SET kind='lote_fornecedor';
 UPDATE fv.products SET quantity_in_stock=1;
 ASSERT NOT (pg_temp.corrigir()->>'success')::boolean, 'existing stock';
 UPDATE fv.products SET quantity_in_stock=0;
 INSERT INTO fv.sale_items(product_id) SELECT id FROM fv.products;
 ASSERT NOT (pg_temp.corrigir()->>'success')::boolean, 'sale history';
 DELETE FROM fv.sale_items;
 UPDATE fv.products SET barcode_number='outro';
 ASSERT NOT (pg_temp.corrigir()->>'success')::boolean, 'identity';
 UPDATE fv.products SET barcode_number='12724';
 antiga := pg_temp.versao();
 r := pg_temp.corrigir(); ASSERT (r->>'success')::boolean, r::text;
 ASSERT (SELECT sale_price=237 AND cost_price=84 AND quantity_in_stock=0 AND code='FNO108499' AND barcode_number='12724' FROM fv.products), 'product invariant';
 ASSERT (SELECT unit_sale_price=237 AND unit_cost=84 AND quantity_sent=1 FROM fv.transfer_items), 'item invariant';
 ASSERT (SELECT totals->>'venda_total'='237.00' AND totals->>'custo_total'='84' FROM fv.transfers), 'totals';
 ASSERT (SELECT count(*)=0 FROM fv.stock_movements), 'no movements';
 ASSERT (SELECT amount=84 AND status='pending' FROM fv.transactions), 'finance unchanged';
 ASSERT (SELECT count(*)=1 AND min(previous_sale_price)=2377 AND min(sale_price)=237 FROM fv.romaneio_price_changes), 'audit';
 ASSERT NOT (pg_temp.corrigir(250,versao=>antiga)->>'success')::boolean, 'stale version';
 UPDATE fv.products SET promotional_active=true,promotional_price=199;
 r:=pg_temp.corrigir(250); ASSERT (r->>'effective_price')::numeric=199, 'active promo';
 ASSERT (SELECT sale_price=250 AND promotional_active AND promotional_price=199 FROM fv.products), 'promo preserved';
 ASSERT (SELECT unit_sale_price=199 FROM fv.transfer_items), 'effective snapshot';
 UPDATE fv.products SET promotional_price=0;
 ASSERT (pg_temp.corrigir(260)->>'effective_price')::numeric=260, 'zero promo ignored';
 UPDATE fv.products SET promotional_price=190,promotional_active=false;
 ASSERT (pg_temp.corrigir(270)->>'effective_price')::numeric=270, 'inactive promo ignored';
END $$;
-- Falha induzida DEPOIS de produto/item/auditoria: toda a transação deve reverter.
CREATE FUNCTION pg_temp.falhar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha induzida'; END $$;
CREATE TRIGGER teste_falha BEFORE UPDATE ON fv.transfers FOR EACH ROW EXECUTE FUNCTION pg_temp.falhar();
DO $$ DECLARE n int; BEGIN
 SELECT count(*) INTO n FROM fv.romaneio_price_changes;
 BEGIN PERFORM pg_temp.corrigir(300); RAISE EXCEPTION 'falha esperada ausente';
 EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM='falha induzida', SQLERRM; END;
 ASSERT (SELECT sale_price=270 FROM fv.products), 'rollback product';
 ASSERT (SELECT unit_sale_price=270 FROM fv.transfer_items), 'rollback item';
 ASSERT (SELECT count(*)=n FROM fv.romaneio_price_changes), 'rollback audit';
END $$;
ROLLBACK;
\echo 'PASS: preço 2377->237, permissões, estados, promoção, versão, invariantes e rollback'
