-- ============================================================================
-- Teste das migrations 20261001_transferencia_idempotente e
-- 20261001_conferencia_segura.
--
-- Roda contra dados reais, dentro de BEGIN ... ROLLBACK: nada fica gravado.
-- Rodar só DEPOIS de aplicar as duas migrations. Qualquer ASSERT que falhar
-- aborta com a mensagem do caso; chegar ao fim imprime "OK" em cada NOTICE.
--
-- Pré-requisitos nos dados: 2 lojas; na loja de origem, 1 peça ativa com
-- estoque >= 1 para a transferência; numa loja SEM conferência aberta, 2 peças
-- ativas com estoque >= 1 (diferentes da transferida); 1 peça de outra loja;
-- 1 usuário em fv.users.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _t (chave text PRIMARY KEY, id uuid) ON COMMIT DROP;

-- ── Ids reais ───────────────────────────────────────────────────────────────

INSERT INTO _t VALUES ('usuario', (SELECT id FROM fv.users ORDER BY (role = 'admin') DESC, created_at LIMIT 1));

INSERT INTO _t VALUES ('peca_envio', (
  SELECT p.id FROM fv.products p
   WHERE p.is_active AND NOT p.is_service AND p.quantity_in_stock >= 1
     AND (SELECT count(*) FROM fv.stores) >= 2
   ORDER BY p.quantity_in_stock DESC, p.id
   LIMIT 1));
INSERT INTO _t VALUES ('loja_origem',  (SELECT store_id FROM fv.products WHERE id = (SELECT id FROM _t WHERE chave = 'peca_envio')));
INSERT INTO _t VALUES ('loja_destino', (SELECT id FROM fv.stores WHERE id <> (SELECT id FROM _t WHERE chave = 'loja_origem') ORDER BY id LIMIT 1));

-- Loja da conferência: sem sessão aberta (o índice único não deixa abrir outra).
INSERT INTO _t VALUES ('loja_conf', (
  SELECT p.store_id FROM fv.products p
   WHERE p.is_active AND NOT p.is_service AND p.quantity_in_stock >= 1
     AND p.id <> (SELECT id FROM _t WHERE chave = 'peca_envio')
     AND NOT EXISTS (SELECT 1 FROM fv.inventory_sessions s
                      WHERE s.store_id = p.store_id AND s.status = 'contando')
   GROUP BY p.store_id
  HAVING count(*) >= 2
   ORDER BY count(*) DESC
   LIMIT 1));
INSERT INTO _t VALUES ('peca_movida', (
  SELECT p.id FROM fv.products p
   WHERE p.store_id = (SELECT id FROM _t WHERE chave = 'loja_conf')
     AND p.is_active AND NOT p.is_service AND p.quantity_in_stock >= 1
     AND p.id <> (SELECT id FROM _t WHERE chave = 'peca_envio')
   ORDER BY p.id LIMIT 1));
INSERT INTO _t VALUES ('peca_parada', (
  SELECT p.id FROM fv.products p
   WHERE p.store_id = (SELECT id FROM _t WHERE chave = 'loja_conf')
     AND p.is_active AND NOT p.is_service AND p.quantity_in_stock >= 1
     AND p.id NOT IN (SELECT id FROM _t WHERE chave IN ('peca_envio', 'peca_movida'))
   ORDER BY p.id LIMIT 1));
INSERT INTO _t VALUES ('peca_outra_loja', (
  SELECT p.id FROM fv.products p
   WHERE p.store_id <> (SELECT id FROM _t WHERE chave = 'loja_conf')
     AND p.id <> (SELECT id FROM _t WHERE chave = 'peca_envio')
   ORDER BY p.id LIMIT 1));

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _t LOOP
    ASSERT r.id IS NOT NULL, format('Pré-requisito ausente nos dados: %s', r.chave);
  END LOOP;
  RAISE NOTICE 'OK — ids reais encontrados';
END $$;


-- ── PARTE A: enviar_transferencia idempotente ───────────────────────────────

DO $$
DECLARE
  v_user    uuid := (SELECT id FROM _t WHERE chave = 'usuario');
  v_peca    uuid := (SELECT id FROM _t WHERE chave = 'peca_envio');
  v_origem  uuid := (SELECT id FROM _t WHERE chave = 'loja_origem');
  v_destino uuid := (SELECT id FROM _t WHERE chave = 'loja_destino');
  v_req     uuid := gen_random_uuid();
  v_itens   jsonb;
  v_antes   integer;
  v_r1      json;
  v_r2      json;
  v_r3      json;
  v_n       integer;
