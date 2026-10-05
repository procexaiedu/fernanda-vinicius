-- Teste da migration 20261005_transferencia_duas_pontas.sql com DADOS FICTÍCIOS.
-- Rodar num banco de TESTE com o schema fv (pg_dump -s), nunca em produção:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261005_transferencia_duas_pontas.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261005_transferencia_duas_pontas.test.sql
-- Termina em ROLLBACK; qualquer ASSERT que falhe aborta com erro.

BEGIN;

INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Loja C', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000000b1', 'Loja B', 'B', 'DF');
-- fv.users.id referencia auth.users (no banco de teste, auth.users mínimo com só `id`).
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-00000000aaaa'), ('00000000-0000-0000-0000-00000000bbbb');
INSERT INTO fv.users (id, full_name, role, store_id) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', 'Admin', 'admin', NULL),
  ('00000000-0000-0000-0000-00000000bbbb', 'Op B', 'operator', '00000000-0000-0000-0000-0000000000b1');

-- Peças em C: P1 x3 (custo 10, venda 30), P2 x2 (custo 20, venda 50)
INSERT INTO fv.products (id, code, name, category, material, store_id, cost_price, sale_price, quantity_in_stock, barcode_number, is_active, ownership_type, purchase_month, purchase_year)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'X0910', 'Colar', 'colar', 'ouro', '00000000-0000-0000-0000-0000000000c1', 10, 30, 3, 'T-1', true, 'own', 10, 2026),
  ('00000000-0000-0000-0000-0000000000a2', 'X0920', 'Brinco', 'brinco', 'ouro', '00000000-0000-0000-0000-0000000000c1', 20, 50, 2, 'T-2', true, 'own', 10, 2026);

DO $$
DECLARE
  C  uuid := '00000000-0000-0000-0000-0000000000c1';
  B  uuid := '00000000-0000-0000-0000-0000000000b1';
  A  uuid := '00000000-0000-0000-0000-00000000aaaa';
  OB uuid := '00000000-0000-0000-0000-00000000bbbb';
  P1 uuid := '00000000-0000-0000-0000-0000000000a1';
  P2 uuid := '00000000-0000-0000-0000-0000000000a2';
  r json; rj jsonb; ida uuid; volta uuid; dest1 uuid;
BEGIN
  -- 1. Consignação C→B nasce EM TRÂNSITO: sai de C, não entra em B
  r := fv.enviar_transferencia(C, B, jsonb_build_array(
         jsonb_build_object('product_id', P1, 'quantity', 3),
         jsonb_build_object('product_id', P2, 'quantity', 2)), A, NULL, false, NULL, 'consignacao', NULL);
  ASSERT (r->>'success')::boolean, r::text;
  ida := (r->>'transfer_id')::uuid;
  ASSERT (SELECT status = 'enviada' AND kind = 'consignacao' FROM fv.transfers WHERE id = ida), 'ida em trânsito';
  ASSERT (SELECT COALESCE(sum(quantity_in_stock), 0) FROM fv.products WHERE store_id = B) = 0, 'nada em B antes de conferir';
  ASSERT (SELECT sum(quantity_in_stock) FROM fv.products WHERE store_id = C) = 0, 'saiu de C';

  rj := fv.acerto_consignacao_loja(ida, A);
  ASSERT NOT (rj->>'success')::boolean, 'acerto antes da conferência';

  -- 2. B confere: P1 chegou 3, P2 só 1 (falta 1 volta para C)
  r := fv.receber_transferencia(ida, jsonb_build_array(
         jsonb_build_object('product_id', P1, 'quantity', 3),
         jsonb_build_object('product_id', P2, 'quantity', 1)), OB, 'faltou 1 brinco');
  ASSERT r->>'status' = 'divergente', r::text;
  ASSERT (SELECT sum(quantity_in_stock) FROM fv.products WHERE store_id = B) = 4, 'B recebeu 4';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P2) = 1, 'falta voltou para C';
  SELECT dest_product_id INTO dest1 FROM fv.transfer_items WHERE transfer_id = ida AND product_id = P1;

  -- 3. Devolução B→C de 1 colar
  r := fv.enviar_transferencia(B, C, jsonb_build_array(jsonb_build_object('product_id', dest1, 'quantity', 1)),
         A, NULL, false, NULL, 'devolucao_consignacao', ida);
  ASSERT (r->>'success')::boolean, r::text;
  volta := (r->>'transfer_id')::uuid;

  rj := fv.acerto_consignacao_loja(ida, A);
  ASSERT NOT (rj->>'success')::boolean, 'acerto com devolução em trânsito';

  r := fv.receber_transferencia(volta, jsonb_build_array(jsonb_build_object('product_id', dest1, 'quantity', 1)), A, NULL);
  ASSERT r->>'status' = 'recebida', r::text;

  r := fv.enviar_transferencia(C, B, jsonb_build_array(jsonb_build_object('product_id', P2, 'quantity', 1)),
         A, NULL, false, NULL, 'devolucao_consignacao', ida);
  ASSERT NOT (r->>'success')::boolean, 'devolução no sentido errado';

  -- 4. Prévia: ficaram 2 colares (custo 10) + 1 brinco (custo 20) = 40 a custo; 2x30+50 = 110 a venda
  rj := fv.acerto_consignacao_loja(ida, A, 'custo');
  ASSERT (rj->>'success')::boolean, rj::text;
  ASSERT (rj->'resumo'->>'pecas_ficaram')::int = 3, rj::text;
  ASSERT (rj->'resumo'->>'valor')::numeric = 40, rj::text;
  ASSERT (rj->'resumo'->>'faltou_na_ida')::int = 1, rj::text;
  rj := fv.acerto_consignacao_loja(ida, A, 'venda');
  ASSERT (rj->'resumo'->>'valor')::numeric = 110, rj::text;
  ASSERT (SELECT acerto_at IS NULL FROM fv.transfers WHERE id = ida), 'prévia não grava';

  -- 5. Fechar: conta a pagar pendente na loja B, uma vez só
  rj := fv.acerto_consignacao_loja(ida, A, 'custo', '2026-11-05', true);
  ASSERT (rj->>'success')::boolean, rj::text;
  ASSERT (SELECT count(*) FROM fv.transactions WHERE reference_type = 'transfer' AND reference_id = ida
            AND store_id = B AND type = 'expense' AND status = 'pending' AND amount = 40) = 1, 'conta a pagar';
  rj := fv.acerto_consignacao_loja(ida, A, 'custo', NULL, true);
  ASSERT NOT (rj->>'success')::boolean, 'segundo acerto recusado';

  -- 6. Ida "levo na mão" continua entrando direto
  r := fv.enviar_transferencia(C, B, jsonb_build_array(jsonb_build_object('product_id', P2, 'quantity', 1)), A, NULL, true);
  ASSERT (r->>'auto_recebida')::boolean, r::text;

  -- 7. lote_fornecedor por enviar é recusado
  r := fv.enviar_transferencia(B, C, jsonb_build_array(jsonb_build_object('product_id', dest1, 'quantity', 1)),
         A, NULL, false, NULL, 'lote_fornecedor', NULL);
  ASSERT NOT (r->>'success')::boolean, 'lote só pela compra';
