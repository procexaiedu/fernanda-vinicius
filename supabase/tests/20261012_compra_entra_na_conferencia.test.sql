-- Teste da migration 20261012_compra_entra_na_conferencia.sql com DADOS FICTÍCIOS.
-- Rodar no banco de TESTE local (fvtest-db), nunca em produção:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261012_compra_entra_na_conferencia.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261012_compra_entra_na_conferencia.test.sql
-- Termina em ROLLBACK; qualquer ASSERT que falhe aborta com erro.

BEGIN;

INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Loja C', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000000b1', 'Loja B', 'B', 'DF');
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-00000000aaaa'), ('00000000-0000-0000-0000-00000000bbbb'),
  ('00000000-0000-0000-0000-00000000cccc'), ('00000000-0000-0000-0000-00000000dddd');
INSERT INTO fv.users (id, full_name, role, store_id) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', 'Admin rede', 'admin', NULL),
  ('00000000-0000-0000-0000-00000000bbbb', 'Op B', 'operator', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000cccc', 'Admin C', 'admin', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000dddd', 'Admin B', 'admin', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO fv.suppliers (id, name, initials, phones) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Forn Um', 'FU', '[]'),
  ('00000000-0000-0000-0000-0000000000f2', 'Forn Dois', 'FD', '[]');
-- Peça já cadastrada em C, com 5 em estoque (vai ser reaproveitada nas compras).
INSERT INTO fv.products (id, code, name, category, material, supplier_id, store_id, cost_price, sale_price,
                         quantity_in_stock, barcode_number, is_active, ownership_type, purchase_month, purchase_year)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'FU1010', 'Colar velho', 'colar', 'prata',
        '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 10, 30, 5, 'T-91001',
        true, 'own', 10, 2026);

-- Payload de compra própria: P (reusada, C) x2 a 10 + Anel novo (B) x3 a 20 = 80.
-- Pagamento da Forn Um: 30 pago + 2 parcelas de 25 pendentes.
CREATE TEMP TABLE _t (k text PRIMARY KEY, v jsonb);
INSERT INTO _t VALUES ('compra', jsonb_build_object(
  'client_request_id', gen_random_uuid(), 'user_id', '00000000-0000-0000-0000-00000000aaaa',
  'purchase_date', '2026-10-12', 'is_consignment', false, 'fornecedores_novos', '[]'::jsonb,
  'linhas', jsonb_build_array(
    jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000a1', 'supplier_id', '00000000-0000-0000-0000-0000000000f1',
      'code', 'FU1010', 'name', 'Colar velho', 'category', 'colar', 'material', 'prata',
      'store_id', '00000000-0000-0000-0000-0000000000c1', 'cost_price', 10, 'sale_price', 30, 'quantity', 2,
      'purchase_month', 10, 'purchase_year', 2026),
    jsonb_build_object('product_id', NULL, 'supplier_id', '00000000-0000-0000-0000-0000000000f1',
      'code', 'FU102000', 'name', 'Anel novo', 'category', 'anel', 'material', 'prata',
      'store_id', '00000000-0000-0000-0000-0000000000b1', 'cost_price', 20, 'sale_price', 60, 'quantity', 3,
      'purchase_month', 10, 'purchase_year', 2026)),
  'consignacao', NULL,
  'compra', jsonb_build_object('total_cost', 80, 'total_items', 5, 'nf_number', 'NF-1'),
  'pagamentos', jsonb_build_array(
    jsonb_build_object('supplier_id', '00000000-0000-0000-0000-0000000000f1', 'payment_method', 'pix', 'amount', 30,
      'due_date', '2026-10-12', 'status', 'completed', 'description', 'Compra NF-1'),
    jsonb_build_object('supplier_id', '00000000-0000-0000-0000-0000000000f1', 'payment_method', 'check', 'amount', 25,
      'installment_number', 1, 'due_date', '2026-11-12', 'status', 'pending', 'description', 'Compra NF-1 1/2'),
    jsonb_build_object('supplier_id', '00000000-0000-0000-0000-0000000000f1', 'payment_method', 'check', 'amount', 25,
      'installment_number', 2, 'due_date', '2026-12-12', 'status', 'pending', 'description', 'Compra NF-1 2/2'))));