BEGIN
  -- Só UMA função com esse nome: sem overload, chamada antiga não fica ambígua.
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE proname = 'enviar_transferencia' AND pronamespace = 'fv'::regnamespace;
  ASSERT v_n = 1, format('Esperava 1 fv.enviar_transferencia, há %s (overload)', v_n);

  -- Só o servidor (service_role) executa. anon e authenticated perderam o
  -- EXECUTE de propósito (20261002_fechar_acesso_anonimo): a função é
  -- SECURITY DEFINER e mexe no estoque de qualquer loja.
  ASSERT has_function_privilege('service_role',
    'fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid)', 'EXECUTE'),
    'service_role perdeu EXECUTE em enviar_transferencia';
  ASSERT NOT has_function_privilege('authenticated',
    'fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid)', 'EXECUTE'),
    'authenticated ainda executa enviar_transferencia (devia ter perdido)';
  ASSERT NOT has_function_privilege('anon',
    'fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid)', 'EXECUTE'),
    'anon ainda executa enviar_transferencia (devia ter perdido)';

  SELECT quantity_in_stock INTO v_antes FROM fv.products WHERE id = v_peca;
  v_itens := jsonb_build_array(jsonb_build_object('product_id', v_peca, 'quantity', 1));

  -- 1º envio
  v_r1 := fv.enviar_transferencia(
    p_from_store_id := v_origem, p_to_store_id := v_destino, p_itens := v_itens,
    p_user_id := v_user, p_notes := 'teste idempotencia', p_auto_receber := false,
    p_client_request_id := v_req);
  ASSERT (v_r1->>'success')::boolean, format('1º envio falhou: %s', v_r1);

  -- 2º envio, MESMO id (a resposta do primeiro "se perdeu")
  v_r2 := fv.enviar_transferencia(
    p_from_store_id := v_origem, p_to_store_id := v_destino, p_itens := v_itens,
    p_user_id := v_user, p_notes := 'teste idempotencia', p_auto_receber := false,
    p_client_request_id := v_req);
  ASSERT (v_r2->>'success')::boolean, format('2º envio (reenvio) falhou: %s', v_r2);
  ASSERT v_r2->>'transfer_id' = v_r1->>'transfer_id', 'Reenvio devolveu outro transfer_id';
  ASSERT (v_r2->>'repetido')::boolean, 'Reenvio não veio marcado como repetido';
  ASSERT (v_r2->>'pecas')::integer = (v_r1->>'pecas')::integer, 'Reenvio devolveu outro total de peças';

  SELECT count(*) INTO v_n FROM fv.transfers WHERE client_request_id = v_req;
  ASSERT v_n = 1, format('Esperava 1 romaneio com o id, há %s', v_n);

  SELECT count(*) INTO v_n FROM fv.transfer_items WHERE transfer_id = (v_r1->>'transfer_id')::uuid;
  ASSERT v_n = 1, format('Esperava 1 item no romaneio, há %s', v_n);

  SELECT count(*) INTO v_n FROM fv.stock_movements
   WHERE ref_type = 'transfer' AND ref_id = (v_r1->>'transfer_id')::uuid;
  ASSERT v_n = 1, format('Esperava 1 movimento de estoque, há %s', v_n);

  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = v_peca) = v_antes - 1,
    'Estoque da origem não caiu exatamente 1 (o reenvio tirou de novo?)';

  -- 3º envio: MESMO id, conteúdo DIFERENTE → recusa, sem sucesso falso.
  v_r3 := fv.enviar_transferencia(
    p_from_store_id := v_origem, p_to_store_id := v_destino,
    p_itens := jsonb_build_array(jsonb_build_object('product_id', v_peca, 'quantity', 2)),
    p_user_id := v_user, p_auto_receber := false, p_client_request_id := v_req);
  ASSERT NOT (v_r3->>'success')::boolean, 'Id repetido com outro conteúdo devolveu sucesso';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = v_peca) = v_antes - 1,
    'Recusa do id repetido mexeu no estoque';

  RAISE NOTICE 'OK — Parte A: reenvio não duplicou romaneio, itens, ledger nem estoque';
END $$;


-- ── PARTE B: close_inventory_session segura ─────────────────────────────────

DO $$
DECLARE
  v_user     uuid := (SELECT id FROM _t WHERE chave = 'usuario');
  v_loja     uuid := (SELECT id FROM _t WHERE chave = 'loja_conf');
  v_movida   uuid := (SELECT id FROM _t WHERE chave = 'peca_movida');
  v_parada   uuid := (SELECT id FROM _t WHERE chave = 'peca_parada');
  v_outra    uuid := (SELECT id FROM _t WHERE chave = 'peca_outra_loja');
  v_sessao   uuid;
  v_q_movida integer;
  v_q_parada integer;
  v_q_outra  integer;
  v_baixa    json;
  v_r        jsonb;
  v_n        integer;
