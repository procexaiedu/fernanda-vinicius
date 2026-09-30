-- ============================================================================
-- Teste de fv.salvar_venda / fv.editar_venda / fv.excluir_venda (01/10)
-- ============================================================================
--
-- Roda contra o banco de verdade e NÃO deixa rastro: tudo dentro de BEGIN …
-- ROLLBACK. Usa uma loja ativa, duas peças dela (que não sejam serviço) e um
-- usuário que já existem — por subquery, nenhum id fixo.
--
-- Não toca em NFC-e: a venda de teste nasce sem nfce_* e nada aqui chama a
-- emissão (a numeração fiscal não é consumida).
--
-- Como rodar (como postgres, no psql ou no SQL editor do Studio):
--   \i supabase/tests/20261001_venda_transacional_test.sql
-- Passou = termina com a NOTICE "venda transacional: OK" e o ROLLBACK.
-- Falhou = RAISE EXCEPTION com o que deu errado (e o rollback acontece igual).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_store     uuid;
  v_user      uuid;
  v_prod      uuid;   -- peça vendida
  v_prod2     uuid;   -- peça devolvida na troca (pode faltar: a parte da troca é pulada)
  v_est0      integer;
  v_est2_0    integer;
  v_est       integer;
  v_req       uuid := gen_random_uuid();
  v_p         jsonb;
  v_r         jsonb;
  v_r2        jsonb;
  v_sale      uuid;
  v_n         integer;