DO $$
DECLARE
  C  uuid := '00000000-0000-0000-0000-0000000000c1';
  B  uuid := '00000000-0000-0000-0000-0000000000b1';
  A  uuid := '00000000-0000-0000-0000-00000000aaaa';
  OB uuid := '00000000-0000-0000-0000-00000000bbbb';
  P  uuid := '00000000-0000-0000-0000-0000000000a1';
  payload jsonb := (SELECT v FROM _t WHERE k = 'compra');
  rj jsonb; r json; compra uuid; tb uuid; tc uuid; anel uuid;
BEGIN
  -- 1. Registrar a compra NÃO põe nada no estoque: uma remessa por loja, origem = fornecedor.
  rj := fv.salvar_compra_conferida(payload, false);
  compra := (rj->>'purchase_id')::uuid;
  ASSERT jsonb_array_length(rj->'remessas') = 2, rj::text;
  SELECT id INTO anel FROM fv.products WHERE code = 'FU102000';
  ASSERT (SELECT quantity_in_stock = 0 AND NOT is_active FROM fv.products WHERE id = anel), 'anel novo fora do estoque';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P) = 5, 'peça reaproveitada continua com 5 (2 em trânsito)';
  SELECT id INTO tb FROM fv.transfers WHERE purchase_id = compra AND to_store_id = B;
  SELECT id INTO tc FROM fv.transfers WHERE purchase_id = compra AND to_store_id = C;
  ASSERT (SELECT from_store_id IS NULL AND kind = 'lote_fornecedor' AND status = 'enviada' FROM fv.transfers WHERE id = tb), 'remessa B pendente';
  ASSERT (SELECT (totals->>'pecas')::int FROM fv.transfers WHERE id = tc) = 2, 'remessa C com 2';
  INSERT INTO _t VALUES ('ids', jsonb_build_object('compra', compra, 'tb', tb, 'tc', tc, 'anel', anel));

  -- reenvio da mesma compra: nada novo
  rj := fv.salvar_compra_conferida(payload, false);
  ASSERT (rj->>'ja_existia')::boolean, rj::text;
  ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id = compra) = 2, 'idempotente';

  -- origem nula só em lote_fornecedor
  BEGIN
    INSERT INTO fv.transfers (from_store_id, to_store_id, sent_by, kind) VALUES (NULL, B, A, 'transferencia');
    RAISE EXCEPTION 'deveria ter recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 2. B confere 2 de 3: entram 2, falta 1
  r := fv.receber_transferencia(tb, jsonb_build_array(jsonb_build_object('product_id', anel, 'quantity', 2)), OB, 'veio 2');
  ASSERT r->>'status' = 'divergente', r::text;
  ASSERT (SELECT quantity_in_stock = 2 AND is_active FROM fv.products WHERE id = anel), 'entraram 2';

  -- 3. Prévia do desconto: 1 x 20, cabe nas parcelas pendentes
  rj := fv.decidir_falta_do_lote(tb, A, true, false);
  ASSERT (rj->>'valor')::numeric = 20 AND (rj->>'pecas')::int = 1, rj::text;
  ASSERT (rj->'fornecedoras'->0->>'abate')::numeric = 20 AND (rj->'fornecedoras'->0->>'credito')::numeric = 0, rj::text;
  ASSERT (SELECT falta_decisao IS NULL FROM fv.transfers WHERE id = tb), 'prévia não grava';

  -- 4. Descontar: a última parcela (25, dez) vira 5, e a despesa dela também
  rj := fv.decidir_falta_do_lote(tb, A, true, true);
  ASSERT (rj->>'abatido')::numeric = 20 AND (rj->>'credito')::numeric = 0, rj::text;
  ASSERT (SELECT amount FROM fv.purchase_payments WHERE purchase_id = compra AND due_date = '2026-12-12') = 5, 'parcela de dez abatida';
  ASSERT (SELECT amount FROM fv.purchase_payments WHERE purchase_id = compra AND due_date = '2026-11-12') = 25, 'parcela de nov intacta';
  ASSERT (SELECT amount FROM fv.transactions WHERE reference_id = compra AND due_date = '2026-12-12') = 5, 'despesa abatida';
  ASSERT (SELECT sum(amount) FROM fv.purchase_payments WHERE purchase_id = compra) = 60, 'pagamentos = 80 - 20';
  ASSERT (SELECT desconto_falta FROM fv.purchases WHERE id = compra) = 20, 'desconto guardado';
  ASSERT (SELECT notes LIKE '%FALTA NA CONFERÊNCIA%' FROM fv.purchases WHERE id = compra), 'nota na compra';
  ASSERT (SELECT falta_decisao = 'descontada' FROM fv.transfers WHERE id = tb), 'decisão gravada';
  rj := fv.decidir_falta_do_lote(tb, A, true, true);
  ASSERT NOT (rj->>'success')::boolean, 'segunda decisão recusada';