END $$;

-- 8. Lote de fornecedor: compra lançada saindo de C com linha para B
DO $$
DECLARE
  C  uuid := '00000000-0000-0000-0000-0000000000c1';
  B  uuid := '00000000-0000-0000-0000-0000000000b1';
  A  uuid := '00000000-0000-0000-0000-00000000aaaa';
  OB uuid := '00000000-0000-0000-0000-00000000bbbb';
  rj jsonb; r json; t uuid; pb uuid; pc uuid; payload jsonb;
BEGIN
  INSERT INTO fv.suppliers (id, name, initials, phones) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Forn', 'FO', '[]');
  payload := jsonb_build_object(
    'client_request_id', gen_random_uuid(), 'user_id', A, 'purchase_date', '2026-10-05', 'is_consignment', true,
    'fornecedores_novos', '[]'::jsonb,
    'linhas', jsonb_build_array(
      jsonb_build_object('product_id', NULL, 'supplier_id', '00000000-0000-0000-0000-0000000000f1', 'code', 'FO0911', 'name', 'Anel B',
        'category', 'anel', 'material', 'prata', 'store_id', B, 'cost_price', 11, 'sale_price', 33, 'quantity', 2,
        'purchase_month', 10, 'purchase_year', 2026)),
    'consignacao', jsonb_build_object('supplier_id', '00000000-0000-0000-0000-0000000000f1', 'store_id', B,
        'return_deadline', '2026-11-05', 'total_pieces', 2, 'total_cost_value', 22),
    'compra', jsonb_build_object('total_cost', 22, 'total_items', 2),
    'pagamentos', '[]'::jsonb);

  rj := fv.salvar_compra_com_remessa(payload, C);
  ASSERT jsonb_array_length(rj->'remessas') = 1, rj::text;
  t := (rj->'remessas'->>0)::uuid;
  SELECT id INTO pb FROM fv.products WHERE code = 'FO0911';
  ASSERT (SELECT quantity_in_stock = 0 AND NOT is_active FROM fv.products WHERE id = pb), 'lote fora do estoque até conferir';
  ASSERT (SELECT kind = 'lote_fornecedor' AND status = 'enviada' AND to_store_id = B FROM fv.transfers WHERE id = t), 'remessa pendente';

  -- reenvio da mesma compra não abre outra remessa nem tira saldo de novo
  rj := fv.salvar_compra_com_remessa(payload, C);
  ASSERT (rj->>'ja_existia')::boolean, rj::text;
  ASSERT (SELECT count(*) FROM fv.transfers WHERE kind = 'lote_fornecedor') = 1, 'idempotente';

  r := fv.cancelar_transferencia(t, A, 'teste');
  ASSERT NOT (r->>'success')::boolean, r::text;

  -- B confere 1 de 2: entra 1, falta 1 sem mexer em estoque de ninguém
  r := fv.receber_transferencia(t, jsonb_build_array(jsonb_build_object('product_id', pb, 'quantity', 1)), OB, 'veio 1');
  ASSERT r->>'status' = 'divergente', r::text;
  ASSERT (SELECT quantity_in_stock = 1 AND is_active AND store_id = B FROM fv.products WHERE id = pb), 'entrou 1 em B';
  ASSERT (SELECT count(*) FROM fv.products WHERE code = 'FO0911') = 1, 'sem linha duplicada';

  -- linha para a própria loja de onde sai: entra direto, sem remessa
  payload := jsonb_set(payload, '{client_request_id}', to_jsonb(gen_random_uuid()));
  payload := jsonb_set(payload, '{linhas,0,store_id}', to_jsonb(C));
  payload := jsonb_set(payload, '{linhas,0,code}', '"FO0912"');
  payload := jsonb_set(payload, '{consignacao,store_id}', to_jsonb(C));
  rj := fv.salvar_compra_com_remessa(payload, C);
  ASSERT jsonb_array_length(rj->'remessas') = 0, rj::text;
  SELECT id INTO pc FROM fv.products WHERE code = 'FO0912';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = pc) = 2, 'origem entra direto';
END $$;

\echo 'OK: todos os asserts passaram'
ROLLBACK;
