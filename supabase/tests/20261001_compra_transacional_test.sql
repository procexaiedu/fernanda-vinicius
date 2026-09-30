-- ============================================================================
-- Teste de fumaça: 20261001_compra_transacional.sql
-- ============================================================================
--
-- Roda DENTRO de uma transação e termina em ROLLBACK: nada persiste (nem as
-- peças, nem o fornecedor novo, nem a sequência de etiqueta — essa avança,
-- porque sequência não volta em rollback, e isso é esperado).
--
-- Usa dados reais por subquery: uma loja ativa, um fornecedor ativo, um
-- usuário admin e uma peça ativa (não serviço) para o caso "reusar peça".
--
-- Como rodar (psql, como postgres, DEPOIS de aplicar a migration):
--   psql ... -v ON_ERROR_STOP=1 -f supabase/tests/20261001_compra_transacional_test.sql
-- Sucesso = termina com "ROLLBACK" e os NOTICE "ok: ...". Qualquer falha é um
-- RAISE EXCEPTION com o que quebrou.
-- ============================================================================

BEGIN;

-- As funções são chamadas como o app chama: service_role.
SET LOCAL ROLE service_role;

CREATE TEMP TABLE _ctx ON COMMIT DROP AS
SELECT
  (SELECT id FROM fv.stores    WHERE is_active ORDER BY created_at LIMIT 1)              AS loja,
  (SELECT id FROM fv.suppliers WHERE is_active ORDER BY created_at LIMIT 1)              AS fornecedor,
  (SELECT id FROM fv.users     WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1) AS usuario,
  -- Peça SEM venda nenhuma: excluir_compra recusa (de propósito) compra com
  -- peça que já vendeu — com uma peça antiga de verdade o teste da exclusão
  -- esbarrava nessa trava.
  (SELECT pr.id FROM fv.products pr
    WHERE pr.is_active AND NOT pr.is_service
      AND NOT EXISTS (SELECT 1 FROM fv.sale_items si WHERE si.product_id = pr.id)
    ORDER BY pr.created_at LIMIT 1)                                                        AS peca_reusada,
  gen_random_uuid()                                                                        AS req,
  gen_random_uuid()                                                                        AS req_consig,
  NULL::uuid AS compra,
  NULL::uuid AS compra_consig,
  NULL::uuid AS lote,
  NULL::integer AS estoque_antes;

UPDATE _ctx SET estoque_antes = (SELECT quantity_in_stock FROM fv.products WHERE id = _ctx.peca_reusada);

DO $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM _ctx;
  IF c.loja IS NULL OR c.fornecedor IS NULL OR c.usuario IS NULL OR c.peca_reusada IS NULL THEN
    RAISE EXCEPTION 'pré-condição: precisa de loja ativa, fornecedor ativo, admin ativo e uma peça ativa (%).', row_to_json(c);
  END IF;
END $$;