END $$;

-- 5. RLS: a remessa de B não aparece para a admin de C; a de C não aparece para a de B.
DO $$
DECLARE ids jsonb := (SELECT v FROM _t WHERE k = 'ids');
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000cccc","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id = (ids->>'compra')::uuid) = 1, 'admin C vê só a de C';
  ASSERT (SELECT count(*) FROM fv.transfers WHERE id = (ids->>'tb')::uuid) = 0, 'admin C não vê a de B';
  ASSERT (SELECT count(*) FROM fv.transfer_items WHERE transfer_id = (ids->>'tb')::uuid) = 0, 'nem os itens';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000dddd","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM fv.transfers WHERE id = (ids->>'tc')::uuid) = 0, 'admin B não vê a de C';
  ASSERT (SELECT count(*) FROM fv.transfers WHERE id = (ids->>'tb')::uuid) = 1, 'admin B vê a de B';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id = (ids->>'compra')::uuid) = 2, 'admin da rede vê as duas';
  RESET ROLE;
END $$;

DO $$
DECLARE
  C  uuid := '00000000-0000-0000-0000-0000000000c1';
  B  uuid := '00000000-0000-0000-0000-0000000000b1';
  A  uuid := '00000000-0000-0000-0000-00000000aaaa';
  P  uuid := '00000000-0000-0000-0000-0000000000a1';
  ids jsonb := (SELECT v FROM _t WHERE k = 'ids');
  base jsonb := (SELECT v FROM _t WHERE k = 'compra');
  payload jsonb; rj jsonb; r json; c2 uuid; t2 uuid; t1 uuid := (ids->>'tc')::uuid; antes integer;
