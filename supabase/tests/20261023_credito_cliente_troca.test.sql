-- ============================================================================
-- Teste do crédito da cliente (troca com sobra) — 20261023
-- ============================================================================
--
-- Autocontido: cria duas lojas, uma usuária, uma cliente e três peças DENTRO
-- da transação e termina em ROLLBACK. Roda num banco só com o schema (cópia
-- por pg_dump -s) ou no de verdade, sem deixar rastro.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261023_credito_cliente_troca.test.sql
-- Passou = NOTICE "crédito da cliente: OK".
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_a     uuid;   -- loja que gera o crédito
  v_b     uuid;   -- a outra loja
  v_user  uuid := gen_random_uuid();
  v_cli   uuid;
  v_con   uuid;   -- ACESSORIO CON, R$ 198 (devolvido)
  v_ades  uuid;   -- ADESIVO ORELHA, R$ 18 (levado)
  v_out   uuid;   -- peça de R$ 100 para a compra seguinte
  v_hoje  text := to_char(current_date, 'YYYY-MM-DD');
  v_r     jsonb;
  v_s1    uuid;
  v_s4    uuid;
  v_n     integer;
  v_saldo numeric;
  v_ok    boolean;

BEGIN
  INSERT INTO fv.stores (name, city, state) VALUES ('TESTE A', 'Campinas', 'SP') RETURNING id INTO v_a;
  INSERT INTO fv.stores (name, city, state) VALUES ('TESTE B', 'Brasília', 'DF') RETURNING id INTO v_b;
  INSERT INTO auth.users (id, email) VALUES (v_user, 'teste-credito@x.invalid');
  INSERT INTO fv.users (id, full_name, role, store_id) VALUES (v_user, 'TESTE', 'operator', v_a);
  INSERT INTO fv.customers (name, phone, origin_store_id) VALUES ('TESTE Cliente', '00000000000', v_a) RETURNING id INTO v_cli;
  INSERT INTO fv.products (code, name, category, material, store_id, cost_price, sale_price, purchase_month, purchase_year, quantity_in_stock)
  VALUES ('TST-CON', 'TESTE ACESSORIO CON', 'outros', 'outros', v_a, 50, 198, 10, 2026, 0) RETURNING id INTO v_con;
  INSERT INTO fv.products (code, name, category, material, store_id, cost_price, sale_price, purchase_month, purchase_year, quantity_in_stock)
  VALUES ('TST-ADE', 'TESTE ADESIVO ORELHA', 'outros', 'outros', v_a, 5, 18, 10, 2026, 10) RETURNING id INTO v_ades;
  INSERT INTO fv.products (code, name, category, material, store_id, cost_price, sale_price, purchase_month, purchase_year, quantity_in_stock)
  VALUES ('TST-OUT', 'TESTE PECA 100', 'outros', 'outros', v_a, 30, 100, 10, 2026, 10) RETURNING id INTO v_out;

  -- ── 1. GUARDAR: devolve 198, leva 18, sobra 180 vira crédito ────────────
  v_r := fv.salvar_venda(jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'sale', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'seller_id', v_user,
      'sale_date', v_hoje, 'subtotal', 18, 'discount_pct', 0, 'discount_amount', 0, 'manual_discount', 0,
      'total', 18, 'total_cost', 5, 'payment_summary', 'Troca', 'status', 'completed'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_ades, 'quantity', 1, 'unit_price', 18, 'unit_cost', 5, 'subtotal', 18)),
    'payments', '[]'::jsonb, 'transactions', '[]'::jsonb,
    'exchange', jsonb_build_object(
      'row', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'exchange_date', v_hoje,
             'reason', 'Troca de produto', 'price_difference', -180, 'sobra_valor', 180, 'sobra_destino', 'guardado'),
      'returned', jsonb_build_array(jsonb_build_object('product_id', v_con, 'quantity', 1, 'unit_price', 198, 'unit_cost', 50)),
      'given',    jsonb_build_array(jsonb_build_object('product_id', v_ades, 'quantity', 1, 'unit_price', 18, 'unit_cost', 5)))));
  v_s1 := (v_r->>'sale_id')::uuid;
  SELECT balance INTO v_saldo FROM fv.customer_credits WHERE store_id = v_a AND customer_id = v_cli;
  IF v_saldo IS DISTINCT FROM 180 THEN RAISE EXCEPTION 'guardar: saldo % (esperado 180)', v_saldo; END IF;
  IF (SELECT quantity_in_stock FROM fv.products WHERE id = v_con) <> 1 THEN RAISE EXCEPTION 'guardar: peça devolvida não voltou ao estoque'; END IF;

  -- ── 2. NÃO GUARDAR: nada guardado, nada sai do caixa, fica na troca ─────
  v_r := fv.salvar_venda(jsonb_build_object(
    'sale', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'seller_id', v_user,
      'sale_date', v_hoje, 'subtotal', 18, 'discount_pct', 0, 'discount_amount', 0, 'manual_discount', 0,
      'total', 18, 'total_cost', 5, 'status', 'completed'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_ades, 'quantity', 1, 'unit_price', 18, 'unit_cost', 5, 'subtotal', 18)),
    'payments', '[]'::jsonb, 'transactions', '[]'::jsonb,
    'exchange', jsonb_build_object(
      'row', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'exchange_date', v_hoje,
             'reason', 'Troca de produto', 'price_difference', -180, 'sobra_valor', 180, 'sobra_destino', 'dispensado'),
      'returned', jsonb_build_array(jsonb_build_object('product_id', v_con, 'quantity', 1, 'unit_price', 198, 'unit_cost', 50)),
      'given', '[]'::jsonb)));
  IF (SELECT balance FROM fv.customer_credits WHERE store_id = v_a AND customer_id = v_cli) <> 180 THEN RAISE EXCEPTION 'não guardar mexeu no saldo'; END IF;
  IF EXISTS (SELECT 1 FROM fv.transactions WHERE reference_id = (v_r->>'sale_id')::uuid) THEN RAISE EXCEPTION 'não guardar gravou financeiro'; END IF;
  IF (SELECT sobra_destino FROM fv.exchanges WHERE sale_id = (v_r->>'sale_id')::uuid) <> 'dispensado' THEN RAISE EXCEPTION 'não guardar: destino não registrado'; END IF;

  -- ── 3. DEVOLVER em Pix: saída no financeiro e no fluxo de caixa ────────
  v_r := fv.salvar_venda(jsonb_build_object(
    'sale', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'seller_id', v_user,
      'sale_date', v_hoje, 'subtotal', 18, 'discount_pct', 0, 'discount_amount', 0, 'manual_discount', 0,
      'total', 18, 'total_cost', 5, 'status', 'completed'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_ades, 'quantity', 1, 'unit_price', 18, 'unit_cost', 5, 'subtotal', 18)),
    'payments', '[]'::jsonb,
    'transactions', jsonb_build_array(jsonb_build_object('store_id', v_a, 'type', 'expense', 'amount', 180,
      'category', 'devolucao_troca', 'description', 'Devolução da sobra da troca', 'reference_type', 'sale',
      'user_id', v_user, 'payment_method', 'pix', 'transaction_date', v_hoje, 'status', 'completed')),
    'exchange', jsonb_build_object(
      'row', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'exchange_date', v_hoje,
             'reason', 'Troca de produto', 'price_difference', -180, 'sobra_valor', 180, 'sobra_destino', 'devolvido', 'sobra_metodo', 'pix'),
      'returned', jsonb_build_array(jsonb_build_object('product_id', v_con, 'quantity', 1, 'unit_price', 198, 'unit_cost', 50)),
      'given', '[]'::jsonb)));
  IF (SELECT saidas FROM fv.fluxo_caixa(v_a, current_date, current_date)) <> 180 THEN RAISE EXCEPTION 'devolver: fluxo de caixa sem a saída de 180'; END IF;
  IF (SELECT balance FROM fv.customer_credits WHERE store_id = v_a AND customer_id = v_cli) <> 180 THEN RAISE EXCEPTION 'devolver mexeu no saldo'; END IF;

  -- CHECK: devolver sem forma é recusado
  BEGIN
    INSERT INTO fv.exchanges (store_id, customer_id, user_id, exchange_date, price_difference, sobra_valor, sobra_destino)
    VALUES (v_a, v_cli, v_user, now(), -1, 1, 'devolvido');
    RAISE EXCEPTION 'devolver sem forma passou';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 4. USAR PARCIAL: compra de 100 com o crédito, sobra 80 ─────────────
  v_r := fv.salvar_venda(jsonb_build_object(
    'sale', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'seller_id', v_user,
      'sale_date', v_hoje, 'subtotal', 100, 'discount_pct', 0, 'discount_amount', 0, 'manual_discount', 0,
      'total', 100, 'total_cost', 30, 'status', 'completed'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_out, 'quantity', 1, 'unit_price', 100, 'unit_cost', 30, 'subtotal', 100)),
    'payments', jsonb_build_array(jsonb_build_object('payment_method', 'store_credit', 'amount', 100, 'installments', 1)),
    'transactions', '[]'::jsonb));
  v_s4 := (v_r->>'sale_id')::uuid;
  IF (SELECT balance FROM fv.customer_credits WHERE store_id = v_a AND customer_id = v_cli) <> 80 THEN RAISE EXCEPTION 'usar parcial: saldo não ficou 80'; END IF;

  -- ── 5. PASSAR DO SALDO: recusado, e a venda inteira não entra ──────────
  SELECT count(*) INTO v_n FROM fv.sales WHERE store_id = v_a;
  BEGIN
    PERFORM fv.salvar_venda(jsonb_build_object(
      'sale', jsonb_build_object('store_id', v_a, 'customer_id', v_cli, 'user_id', v_user, 'seller_id', v_user,
        'sale_date', v_hoje, 'subtotal', 100, 'discount_pct', 0, 'discount_amount', 0, 'manual_discount', 0,
        'total', 100, 'total_cost', 30, 'status', 'completed'),
      'items', jsonb_build_array(jsonb_build_object('product_id', v_out, 'quantity', 1, 'unit_price', 100, 'unit_cost', 30, 'subtotal', 100)),
      'payments', jsonb_build_array(jsonb_build_object('payment_method', 'store_credit', 'amount', 100, 'installments', 1)),
      'transactions', '[]'::jsonb));
    RAISE EXCEPTION 'usar acima do saldo passou';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM fv.sales WHERE store_id = v_a) <> v_n THEN RAISE EXCEPTION 'venda recusada ficou gravada'; END IF;

  -- ── 6. OUTRA LOJA: o saldo de A não existe em B ────────────────────────
  IF EXISTS (SELECT 1 FROM fv.customer_credits WHERE store_id = v_b AND customer_id = v_cli) THEN RAISE EXCEPTION 'saldo vazou para a outra loja'; END IF;
  BEGIN
    PERFORM fv._mover_credito(v_b, v_cli, -10, 'usou', NULL, v_user, NULL);
    RAISE EXCEPTION 'usou crédito em outra loja';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 7. EXCLUIR a venda que gerou, com parte já usada: recusado ─────────
  BEGIN
    PERFORM fv.excluir_venda(v_s1, v_user);
    RAISE EXCEPTION 'excluiu venda cujo crédito já foi usado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ── 8. EXCLUIR a compra que usou: o crédito volta (80 + 100) ───────────
  PERFORM fv.excluir_venda(v_s4, v_user);
  IF (SELECT balance FROM fv.customer_credits WHERE store_id = v_a AND customer_id = v_cli) <> 180 THEN RAISE EXCEPTION 'estorno do uso não devolveu o crédito'; END IF;

  -- ── 9. USAR TUDO e AJUSTE do admin ─────────────────────────────────────
  PERFORM fv._mover_credito(v_a, v_cli, -180, 'usou', NULL, v_user, NULL);
  IF (SELECT balance FROM fv.customer_credits WHERE store_id = v_a AND customer_id = v_cli) <> 0 THEN RAISE EXCEPTION 'usar tudo: saldo não zerou'; END IF;
  PERFORM fv.ajustar_credito_cliente(v_a, v_cli, 25, v_user, 'acerto');
  IF (SELECT balance FROM fv.customer_credits WHERE store_id = v_a AND customer_id = v_cli) <> 25 THEN RAISE EXCEPTION 'ajuste não definiu 25'; END IF;
  SELECT count(*) INTO v_n FROM fv.customer_credit_movements WHERE store_id = v_a AND customer_id = v_cli;
  IF v_n <> 5 THEN RAISE EXCEPTION 'extrato com % linhas (esperado 5: gerou, usou, estorno, usou, ajuste)', v_n; END IF;

  -- ── 10. VENDEDORA NÃO AJUSTA: navegador (anon/authenticated) sem acesso ─
  SELECT has_function_privilege('authenticated', 'fv.ajustar_credito_cliente(uuid, uuid, numeric, uuid, text)', 'EXECUTE')
      OR has_function_privilege('anon', 'fv.ajustar_credito_cliente(uuid, uuid, numeric, uuid, text)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'fv._mover_credito(uuid, uuid, numeric, text, uuid, uuid, text)', 'EXECUTE')
      OR has_table_privilege('authenticated', 'fv.customer_credits', 'SELECT')
      OR has_table_privilege('authenticated', 'fv.customer_credit_movements', 'INSERT')
    INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'navegador tem acesso direto ao crédito'; END IF;

  RAISE NOTICE 'crédito da cliente: OK';
END;
$$;

ROLLBACK;