-- ── 1. Compra própria: 1 peça nova (fornecedor existente), 1 reusada,
--       1 peça nova de fornecedor NOVO; crédito 2x + pix ─────────────────────
CREATE TEMP TABLE _payload ON COMMIT DROP AS
SELECT jsonb_build_object(
  'client_request_id', c.req,
  'user_id',           c.usuario,
  'purchase_date',     '2026-10-01',
  'is_consignment',    false,
  'fornecedores_novos', jsonb_build_array(jsonb_build_object('name', 'Fornecedor Teste Transacional', 'initials', 'ZZ')),
  'linhas', jsonb_build_array(
    jsonb_build_object('product_id', NULL, 'supplier_id', c.fornecedor, 'supplier_novo', NULL,
      'code', 'FXX1010', 'name', 'Colar teste transacional', 'category', 'colar', 'material', 'prata',
      'store_id', c.loja, 'cost_price', 10, 'sale_price', 30, 'promotional_price', NULL,
      'quantity', 3, 'label_format', 'B', 'purchase_month', 10, 'purchase_year', 2026),
    jsonb_build_object('product_id', c.peca_reusada, 'supplier_id', c.fornecedor, 'supplier_novo', NULL,
      'code', 'FXX1020', 'name', 'Peça reusada', 'category', 'anel', 'material', 'prata',
      'store_id', c.loja, 'cost_price', 20, 'sale_price', 50, 'promotional_price', NULL,
      'quantity', 2, 'label_format', 'A', 'purchase_month', 10, 'purchase_year', 2026),
    jsonb_build_object('product_id', NULL, 'supplier_id', NULL, 'supplier_novo', 0,
      'code', 'FZZ105', 'name', 'Brinco teste transacional', 'category', 'brinco', 'material', 'banhado',
      'store_id', c.loja, 'cost_price', 5, 'sale_price', 15, 'promotional_price', 12,
      'quantity', 1, 'label_format', 'B', 'purchase_month', 10, 'purchase_year', 2026)
  ),
  'consignacao', NULL,
  'compra', jsonb_build_object('total_cost', 75, 'total_items', 6, 'nf_number', 'NF-TESTE', 'nf_url', NULL, 'notes', 'teste transacional'),
  'pagamentos', jsonb_build_array(
    jsonb_build_object('supplier_id', c.fornecedor, 'supplier_novo', NULL, 'payment_method', 'credit',
      'amount', 35, 'installment_number', 1, 'due_date', '2026-10-10', 'status', 'pending', 'description', 'Compra — Crédito 1/2'),
    jsonb_build_object('supplier_id', c.fornecedor, 'supplier_novo', NULL, 'payment_method', 'credit',
      'amount', 35, 'installment_number', 2, 'due_date', '2026-11-10', 'status', 'pending', 'description', 'Compra — Crédito 2/2'),
    jsonb_build_object('supplier_id', NULL, 'supplier_novo', 0, 'payment_method', 'pix',
      'amount', 5, 'installment_number', NULL, 'due_date', NULL, 'status', 'completed', 'description', 'Compra')
  )
) AS p
FROM _ctx c;

DO $$
DECLARE
  c        record;
  r        jsonb;
  v_compra uuid;
  v_n      integer;
  v_sup    uuid;
