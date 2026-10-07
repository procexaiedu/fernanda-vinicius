-- Teste da migration 20261007_receber_duas_remessas_mesma_peca.sql com DADOS FICTÍCIOS.
-- Rodar num banco de TESTE com o schema fv (pg_dump -s), nunca em produção:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261007_receber_duas_remessas_mesma_peca.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261007_receber_duas_remessas_mesma_peca.test.sql
-- Termina em ROLLBACK; qualquer ASSERT que falhe aborta com erro.

BEGIN;

INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000007c1', 'Loja C', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000007b1', 'Loja B', 'B', 'DF');
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000a007');
INSERT INTO fv.users (id, full_name, role, store_id) VALUES
  ('00000000-0000-0000-0000-00000000a007', 'Admin', 'admin', NULL);

-- P1 x3 e P2 x2 em C.
INSERT INTO fv.products (id, code, name, category, material, store_id, cost_price, sale_price, quantity_in_stock, barcode_number, is_active, ownership_type, purchase_month, purchase_year)
VALUES
  ('00000000-0000-0000-0000-0000000007a1', 'X0710', 'Brinco', 'brinco', 'ouro', '00000000-0000-0000-0000-0000000007c1', 10, 30, 3, 'T7-1', true, 'own', 10, 2026),
  ('00000000-0000-0000-0000-0000000007a2', 'X0720', 'Anel',   'anel',   'ouro', '00000000-0000-0000-0000-0000000007c1', 20, 50, 2, 'T7-2', true, 'own', 10, 2026);

DO $$
DECLARE
  C  uuid := '00000000-0000-0000-0000-0000000007c1';
  B  uuid := '00000000-0000-0000-0000-0000000007b1';
  A  uuid := '00000000-0000-0000-0000-00000000a007';
  P1 uuid := '00000000-0000-0000-0000-0000000007a1';
  P2 uuid := '00000000-0000-0000-0000-0000000007a2';
  r json; t1 uuid; t2 uuid;
BEGIN
  -- Duas caixas com a mesma peça: P1 1 + 2 (zera C), P2 1 + 1 (zera C).
  r := fv.enviar_transferencia(C, B, jsonb_build_array(
         jsonb_build_object('product_id', P1, 'quantity', 1),
         jsonb_build_object('product_id', P2, 'quantity', 1)), A, NULL, false, NULL, 'transferencia', NULL);
  ASSERT (r->>'success')::boolean, r::text;
  t1 := (r->>'transfer_id')::uuid;

  r := fv.enviar_transferencia(C, B, jsonb_build_array(
         jsonb_build_object('product_id', P1, 'quantity', 2),
         jsonb_build_object('product_id', P2, 'quantity', 1)), A, NULL, false, NULL, 'transferencia', NULL);
  ASSERT (r->>'success')::boolean, r::text;
  t2 := (r->>'transfer_id')::uuid;

  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P1) = 0;

  -- 1ª caixa chega inteira. Com a outra em trânsito, a linha NÃO muda de loja.
  r := fv.receber_transferencia(t1, jsonb_build_array(
         jsonb_build_object('product_id', P1, 'quantity', 1),
         jsonb_build_object('product_id', P2, 'quantity', 1)), A, NULL);
  ASSERT (r->>'success')::boolean, r::text;
  ASSERT (SELECT store_id FROM fv.products WHERE id = P1) = C, 'linha de P1 não pode sair de C';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE store_id = B AND barcode_number = 'T7-1') = 1;

  -- 2ª caixa: P1 chega 1 de 2 (falta 1), P2 não chega (falta 1). Antes: duplicate key.
  r := fv.receber_transferencia(t2, jsonb_build_array(
         jsonb_build_object('product_id', P1, 'quantity', 1)), A, 'faltou');
  ASSERT (r->>'success')::boolean, r::text;
  ASSERT r->>'status' = 'divergente', r::text;

  -- Destino: soma na linha que nasceu da 1ª caixa. Origem: as faltas voltam para C.
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE store_id = B AND barcode_number = 'T7-1') = 2;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P1) = 1, 'falta de P1 volta para C';
  ASSERT (SELECT store_id FROM fv.products WHERE id = P1) = C;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE store_id = B AND barcode_number = 'T7-2') = 1;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P2) = 1, 'falta de P2 volta para C';

  -- Total fechado: 3 + 2 = 5 peças, em algum lugar.
  ASSERT (SELECT sum(quantity_in_stock) FROM fv.products WHERE barcode_number IN ('T7-1','T7-2')) = 5;

  -- Idempotência: confirmar de novo é recusado.
  r := fv.receber_transferencia(t2, '[]'::jsonb, A, NULL);
  ASSERT NOT (r->>'success')::boolean, r::text;
END $$;

-- Dado legado: linha P1 já em B (como a função antiga deixava), 3ª caixa com 2 em trânsito.
DO $$
DECLARE
  C  uuid := '00000000-0000-0000-0000-0000000007c1';
  B  uuid := '00000000-0000-0000-0000-0000000007b1';
  A  uuid := '00000000-0000-0000-0000-00000000a007';
  P3 uuid := '00000000-0000-0000-0000-0000000007a3';
  t3 uuid := '00000000-0000-0000-0000-0000000007f3';
  r json;
BEGIN
  INSERT INTO fv.products (id, code, name, category, material, store_id, cost_price, sale_price, quantity_in_stock, barcode_number, is_active, ownership_type, purchase_month, purchase_year)
  VALUES (P3, 'X0730', 'Colar', 'colar', 'ouro', B, 30, 90, 1, 'T7-3', true, 'own', 10, 2026);
  INSERT INTO fv.transfers (id, from_store_id, to_store_id, status, sent_by, sent_at)
  VALUES (t3, C, B, 'enviada', A, now());
  INSERT INTO fv.transfer_items (transfer_id, product_id, product_code, product_name, barcode_number, quantity_sent, unit_cost)
  VALUES (t3, P3, 'X0730', 'Colar', 'T7-3', 2, 30);

  -- Chega 1 de 2: soma na própria linha (já em B), falta recria a linha em C.
  r := fv.receber_transferencia(t3, jsonb_build_array(jsonb_build_object('product_id', P3, 'quantity', 1)), A, 'faltou');
  ASSERT (r->>'success')::boolean, r::text;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P3) = 2;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE store_id = C AND barcode_number = 'T7-3') = 1,
    'falta de linha já movida volta para a origem';
END $$;

ROLLBACK;