BEGIN
  /*
   * Sessão de teste. `now()` é a hora de início da TRANSAÇÃO — tudo que for
   * gravado daqui para frente com default now() tem exatamente esse instante.
   * Por isso started_at fica 1 ms antes: o movimento simulado abaixo cai
   * "depois do início da contagem".
   */
  INSERT INTO fv.inventory_sessions (store_id, scope_type, scope_product_ids, user_id, started_at)
  VALUES (v_loja, 'loja', ARRAY[v_movida, v_parada], v_user, now() - interval '1 millisecond')
  RETURNING id INTO v_sessao;

  -- Simula uma baixa (movimento de estoque) na peça durante a contagem.
  v_baixa := fv.baixar_estoque(v_movida, 1, 'perda', v_user, 'teste conferencia');
  ASSERT (v_baixa->>'success')::boolean, format('Baixa de teste falhou: %s', v_baixa);

  SELECT quantity_in_stock INTO v_q_movida FROM fv.products WHERE id = v_movida;
  SELECT quantity_in_stock INTO v_q_parada FROM fv.products WHERE id = v_parada;
  SELECT quantity_in_stock INTO v_q_outra  FROM fv.products WHERE id = v_outra;

  -- (1) Quantidade negativa no meio da lista: nada gravado, sessão aberta.
  v_r := fv.close_inventory_session(v_sessao,
    jsonb_build_array(
      jsonb_build_object('product_id', v_parada, 'new_quantity', v_q_parada + 1, 'reason', 'contagem'),
      jsonb_build_object('product_id', v_parada, 'new_quantity', -1,             'reason', 'contagem')),
    '{}'::jsonb, v_user);
  ASSERT NOT (v_r->>'success')::boolean, 'Quantidade negativa foi aceita';
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = v_parada) = v_q_parada,
    'Negativo no meio da lista deixou ajuste parcial gravado';
  ASSERT (SELECT status FROM fv.inventory_sessions WHERE id = v_sessao) = 'contando',
    'Sessão não continuou aberta depois do erro';
  SELECT count(*) INTO v_n FROM fv.stock_movements WHERE ref_type = 'inventory_session' AND ref_id = v_sessao;
  ASSERT v_n = 0, 'Erro deixou linha no ledger';

  -- (2) Fechamento de verdade: movida + parada + peça de outra loja.
  v_r := fv.close_inventory_session(v_sessao,
    jsonb_build_array(
      jsonb_build_object('product_id', v_movida, 'new_quantity', v_q_movida + 3, 'reason', 'contagem'),
      jsonb_build_object('product_id', v_parada, 'new_quantity', v_q_parada + 1, 'reason', 'contagem'),
      jsonb_build_object('product_id', v_outra,  'new_quantity', v_q_outra + 7,  'reason', 'contagem')),
    jsonb_build_object('bate', 0), v_user);
  ASSERT (v_r->>'success')::boolean, format('Fechamento falhou: %s', v_r);

  -- Peça que movimentou durante a contagem: NÃO ajustada, listada com motivo.
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = v_movida) = v_q_movida,
    'Peça com movimento durante a contagem foi ajustada (estoque fantasma)';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'nao_ajustados') e
                  WHERE (e->>'product_id')::uuid = v_movida AND e->>'motivo' = 'baixa'),
    format('Peça movida não veio em nao_ajustados com motivo baixa: %s', v_r->'nao_ajustados');

  -- Peça parada: ajustada como antes (absoluto + ledger).
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = v_parada) = v_q_parada + 1,
    'Peça sem movimento não foi ajustada';
  SELECT count(*) INTO v_n FROM fv.stock_movements
   WHERE ref_type = 'inventory_session' AND ref_id = v_sessao AND product_id = v_parada
     AND quantity_before = v_q_parada AND quantity_after = v_q_parada + 1;
  ASSERT v_n = 1, 'Ajuste da peça parada não gravou o ledger';

  -- Peça de outra loja: ignorada.
  ASSERT (SELECT quantity_in_stock FROM fv.products WHERE id = v_outra) = v_q_outra,
    'Peça de outra loja foi ajustada';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'ignorados') e
                  WHERE (e->>'product_id')::uuid = v_outra AND e->>'motivo' = 'outra_loja'),
    'Peça de outra loja não veio em ignorados';

  ASSERT (v_r->>'ajustes_aplicados')::integer = 1,
    format('Esperava 1 ajuste aplicado, veio %s', v_r->>'ajustes_aplicados');

  ASSERT (SELECT status FROM fv.inventory_sessions WHERE id = v_sessao) = 'fechada', 'Sessão não fechou';
  ASSERT (SELECT (totals->>'nao_ajustados')::integer FROM fv.inventory_sessions WHERE id = v_sessao) = 1,
    'totals.nao_ajustados não foi gravado';

  RAISE NOTICE 'OK — Parte B: movida não ajustada, parada ajustada, outra loja ignorada, negativo sem parcial';
END $$;

ROLLBACK;