BEGIN
  SELECT * INTO c FROM _ctx;
  r := fv.salvar_compra((SELECT p FROM _payload));

  IF (r->>'ja_existia')::boolean IS DISTINCT FROM false OR r->>'purchase_id' IS NULL THEN
    RAISE EXCEPTION 'salvar_compra: resposta inesperada %', r;
  END IF;
  v_compra := (r->>'purchase_id')::uuid;
  UPDATE _ctx SET compra = v_compra;

  -- cabeçalho
  PERFORM 1 FROM fv.purchases
   WHERE id = v_compra AND client_request_id = c.req AND total_cost = 75 AND total_items = 6
     AND consignment_id IS NULL AND nf_number = 'NF-TESTE' AND user_id = c.usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'cabeçalho da compra errado'; END IF;

  -- peças novas: 2, com purchase_id, etiqueta da sequência, ownership own
  SELECT count(*) INTO v_n FROM fv.products
   WHERE purchase_id = v_compra AND ownership_type = 'own' AND barcode_number IS NOT NULL
     AND label_format = 'B';   -- DEFAULT, como antes
  IF v_n <> 2 THEN RAISE EXCEPTION 'esperava 2 peças novas ligadas à compra, achei %', v_n; END IF;

  -- fornecedor novo criado e usado na peça nova
  SELECT supplier_id INTO v_sup FROM fv.products WHERE purchase_id = v_compra AND code = 'FZZ105';
  PERFORM 1 FROM fv.suppliers WHERE id = v_sup AND name = 'Fornecedor Teste Transacional' AND initials = 'ZZ';
  IF NOT FOUND THEN RAISE EXCEPTION 'fornecedor novo não foi criado/ligado'; END IF;

  -- estoque da peça reusada somado (atômico) e purchase_id dela NÃO trocado
  PERFORM 1 FROM fv.products
   WHERE id = c.peca_reusada AND quantity_in_stock = c.estoque_antes + 2
     AND purchase_id IS DISTINCT FROM v_compra;
  IF NOT FOUND THEN RAISE EXCEPTION 'estoque da peça reusada não somou 2 (ou purchase_id foi trocado)'; END IF;

  -- itens: 3, na ordem, subtotal = custo × qtd
  SELECT count(*) INTO v_n FROM fv.purchase_items WHERE purchase_id = v_compra;
  IF v_n <> 3 THEN RAISE EXCEPTION 'esperava 3 itens, achei %', v_n; END IF;
  PERFORM 1 FROM fv.purchase_items WHERE purchase_id = v_compra AND product_id = c.peca_reusada
     AND quantity = 2 AND unit_cost = 20 AND subtotal = 40 AND label_format = 'A';
  IF NOT FOUND THEN RAISE EXCEPTION 'item da peça reusada errado'; END IF;

  -- pagamentos: 3 (2 parcelas + pix), pix pago com paid_at, parcelas pendentes sem
  SELECT count(*) INTO v_n FROM fv.purchase_payments WHERE purchase_id = v_compra;
  IF v_n <> 3 THEN RAISE EXCEPTION 'esperava 3 pagamentos, achei %', v_n; END IF;
  PERFORM 1 FROM fv.purchase_payments WHERE purchase_id = v_compra AND payment_method = 'pix'
     AND status = 'completed' AND paid_at IS NOT NULL AND supplier_id = v_sup;
  IF NOT FOUND THEN RAISE EXCEPTION 'pagamento pix (fornecedor novo) errado'; END IF;
  SELECT count(*) INTO v_n FROM fv.purchase_payments WHERE purchase_id = v_compra
     AND status = 'pending' AND paid_at IS NULL AND installment_number IN (1, 2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'parcelas pendentes erradas (%)', v_n; END IF;

  -- financeiro: 3 despesas ligadas à compra
  SELECT count(*) INTO v_n FROM fv.transactions
   WHERE reference_type = 'purchase' AND reference_id = v_compra AND type = 'expense'
     AND category = 'compra_fornecedor' AND transaction_date = '2026-10-01' AND store_id IS NULL;
  IF v_n <> 3 THEN RAISE EXCEPTION 'esperava 3 despesas, achei %', v_n; END IF;

  RAISE NOTICE 'ok: salvar_compra (compra própria) gravou tudo';
END $$;

-- ── 2. Reenvio com o MESMO client_request_id: não duplica ────────────────────
DO $$
DECLARE
  c record;
  r jsonb;
  v_n integer;
BEGIN
  SELECT * INTO c FROM _ctx;
  r := fv.salvar_compra((SELECT p FROM _payload));

  IF (r->>'ja_existia')::boolean IS DISTINCT FROM true
     OR (r->>'purchase_id')::uuid <> c.compra
     OR (r->>'incompleta')::boolean THEN
    RAISE EXCEPTION 'reenvio: esperava ja_existia=true com a mesma compra, veio %', r;
  END IF;

  SELECT count(*) INTO v_n FROM fv.purchases WHERE client_request_id = c.req;
  IF v_n <> 1 THEN RAISE EXCEPTION 'reenvio duplicou a compra (%)', v_n; END IF;
  SELECT count(*) INTO v_n FROM fv.products WHERE purchase_id = c.compra;
  IF v_n <> 2 THEN RAISE EXCEPTION 'reenvio duplicou peças (%)', v_n; END IF;
  PERFORM 1 FROM fv.products WHERE id = c.peca_reusada AND quantity_in_stock = c.estoque_antes + 2;
  IF NOT FOUND THEN RAISE EXCEPTION 'reenvio somou o estoque de novo'; END IF;
  SELECT count(*) INTO v_n FROM fv.suppliers WHERE name = 'Fornecedor Teste Transacional';
  IF v_n <> 1 THEN RAISE EXCEPTION 'reenvio duplicou o fornecedor novo (%)', v_n; END IF;

  RAISE NOTICE 'ok: reenvio reconhecido, nada duplicado';
END $$;

-- ── 3. MESMO id com OUTRA compra (total diferente): erro, nada gravado ───────
DO $$
DECLARE
  c record;
  r jsonb;
  v_antes integer;
  v_depois integer;
BEGIN
  SELECT * INTO c FROM _ctx;
  SELECT count(*) INTO v_antes FROM fv.products;

  r := fv.salvar_compra(jsonb_set((SELECT p FROM _payload), '{compra,total_cost}', '999'));

  IF r->>'erro' IS DISTINCT FROM 'id_reusado' THEN
    RAISE EXCEPTION 'id reusado: esperava erro=id_reusado, veio %', r;
  END IF;
  SELECT count(*) INTO v_depois FROM fv.products;
  IF v_depois <> v_antes THEN RAISE EXCEPTION 'id reusado gravou peças'; END IF;

  RAISE NOTICE 'ok: id reusado com total diferente devolve erro sem gravar';
END $$;

-- ── 4. Falha no meio desfaz TUDO (peça reusada que não existe) ───────────────
DO $$
DECLARE
  c record;
  v_antes_p integer; v_antes_c integer;
  v_ok boolean := false;
BEGIN
  SELECT * INTO c FROM _ctx;
  SELECT count(*) INTO v_antes_p FROM fv.products;
  SELECT count(*) INTO v_antes_c FROM fv.purchases;
  BEGIN
    PERFORM fv.salvar_compra(
      jsonb_set(
        jsonb_set((SELECT p FROM _payload), '{client_request_id}', to_jsonb(gen_random_uuid())),
        '{linhas,1,product_id}', to_jsonb(gen_random_uuid())
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'peça inexistente não abortou a compra'; END IF;
  IF (SELECT count(*) FROM fv.products) <> v_antes_p OR (SELECT count(*) FROM fv.purchases) <> v_antes_c THEN
    RAISE EXCEPTION 'falha no meio deixou peça ou compra gravada';
  END IF;
  RAISE NOTICE 'ok: erro no meio = rollback total';
END $$;

-- ── 5. Consignação: lote + compra + peça consignada, sem pagamento ───────────
DO $$
DECLARE
  c record;
  r jsonb;
  v_compra uuid;
  v_lote   uuid;
  v_n      integer;
BEGIN
  SELECT * INTO c FROM _ctx;
  r := fv.salvar_compra(jsonb_build_object(
    'client_request_id', c.req_consig,
    'user_id',           c.usuario,
    'purchase_date',     '2026-10-01',
    'is_consignment',    true,
    'fornecedores_novos', '[]'::jsonb,
    'linhas', jsonb_build_array(
      jsonb_build_object('product_id', NULL, 'supplier_id', c.fornecedor, 'supplier_novo', NULL,
        'code', 'FXX10100', 'name', 'Pulseira consignada teste', 'category', 'pulseira', 'material', 'prata',
        'store_id', c.loja, 'cost_price', 100, 'sale_price', 250, 'promotional_price', NULL,
        'quantity', 2, 'label_format', 'B', 'purchase_month', 10, 'purchase_year', 2026)
    ),
    'consignacao', jsonb_build_object('supplier_id', c.fornecedor, 'supplier_novo', NULL, 'store_id', c.loja,
      'return_deadline', '2026-12-01', 'min_purchase_pct', 30, 'total_pieces', 2, 'total_cost_value', 200),
    'compra', jsonb_build_object('total_cost', 200, 'total_items', 2, 'nf_number', NULL, 'nf_url', NULL, 'notes', NULL),
    -- Sobrou pagamento na tela: consignação NÃO grava.
    'pagamentos', jsonb_build_array(jsonb_build_object('supplier_id', c.fornecedor, 'payment_method', 'pix',
      'amount', 200, 'status', 'completed', 'description', 'Compra'))
  ));

  v_compra := (r->>'purchase_id')::uuid;
  v_lote   := (r->>'consignment_id')::uuid;
  IF v_compra IS NULL OR v_lote IS NULL THEN RAISE EXCEPTION 'consignação: resposta inesperada %', r; END IF;
  UPDATE _ctx SET compra_consig = v_compra, lote = v_lote;

  PERFORM 1 FROM fv.consignments WHERE id = v_lote AND status = 'active' AND total_cost_value = 200
     AND total_pieces = 2 AND supplier_id = c.fornecedor AND store_id = c.loja;
  IF NOT FOUND THEN RAISE EXCEPTION 'lote consignado errado'; END IF;
  PERFORM 1 FROM fv.purchases WHERE id = v_compra AND consignment_id = v_lote;
  IF NOT FOUND THEN RAISE EXCEPTION 'compra do lote sem consignment_id'; END IF;
  PERFORM 1 FROM fv.products WHERE purchase_id = v_compra AND consignment_id = v_lote AND ownership_type = 'consignment';
  IF NOT FOUND THEN RAISE EXCEPTION 'peça consignada sem lote/ownership'; END IF;
  SELECT count(*) INTO v_n FROM fv.purchase_payments WHERE purchase_id = v_compra;
  IF v_n <> 0 THEN RAISE EXCEPTION 'consignação gravou pagamento'; END IF;
  SELECT count(*) INTO v_n FROM fv.transactions WHERE reference_id = v_compra;
  IF v_n <> 0 THEN RAISE EXCEPTION 'consignação gravou despesa'; END IF;

  RAISE NOTICE 'ok: consignação gravou lote + compra, sem pagamento';
END $$;

-- ── 6. Acertos: trava de saldo, fecha e reabre o lote ────────────────────────
DO $$
DECLARE
  c record;
  r jsonb;
  v_acerto uuid;
  v_tx uuid;
BEGIN
  SELECT * INTO c FROM _ctx;

  r := fv.registrar_acerto(jsonb_build_object('consignment_id', c.lote, 'user_id', c.usuario,
         'acerto_date', '2026-10-05', 'amount', 250, 'payment_method', 'pix'));
  IF r->>'erro' IS DISTINCT FROM 'acima_do_saldo' OR (r->>'falta')::numeric <> 200 THEN
    RAISE EXCEPTION 'acerto acima do saldo passou: %', r;
  END IF;

  r := fv.registrar_acerto(jsonb_build_object('consignment_id', c.lote, 'user_id', c.usuario,
         'acerto_date', '2026-10-05', 'amount', 120, 'payment_method', 'pix', 'notes', ' parcial '));
  IF NOT (r->>'ok')::boolean OR r->>'status' <> 'active' THEN RAISE EXCEPTION 'acerto parcial: %', r; END IF;

  r := fv.registrar_acerto(jsonb_build_object('consignment_id', c.lote, 'user_id', c.usuario,
         'acerto_date', '2026-10-06', 'amount', 80.01, 'payment_method', 'pix'));
  IF r->>'erro' IS DISTINCT FROM 'acima_do_saldo' THEN
    -- 80,01 contra 80,00 está dentro da tolerância de 1 centavo (mesma regra do TS).
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'tolerância de 1 centavo: %', r; END IF;
    -- desfaz para seguir com número redondo
    PERFORM fv.remover_acerto((r->>'acerto_id')::uuid);
  END IF;

  r := fv.registrar_acerto(jsonb_build_object('consignment_id', c.lote, 'user_id', c.usuario,
         'acerto_date', '2026-10-06', 'amount', 80, 'payment_method', 'cash'));
  IF NOT (r->>'ok')::boolean OR r->>'status' <> 'settled' THEN RAISE EXCEPTION 'acerto que quita: %', r; END IF;
  v_acerto := (r->>'acerto_id')::uuid;
  v_tx     := (r->>'transaction_id')::uuid;

  PERFORM 1 FROM fv.consignments WHERE id = c.lote AND status = 'settled' AND settled_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'lote não fechou'; END IF;
  PERFORM 1 FROM fv.transactions WHERE id = v_tx AND reference_type = 'consignment'
     AND reference_id = c.lote AND category = 'acerto_consignacao' AND store_id = c.loja AND amount = 80;
  IF NOT FOUND THEN RAISE EXCEPTION 'despesa do acerto errada'; END IF;

  r := fv.remover_acerto(v_acerto);
  IF NOT (r->>'ok')::boolean OR r->>'status' <> 'active' THEN RAISE EXCEPTION 'remover acerto: %', r; END IF;
  PERFORM 1 FROM fv.transactions WHERE id = v_tx;
  IF FOUND THEN RAISE EXCEPTION 'remover acerto deixou a despesa'; END IF;
  PERFORM 1 FROM fv.consignments WHERE id = c.lote AND status = 'active' AND settled_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'lote não reabriu'; END IF;

  r := fv.remover_acerto(v_acerto);
  IF r->>'erro' IS DISTINCT FROM 'nao_encontrado' THEN RAISE EXCEPTION 'remover 2x: %', r; END IF;

  RAISE NOTICE 'ok: acertos com trava de saldo, fecha e reabre o lote';
END $$;

-- ── 7. Editar: quantidade da consignação 2 → 3 soma 1 no estoque ─────────────
DO $$
DECLARE
  c record;
  v_item record;
  v_ok boolean := false;
BEGIN
  SELECT * INTO c FROM _ctx;
  SELECT pi.id, pi.product_id, pr.quantity_in_stock AS estoque
    INTO v_item
    FROM fv.purchase_items pi JOIN fv.products pr ON pr.id = pi.product_id
   WHERE pi.purchase_id = c.compra_consig;

  -- quantidade_original errada (outra edição no meio) → aborta
  BEGIN
    PERFORM fv.editar_compra(jsonb_build_object(
      'purchase_id', c.compra_consig, 'user_id', c.usuario, 'purchase_date', '2026-10-01',
      'itens', jsonb_build_array(jsonb_build_object(
        'purchase_item_id', v_item.id, 'product_id', v_item.product_id, 'quantidade_original', 5,
        'quantity', 3, 'name', 'x', 'category', 'pulseira', 'material', 'prata', 'cost_price', 100,
        'sale_price', 250, 'label_format', 'B', 'supplier_id', c.fornecedor, 'store_id', c.loja)),
      'pagamentos', '[]'::jsonb, 'despesas', '[]'::jsonb, 'despesas_remover', '[]'::jsonb));
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'editar com quantidade_original velha não abortou'; END IF;

  PERFORM fv.editar_compra(jsonb_build_object(
    'purchase_id', c.compra_consig, 'user_id', c.usuario, 'purchase_date', '2026-10-02',
    'notes', 'editada', 'nf_number', NULL,
    'itens', jsonb_build_array(jsonb_build_object(
      'purchase_item_id', v_item.id, 'product_id', v_item.product_id, 'quantidade_original', 2,
      'quantity', 3, 'name', 'Pulseira consignada editada', 'category', 'pulseira', 'material', 'prata',
      'cost_price', 100, 'sale_price', 260, 'promotional_price', NULL, 'label_format', 'A',
      'supplier_id', c.fornecedor, 'store_id', c.loja)),
    'pagamentos', '[]'::jsonb, 'despesas', '[]'::jsonb, 'despesas_remover', '[]'::jsonb));

  PERFORM 1 FROM fv.products WHERE id = v_item.product_id AND quantity_in_stock = v_item.estoque + 1
     AND name = 'Pulseira consignada editada' AND sale_price = 260 AND label_format = 'A';
  IF NOT FOUND THEN RAISE EXCEPTION 'edição não somou 1 no estoque / não atualizou a peça'; END IF;
  PERFORM 1 FROM fv.stock_movements WHERE product_id = v_item.product_id AND ref_type = 'purchase'
     AND ref_id = c.compra_consig AND reason = 'compra_editada' AND delta = 1
     AND quantity_before = v_item.estoque AND quantity_after = v_item.estoque + 1 AND user_id = c.usuario;
  IF NOT FOUND THEN RAISE EXCEPTION 'edição não deixou rastro em stock_movements'; END IF;
  PERFORM 1 FROM fv.purchases WHERE id = c.compra_consig AND total_cost = 300 AND total_items = 3
     AND purchase_date = '2026-10-02' AND notes = 'editada';
  IF NOT FOUND THEN RAISE EXCEPTION 'edição não refez os totais/cabeçalho'; END IF;

  RAISE NOTICE 'ok: editar_compra';
END $$;

-- ── 8. Excluir a compra própria: estorna, apaga tudo ─────────────────────────
DO $$
DECLARE
  c record;
  r jsonb;
  v_n integer;
BEGIN
  SELECT * INTO c FROM _ctx;
  r := fv.excluir_compra(c.compra, c.usuario);
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN RAISE EXCEPTION 'excluir_compra: %', r; END IF;

  PERFORM 1 FROM fv.purchases WHERE id = c.compra;
  IF FOUND THEN RAISE EXCEPTION 'cabeçalho não saiu'; END IF;
  SELECT count(*) INTO v_n FROM fv.transactions WHERE reference_type = 'purchase' AND reference_id = c.compra;
  IF v_n <> 0 THEN RAISE EXCEPTION 'despesas ficaram (%)', v_n; END IF;
  SELECT count(*) INTO v_n FROM fv.purchase_payments WHERE purchase_id = c.compra;
  IF v_n <> 0 THEN RAISE EXCEPTION 'pagamentos ficaram'; END IF;
  SELECT count(*) INTO v_n FROM fv.purchase_items WHERE purchase_id = c.compra;
  IF v_n <> 0 THEN RAISE EXCEPTION 'itens ficaram'; END IF;
  PERFORM 1 FROM fv.products WHERE id = c.peca_reusada AND quantity_in_stock = c.estoque_antes;
  IF NOT FOUND THEN RAISE EXCEPTION 'estoque da peça reusada não voltou'; END IF;
  -- rastro: peça reusada (−2) e as 2 novas (−3 e −1), todas com ref da compra
  SELECT count(*) INTO v_n FROM fv.stock_movements
   WHERE ref_type = 'purchase' AND ref_id = c.compra AND reason = 'compra_excluida' AND user_id = c.usuario;
  IF v_n <> 3 THEN RAISE EXCEPTION 'exclusão: esperava 3 linhas em stock_movements, achei %', v_n; END IF;
  PERFORM 1 FROM fv.stock_movements WHERE ref_id = c.compra AND product_id = c.peca_reusada
     AND delta = -2 AND quantity_after = c.estoque_antes;
  IF NOT FOUND THEN RAISE EXCEPTION 'exclusão: rastro da peça reusada errado'; END IF;
  -- peças novas ficam (como antes), sem purchase_id e com estoque 0
  SELECT count(*) INTO v_n FROM fv.products WHERE code IN ('FXX1010', 'FZZ105')
     AND name LIKE '% teste transacional' AND purchase_id IS NULL AND quantity_in_stock = 0;
  IF v_n <> 2 THEN RAISE EXCEPTION 'peças novas não foram estornadas/desligadas (%)', v_n; END IF;

  r := fv.excluir_compra(c.compra, c.usuario);
  IF r->>'erro' IS DISTINCT FROM 'nao_encontrada' THEN RAISE EXCEPTION 'excluir 2x: %', r; END IF;

  RAISE NOTICE 'ok: excluir_compra';
END $$;

-- ── 9. anon/authenticated não executam ───────────────────────────────────────
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon', 'fv.salvar_compra(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'fv.salvar_compra(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'fv.excluir_compra(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'fv.editar_compra(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'fv.registrar_acerto(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'fv.remover_acerto(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated conseguem executar as funções de compra';
  END IF;
  IF NOT has_function_privilege('service_role', 'fv.salvar_compra(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem EXECUTE em salvar_compra';
  END IF;
  RAISE NOTICE 'ok: permissões';
END $$;

ROLLBACK;