BEGIN
  -- 6. A MESMA peça reaproveitada em duas remessas pendentes para C (2 + 3).
  payload := jsonb_set(base, '{client_request_id}', to_jsonb(gen_random_uuid()));
  payload := jsonb_set(payload, '{linhas}', jsonb_build_array(jsonb_set(base->'linhas'->0, '{quantity}', '3')));
  payload := jsonb_set(payload, '{compra}', '{"total_cost": 30, "total_items": 3}');
  payload := jsonb_set(payload, '{pagamentos}', jsonb_build_array(jsonb_build_object(
    'supplier_id', '00000000-0000-0000-0000-0000000000f1', 'payment_method', 'pix', 'amount', 30,
    'due_date', '2026-10-12', 'status', 'completed', 'description', 'Compra 2')));
  rj := fv.salvar_compra_conferida(payload, false);
  c2 := (rj->>'purchase_id')::uuid;
  t2 := (rj->'remessas'->>0)::uuid;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P) = 5, 'segunda compra também em trânsito';
  -- confere a 2ª inteira, depois a 1ª com falta de 1
  r := fv.receber_transferencia(t2, jsonb_build_array(jsonb_build_object('product_id', P, 'quantity', 3)), A, NULL);
  ASSERT r->>'status' = 'recebida', r::text;
  r := fv.receber_transferencia(t1, jsonb_build_array(jsonb_build_object('product_id', P, 'quantity', 1)), A, 'faltou 1');
  ASSERT r->>'status' = 'divergente', r::text;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P) = 9, '5 + 3 + 1';
  ASSERT (SELECT count(*) FROM fv.products WHERE barcode_number = 'T-91001') = 1, 'sem linha duplicada';

  -- 7. Falta já paga vira crédito: compra 2 está toda paga; nova compra com falta
  payload := jsonb_set(payload, '{client_request_id}', to_jsonb(gen_random_uuid()));
  rj := fv.salvar_compra_conferida(payload, false);
  t2 := (rj->'remessas'->>0)::uuid;
  r := fv.receber_transferencia(t2, jsonb_build_array(jsonb_build_object('product_id', P, 'quantity', 2)), A, 'faltou 1');
  rj := fv.decidir_falta_do_lote(t2, A, true, true);
  ASSERT (rj->>'credito')::numeric = 10 AND (rj->>'abatido')::numeric = 0, rj::text;
  ASSERT (SELECT count(*) FROM fv.transactions WHERE reference_type = 'transfer' AND reference_id = t2
            AND type = 'income' AND status = 'pending' AND category = 'credito_fornecedor' AND amount = 10
            AND store_id = C) = 1, 'crédito a receber na loja que conferiu';

  -- 8. Excluir compra com remessa PENDENTE não tira estoque real da peça reaproveitada.
  payload := jsonb_set(payload, '{client_request_id}', to_jsonb(gen_random_uuid()));
  rj := fv.salvar_compra_conferida(payload, false);
  c2 := (rj->>'purchase_id')::uuid;
  t2 := (rj->'remessas'->>0)::uuid;
  antes := (SELECT quantity_in_stock FROM fv.products WHERE id = P);   -- 11
  -- como era: excluir_compra estornava as 3 que nunca entraram
  BEGIN
    rj := fv.excluir_compra(c2, A);
    ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P) = antes - 3, 'bug antigo reproduzido';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__desfaz__';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '__desfaz__' THEN RAISE; END IF;
  END;
  rj := fv.excluir_compra_conferida(c2, A);
  ASSERT (rj->>'ok')::boolean, rj::text;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P) = antes, 'estoque real intacto';
  ASSERT (SELECT status = 'cancelada' AND purchase_id IS NULL FROM fv.transfers WHERE id = t2), 'remessa encerrada';

  -- 9. Excluir a 1ª compra (já conferida, com falta descontada): estorna só o que entrou.
  --    Colar: 2 vieram 1 (estorna 1). Anel: 3 vieram 2 (estorna 2 → 0).
  antes := (SELECT quantity_in_stock FROM fv.products WHERE id = P);
  rj := fv.excluir_compra_conferida((ids->>'compra')::uuid, A);
  ASSERT (rj->>'ok')::boolean, rj::text;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P) = antes - 1, 'colar: só o que entrou';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = (ids->>'anel')::uuid) = 0, 'anel zerado';

  -- 10. "Entra direto" (a admin marcou): como antes, sem remessa
  payload := jsonb_set(payload, '{client_request_id}', to_jsonb(gen_random_uuid()));
  antes := (SELECT quantity_in_stock FROM fv.products WHERE id = P);
  rj := fv.salvar_compra_conferida(payload, true);
  ASSERT rj->'remessas' IS NULL, rj::text;
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = P) = antes + 3, 'entrou direto';
  ASSERT (SELECT count(*) FROM fv.transfers WHERE purchase_id = (rj->>'purchase_id')::uuid) = 0, 'sem remessa';