BEGIN
  SELECT s.id INTO v_store
    FROM fv.stores s
   WHERE s.is_active
     AND (SELECT count(*) FROM fv.products p WHERE p.store_id = s.id AND NOT p.is_service) >= 1
   ORDER BY s.created_at
   LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'teste: nenhuma loja ativa com peça'; END IF;

  SELECT id INTO v_user FROM fv.users WHERE is_active ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'teste: nenhum usuário ativo'; END IF;

  SELECT id, quantity_in_stock INTO v_prod, v_est0
    FROM fv.products WHERE store_id = v_store AND NOT is_service ORDER BY created_at LIMIT 1;
  SELECT id, quantity_in_stock INTO v_prod2, v_est2_0
    FROM fv.products WHERE store_id = v_store AND NOT is_service AND id <> v_prod ORDER BY created_at LIMIT 1;

  -- ── 1. Venda simples: 2 unidades, 2 pagamentos ────────────────────────────
  v_p := jsonb_build_object(
    'client_request_id', v_req,
    'sale', jsonb_build_object(
      'store_id', v_store, 'customer_id', NULL, 'user_id', v_user, 'seller_id', v_user,
      'sale_date', to_char(current_date, 'YYYY-MM-DD'),
      'subtotal', 200, 'discount_type', NULL, 'discount_pct', 0, 'discount_amount', 0,
      'manual_discount', 0, 'total', 200, 'total_cost', 80,
      'previsao_pagamento', NULL, 'destinatario_cpf', NULL,
      'payment_summary', 'PIX + Dinheiro', 'status', 'completed', 'notes', 'TESTE venda transacional'
    ),
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 2, 'unit_price', 100, 'unit_cost', 40, 'subtotal', 200, 'conserto', NULL
    )),
    'payments', jsonb_build_array(
      jsonb_build_object('payment_method', 'pix',  'amount', 150, 'installments', 1, 'card_brand', NULL),
      jsonb_build_object('payment_method', 'cash', 'amount',  50, 'installments', 1, 'card_brand', NULL)
    ),
    'transactions', jsonb_build_array(
      jsonb_build_object('store_id', v_store, 'type', 'income', 'amount', 150, 'category', 'venda',
        'description', 'Venda', 'reference_type', 'sale', 'user_id', v_user, 'payment_method', 'pix',
        'transaction_date', to_char(current_date, 'YYYY-MM-DD'), 'status', 'completed'),
      jsonb_build_object('store_id', v_store, 'type', 'income', 'amount', 50, 'category', 'venda',
        'description', 'Venda', 'reference_type', 'sale', 'user_id', v_user, 'payment_method', 'cash',
        'transaction_date', to_char(current_date, 'YYYY-MM-DD'), 'status', 'completed')
    ),
    'exchange', NULL
  );

  v_r := fv.salvar_venda(v_p);
  v_sale := (v_r->>'sale_id')::uuid;
  IF v_sale IS NULL OR (v_r->>'ja_existia')::boolean THEN
    RAISE EXCEPTION 'teste 1: salvar_venda não criou a venda: %', v_r;
  END IF;

  SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod;
  IF v_est <> v_est0 - 2 THEN
    RAISE EXCEPTION 'teste 1: estoque não baixou (antes %, depois %, esperado %)', v_est0, v_est, v_est0 - 2;
  END IF;
  IF (SELECT last_sale_date FROM fv.products WHERE id = v_prod) IS NULL THEN
    RAISE EXCEPTION 'teste 1: last_sale_date não foi gravado';
  END IF;

  SELECT count(*) INTO v_n FROM fv.sale_items WHERE sale_id = v_sale;
  IF v_n <> 1 THEN RAISE EXCEPTION 'teste 1: sale_items = %, esperado 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM fv.sale_payments WHERE sale_id = v_sale;
  IF v_n <> 2 THEN RAISE EXCEPTION 'teste 1: sale_payments = %, esperado 2', v_n; END IF;
  SELECT count(*) INTO v_n FROM fv.transactions
   WHERE reference_type = 'sale' AND reference_id = v_sale AND paid_at IS NOT NULL;
  IF v_n <> 2 THEN RAISE EXCEPTION 'teste 1: transactions = %, esperado 2', v_n; END IF;
  IF (SELECT client_request_id FROM fv.sales WHERE id = v_sale) IS DISTINCT FROM v_req THEN
    RAISE EXCEPTION 'teste 1: client_request_id não gravado';
  END IF;

  -- ── 2. Reenvio com o mesmo id: devolve a mesma venda, não duplica ─────────
  v_r2 := fv.salvar_venda(v_p);
  IF (v_r2->>'sale_id')::uuid IS DISTINCT FROM v_sale OR NOT COALESCE((v_r2->>'ja_existia')::boolean, false) THEN
    RAISE EXCEPTION 'teste 2: reenvio não reconheceu a venda: %', v_r2;
  END IF;
  IF COALESCE((v_r2->>'incompleta')::boolean, false) THEN
    RAISE EXCEPTION 'teste 2: venda transacional apareceu incompleta: %', v_r2;
  END IF;
  SELECT count(*) INTO v_n FROM fv.sales WHERE client_request_id = v_req;
  IF v_n <> 1 THEN RAISE EXCEPTION 'teste 2: % vendas com o mesmo client_request_id', v_n; END IF;
  SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod;
  IF v_est <> v_est0 - 2 THEN RAISE EXCEPTION 'teste 2: reenvio baixou o estoque de novo (%)', v_est; END IF;
  SELECT count(*) INTO v_n FROM fv.sale_payments WHERE sale_id = v_sale;
  IF v_n <> 2 THEN RAISE EXCEPTION 'teste 2: reenvio duplicou pagamentos (%)', v_n; END IF;

  -- ── 3. Mesmo id com OUTRA venda (total e subtotal diferentes): id_reusado ──
  v_r2 := fv.salvar_venda(jsonb_set(jsonb_set(v_p, '{sale,total}', '999'), '{sale,subtotal}', '999'));
  IF v_r2->>'erro' IS DISTINCT FROM 'id_reusado' THEN
    RAISE EXCEPTION 'teste 3: id reusado com outro total não foi barrado: %', v_r2;
  END IF;
  SELECT count(*) INTO v_n FROM fv.sales WHERE client_request_id = v_req;
  IF v_n <> 1 THEN RAISE EXCEPTION 'teste 3: id reusado gravou venda (%)', v_n; END IF;

  -- ── 4. Erro no meio = nada gravado (pagamento com método inválido) ─────────
  BEGIN
    PERFORM fv.salvar_venda(jsonb_set(
      jsonb_set(v_p, '{client_request_id}', to_jsonb(gen_random_uuid())),
      '{payments,0,payment_method}', '"boleto"'));
    RAISE EXCEPTION 'teste 4: pagamento inválido deveria ter falhado';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- esperado; o sub-bloco desfez tudo o que a chamada gravou
  END;
  SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod;
  IF v_est <> v_est0 - 2 THEN RAISE EXCEPTION 'teste 4: venda que falhou mexeu no estoque (%)', v_est; END IF;

  -- ── 5. Excluir devolve o estoque e apaga tudo ────────────────────────────
  v_r2 := fv.excluir_venda(v_sale, v_user);
  IF NOT COALESCE((v_r2->>'existia')::boolean, false) THEN
    RAISE EXCEPTION 'teste 5: excluir_venda não achou a venda: %', v_r2;
  END IF;
  SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod;
  IF v_est <> v_est0 THEN
    RAISE EXCEPTION 'teste 5: estoque não voltou (esperado %, está %)', v_est0, v_est;
  END IF;
  IF EXISTS (SELECT 1 FROM fv.sales WHERE id = v_sale)
     OR EXISTS (SELECT 1 FROM fv.sale_items WHERE sale_id = v_sale)
     OR EXISTS (SELECT 1 FROM fv.sale_payments WHERE sale_id = v_sale)
     OR EXISTS (SELECT 1 FROM fv.transactions WHERE reference_type = 'sale' AND reference_id = v_sale) THEN
    RAISE EXCEPTION 'teste 5: sobrou rastro da venda excluída';
  END IF;
  -- O rastro que a conferência lê: +2 na peça, ref à venda excluída.
  -- (Só se o saldo não era negativo — o CHECK nao_negativo impede a linha.)
  IF v_est0 - 2 >= 0 AND NOT EXISTS (
       SELECT 1 FROM fv.stock_movements
        WHERE ref_type = 'sale' AND ref_id = v_sale AND product_id = v_prod
          AND reason = 'venda_excluida' AND delta = 2
          AND quantity_before = v_est0 - 2 AND quantity_after = v_est0 AND user_id = v_user) THEN
    RAISE EXCEPTION 'teste 5: excluir_venda não gravou o movimento em stock_movements';
  END IF;

  -- ── 6. Troca: peça devolvida volta ao estoque; excluir tira de novo ───────
  IF v_prod2 IS NOT NULL THEN
    v_p := jsonb_set(v_p, '{client_request_id}', to_jsonb(gen_random_uuid()));
    v_p := jsonb_set(v_p, '{exchange}', jsonb_build_object(
      'row', jsonb_build_object(
        'original_sale_id', NULL, 'store_id', v_store,
        -- exchanges.customer_id é NOT NULL: usa uma cliente qualquer da base.
        'customer_id', (SELECT id FROM fv.customers ORDER BY created_at LIMIT 1),
        'user_id', v_user, 'exchange_date', to_char(current_date, 'YYYY-MM-DD'),
        'reason', 'Troca de produto', 'price_difference', 150, 'payment_method', 'pix'),
      'returned', jsonb_build_array(jsonb_build_object('product_id', v_prod2, 'quantity', 1, 'unit_price', 50, 'unit_cost', 20)),
      'given',    jsonb_build_array(jsonb_build_object('product_id', v_prod,  'quantity', 2, 'unit_price', 100, 'unit_cost', 40))
    ));
    v_p := jsonb_set(v_p, '{sale,customer_id}', v_p->'exchange'->'row'->'customer_id');

    IF v_p->'sale'->>'customer_id' IS NULL THEN
      RAISE NOTICE 'teste 6 pulado: nenhuma cliente cadastrada';
    ELSE
      v_r := fv.salvar_venda(v_p);
      v_sale := (v_r->>'sale_id')::uuid;
      SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod2;
      IF v_est <> v_est2_0 + 1 THEN
        RAISE EXCEPTION 'teste 6: peça devolvida não voltou ao estoque (antes %, depois %)', v_est2_0, v_est;
      END IF;
      IF NOT (SELECT is_active FROM fv.products WHERE id = v_prod2) THEN
        RAISE EXCEPTION 'teste 6: peça devolvida não foi reativada';
      END IF;
      SELECT count(*) INTO v_n FROM fv.exchange_items ei JOIN fv.exchanges e ON e.id = ei.exchange_id WHERE e.sale_id = v_sale;
      IF v_n <> 2 THEN RAISE EXCEPTION 'teste 6: exchange_items = %, esperado 2', v_n; END IF;

      PERFORM fv.excluir_venda(v_sale, v_user);
      SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod2;
      IF v_est <> v_est2_0 THEN RAISE EXCEPTION 'teste 6: excluir não tirou de novo a peça devolvida (%)', v_est; END IF;
      SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod;
      IF v_est <> v_est0 THEN RAISE EXCEPTION 'teste 6: excluir não devolveu a peça vendida (%)', v_est; END IF;
      IF EXISTS (SELECT 1 FROM fv.exchanges WHERE sale_id = v_sale) THEN
        RAISE EXCEPTION 'teste 6: sobrou a troca da venda excluída';
      END IF;
      IF v_est2_0 >= 0 AND NOT EXISTS (
           SELECT 1 FROM fv.stock_movements
            WHERE ref_type = 'sale' AND ref_id = v_sale AND product_id = v_prod2 AND delta = -1) THEN
        RAISE EXCEPTION 'teste 6: excluir não registrou a saída da peça devolvida em stock_movements';
      END IF;
    END IF;
  ELSE
    RAISE NOTICE 'teste 6 pulado: a loja só tem uma peça';
  END IF;

  -- ── 7. Editar: devolve o estoque antigo e baixa o novo, mesmo id ──────────
  v_p := jsonb_set(jsonb_set(v_p, '{client_request_id}', to_jsonb(gen_random_uuid())), '{exchange}', 'null');
  v_r := fv.salvar_venda(v_p);
  v_sale := (v_r->>'sale_id')::uuid;
  v_r2 := fv.editar_venda(jsonb_set(
    jsonb_set(v_p, '{items,0,quantity}', '1') || jsonb_build_object('sale_id', v_sale),
    '{items,0,subtotal}', '100'));
  IF (v_r2->>'sale_id')::uuid IS DISTINCT FROM v_sale THEN
    RAISE EXCEPTION 'teste 7: editar_venda falhou: %', v_r2;
  END IF;
  SELECT quantity_in_stock INTO v_est FROM fv.products WHERE id = v_prod;
  IF v_est <> v_est0 - 1 THEN
    RAISE EXCEPTION 'teste 7: estoque após editar 2→1 deveria ser %, está %', v_est0 - 1, v_est;
  END IF;
  SELECT count(*) INTO v_n FROM fv.sale_payments WHERE sale_id = v_sale;
  IF v_n <> 2 THEN RAISE EXCEPTION 'teste 7: editar duplicou/perdeu pagamentos (%)', v_n; END IF;
  SELECT count(*) INTO v_n FROM fv.transactions WHERE reference_type = 'sale' AND reference_id = v_sale;
  IF v_n <> 2 THEN RAISE EXCEPTION 'teste 7: editar duplicou/perdeu o financeiro (%)', v_n; END IF;
  IF v_est0 - 2 >= 0 AND NOT EXISTS (
       SELECT 1 FROM fv.stock_movements
        WHERE ref_type = 'sale' AND ref_id = v_sale AND product_id = v_prod
          AND reason = 'venda_editada' AND delta = 2) THEN
    RAISE EXCEPTION 'teste 7: editar_venda não registrou a devolução da venda antiga em stock_movements';
  END IF;

  IF (fv.editar_venda(v_p || jsonb_build_object('sale_id', gen_random_uuid()))->>'erro') IS DISTINCT FROM 'nao_encontrada' THEN
    RAISE EXCEPTION 'teste 7: editar venda inexistente deveria devolver nao_encontrada';
  END IF;

  RAISE NOTICE 'venda transacional: OK';
END;
$$;

ROLLBACK;