END $$;

-- 11. Consignação: falta descontada reduz o lote.
DO $$
DECLARE
  B  uuid := '00000000-0000-0000-0000-0000000000b1';
  A  uuid := '00000000-0000-0000-0000-00000000aaaa';
  F2 uuid := '00000000-0000-0000-0000-0000000000f2';
  rj jsonb; r json; t uuid; pb uuid; lote uuid;
BEGIN
  rj := fv.salvar_compra_conferida(jsonb_build_object(
    'client_request_id', gen_random_uuid(), 'user_id', A, 'purchase_date', '2026-10-12', 'is_consignment', true,
    'fornecedores_novos', '[]'::jsonb,
    'linhas', jsonb_build_array(jsonb_build_object('product_id', NULL, 'supplier_id', F2, 'code', 'FD101100',
      'name', 'Brinco consig', 'category', 'brinco', 'material', 'prata', 'store_id', B, 'cost_price', 11,
      'sale_price', 33, 'quantity', 4, 'purchase_month', 10, 'purchase_year', 2026)),
    'consignacao', jsonb_build_object('supplier_id', F2, 'store_id', B, 'return_deadline', '2026-11-12',
      'total_pieces', 4, 'total_cost_value', 44),
    'compra', jsonb_build_object('total_cost', 44, 'total_items', 4),
    'pagamentos', '[]'::jsonb), false);
  lote := (rj->>'consignment_id')::uuid;
  t := (rj->'remessas'->>0)::uuid;
  SELECT id INTO pb FROM fv.products WHERE code = 'FD101100';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = pb) = 0, 'consignação também espera a conferência';
  r := fv.receber_transferencia(t, jsonb_build_array(jsonb_build_object('product_id', pb, 'quantity', 3)), A, 'faltou 1');
  rj := fv.decidir_falta_do_lote(t, A, true, true);
  ASSERT (rj->>'success')::boolean, rj::text;
  ASSERT (SELECT total_cost_value = 33 AND total_pieces = 3 FROM fv.consignments WHERE id = lote), 'lote reduzido';

  -- não descontar: só registra
  rj := fv.salvar_compra_conferida(jsonb_build_object(
    'client_request_id', gen_random_uuid(), 'user_id', A, 'purchase_date', '2026-10-12', 'is_consignment', true,
    'fornecedores_novos', '[]'::jsonb,
    'linhas', jsonb_build_array(jsonb_build_object('product_id', NULL, 'supplier_id', F2, 'code', 'FD101200',
      'name', 'Brinco consig 2', 'category', 'brinco', 'material', 'prata', 'store_id', B, 'cost_price', 12,
      'sale_price', 36, 'quantity', 2, 'purchase_month', 10, 'purchase_year', 2026)),
    'consignacao', jsonb_build_object('supplier_id', F2, 'store_id', B, 'return_deadline', '2026-11-12',
      'total_pieces', 2, 'total_cost_value', 24),
    'compra', jsonb_build_object('total_cost', 24, 'total_items', 2),
    'pagamentos', '[]'::jsonb), false);
  lote := (rj->>'consignment_id')::uuid;
  t := (rj->'remessas'->>0)::uuid;
  SELECT id INTO pb FROM fv.products WHERE code = 'FD101200';
  r := fv.receber_transferencia(t, jsonb_build_array(jsonb_build_object('product_id', pb, 'quantity', 1)), A, 'faltou 1');
  rj := fv.decidir_falta_do_lote(t, A, false, true);
  ASSERT rj->>'decisao' = 'mantida', rj::text;
  ASSERT (SELECT total_cost_value FROM fv.consignments WHERE id = lote) = 24, 'lote intacto';
END $$;

\echo 'OK: todos os asserts passaram'
ROLLBACK;
