-- ============================================================================
-- Compra / consignação TRANSACIONAIS (01/10)
-- ============================================================================
--
-- POR QUÊ
--
-- `salvarCompra` fazia ~10 escritas separadas pelo PostgREST: fornecedores
-- novos → peças → estoque → lote consignado → compra → itens → vínculo da
-- peça → parcelas → financeiro. Sem transação, uma falha no meio deixava a
-- compra PELA METADE — e o pior caso era o mais comum de doer: peças criadas
-- (e estoque somado) sem a compra por trás. O reenvio não achava a compra
-- pelo `client_request_id` (ela não chegou a nascer) e criava as peças de
-- novo. Exclusão, edição e acerto de consignação tinham o mesmo formato.
--
--
-- PADRÃO: "TS CALCULA, SQL PERSISTE"
--
-- O TypeScript continua dono de TODA regra: permissão, validação de
-- pagamentos, reuso de fornecedor por nome normalizado, código da peça,
-- parcelamento, descrição da despesa. Ele monta um payload já RESOLVIDO e
-- chama UMA função. A função só grava — numa transação só. Qualquer erro
-- (constraint, FK, peça que sumiu, estoque que ficaria negativo) desfaz
-- tudo; a tela recebe a mensagem e NADA foi gravado.
--
-- O que depende do banco fica aqui dentro:
--   · `barcode_number` sai do DEFAULT da sequência `fv.products_barcode_seq`
--     na ordem das linhas (mesma ordem do INSERT em lote de antes);
--   · a soma de estoque é atômica (`quantity_in_stock = quantity_in_stock + x`),
--     não "saldo lido + x" — duas compras simultâneas da mesma peça somam as
--     duas;
--   · a idempotência (client_request_id) é conferida sob advisory lock, então
--     dois envios da MESMA compra enfileiram e o segundo devolve a primeira.
--
--
-- SEGURANÇA
--
-- Sem SECURITY DEFINER: rodam com os privilégios de quem chama. Só o
-- `service_role` (o client admin das server actions) executa. `anon` e
-- `authenticated` NÃO — a permissão (admin, loja do escopo) é conferida no
-- TypeScript antes da chamada, e expor a função ao JWT do navegador pularia
-- essa conferência.
--
--
-- ORDEM DE APLICAÇÃO
--
-- 1. Requer 20260930_idempotencia_salvamentos.sql (coluna
--    `purchases.client_request_id` + índice único parcial).
-- 2. Aplicar ESTA migration ANTES do deploy do código de 01/10 — o código novo
--    não tem fallback para o caminho antigo.
-- 3. Recarregar o cache de schema do PostgREST (o NOTIFY abaixo; pelo pooler
--    ele pode não chegar — nesse caso SIGUSR1 / restart no container
--    supabase_rest). Sem isso o `rpc()` responde PGRST202.
-- ============================================================================


-- ── Helper: status do lote consignado ───────────────────────────────────────
--
-- Mesma regra do `fecharSeQuitou` (compras/acertos.ts):
--   devido = total − devolvido (peças devolvidas à fornecedora, pelo ledger
--   `stock_movements` com motivo `devolucao_fornecedor`, a custo da peça)
--   · voltou TUDO          → returned
--   · pagou o que restava  → settled
--   · ainda deve           → active
-- Só grava se mudou. Chamada com o lote já travado (FOR UPDATE) por quem chama.

CREATE OR REPLACE FUNCTION fv.devolvido_da_consignacao(p_consignment_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = fv, pg_temp
AS $$
  SELECT round(COALESCE(sum(abs(m.delta) * COALESCE(pr.cost_price, 0)), 0), 2)
    FROM fv.stock_movements m
    JOIN fv.products pr ON pr.id = m.product_id
   WHERE pr.consignment_id = p_consignment_id
     AND m.reason = 'devolucao_fornecedor';
$$;

CREATE OR REPLACE FUNCTION fv.recalcular_status_consignacao(p_consignment_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_total     numeric;
  v_status    text;
  v_devolvido numeric;
  v_soma      numeric;
  v_devido    numeric;
  v_novo      text;
BEGIN
  SELECT total_cost_value, status INTO v_total, v_status
    FROM fv.consignments WHERE id = p_consignment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_devolvido := fv.devolvido_da_consignacao(p_consignment_id);
  SELECT COALESCE(sum(amount), 0) INTO v_soma
    FROM fv.consignment_acertos WHERE consignment_id = p_consignment_id;

  v_devido := v_total - v_devolvido;

  v_novo := CASE
    WHEN round(v_devido * 100) <= 1 AND round(v_total * 100) > 1 THEN 'returned'
    WHEN round(v_soma * 100) >= round(v_devido * 100) - 1          THEN 'settled'
    ELSE 'active'
  END;

  IF v_novo IS DISTINCT FROM v_status THEN
    UPDATE fv.consignments
       SET status     = v_novo,
           settled_at = CASE WHEN v_novo = 'settled' THEN now() ELSE NULL END,
           updated_at = now()
     WHERE id = p_consignment_id;
  END IF;

  RETURN v_novo;
END;
$$;


-- ── salvar_compra ────────────────────────────────────────────────────────────
--
-- p = {
--   client_request_id: uuid | null,
--   user_id:           uuid,
--   purchase_date:     'YYYY-MM-DD',
--   is_consignment:    bool,
--   fornecedores_novos: [{ name, initials }],            -- já decididos no TS
--   linhas: [{                                           -- 1 por linha da grade, NA ORDEM
--     product_id:  uuid | null,                          -- não nulo = reusa (soma estoque)
--     supplier_id: uuid | null, supplier_novo: int | null (índice em fornecedores_novos),
--     code, name, category, material, store_id,
--     cost_price, sale_price, promotional_price, quantity, label_format,
--     purchase_month, purchase_year
--   }],
--   consignacao: null | { supplier_id | supplier_novo, store_id, return_deadline,
--                         min_purchase_pct, total_pieces, total_cost_value },
--   compra: { total_cost, total_items, nf_number, nf_url, notes },
--   pagamentos: [{ supplier_id | supplier_novo, payment_method, amount,
--                  installment_number, due_date, status, description }]   -- 1 por parcela
-- }
--
-- Devolve:
--   { purchase_id, ja_existia: false, consignment_id, product_ids: [...] }
--   { purchase_id, ja_existia: true, itens, incompleta }   -- reenvio da mesma compra
--   { erro: 'id_reusado', purchase_id }                     -- id de OUTRA compra; nada gravado

CREATE OR REPLACE FUNCTION fv.salvar_compra(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_req        uuid := nullif(p->>'client_request_id', '')::uuid;
  v_user       uuid := (p->>'user_id')::uuid;
  v_data       date := (p->>'purchase_date')::date;
  v_consig     boolean := COALESCE((p->>'is_consignment')::boolean, false);
  v_linhas     jsonb := COALESCE(p->'linhas', '[]'::jsonb);
  v_compra     jsonb := COALESCE(p->'compra', '{}'::jsonb);
  v_n_linhas   integer;
  v_existente  record;
  v_n_itens    integer;
  v_novos      uuid[] := ARRAY[]::uuid[];
  v_f          jsonb;
  v_sup        uuid;
  v_cons_id    uuid;
  v_c          jsonb;
  v_purchase   uuid;
  v_l          jsonb;
  v_pid        uuid;
  v_ids        uuid[] := ARRAY[]::uuid[];
  v_pg         jsonb;
  v_status     text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'salvar_compra: user_id é obrigatório.';
  END IF;
  v_n_linhas := jsonb_array_length(v_linhas);
  IF v_n_linhas = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos um item.';
  END IF;

  -- ── 0. Idempotência ────────────────────────────────────────────────────────
  -- O advisory lock enfileira dois envios da MESMA compra (duas abas, rascunho
  -- recuperado durante o primeiro envio): o segundo espera o primeiro terminar
  -- e, em READ COMMITTED, o SELECT seguinte já enxerga a compra dele.
  IF v_req IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('fv.salvar_compra:' || v_req::text, 0));

    SELECT id, total_cost, total_items INTO v_existente
      FROM fv.purchases WHERE client_request_id = v_req;

    IF FOUND THEN
      SELECT count(*) INTO v_n_itens FROM fv.purchase_items WHERE purchase_id = v_existente.id;

      -- Mesma impressão digital do TS antigo: custo total, nº de peças, e não
      -- mais linhas gravadas que as enviadas.
      IF abs(COALESCE(v_existente.total_cost, 0) - COALESCE((v_compra->>'total_cost')::numeric, 0)) > 0.011
         OR COALESCE(v_existente.total_items, 0) <> COALESCE((v_compra->>'total_items')::integer, 0)
         OR v_n_itens > v_n_linhas
      THEN
        RETURN jsonb_build_object('erro', 'id_reusado', 'purchase_id', v_existente.id);
      END IF;

      RETURN jsonb_build_object(
        'purchase_id', v_existente.id,
        'ja_existia',  true,
        'itens',       v_n_itens,
        -- Só compra gravada ANTES desta função (caminho não transacional)
        -- pode estar incompleta.
        'incompleta',  v_n_itens < v_n_linhas
      );
    END IF;
  END IF;

  -- ── 1. Fornecedores novos (o TS já decidiu que não existem) ────────────────
  FOR v_f IN SELECT value FROM jsonb_array_elements(COALESCE(p->'fornecedores_novos', '[]'::jsonb))
  LOOP
    -- `phones` é NOT NULL sem DEFAULT no banco real: manda lista vazia.
    INSERT INTO fv.suppliers (name, initials, phones)
    VALUES (v_f->>'name', COALESCE(v_f->>'initials', ''), '[]'::jsonb)
    RETURNING id INTO v_sup;
    v_novos := v_novos || v_sup;
  END LOOP;

  -- ── 2. Lote consignado ─────────────────────────────────────────────────────
  IF v_consig THEN
    v_c := p->'consignacao';
    IF v_c IS NULL OR jsonb_typeof(v_c) <> 'object' THEN
      RAISE EXCEPTION 'Consignação sem os dados do lote.';
    END IF;

    v_sup := COALESCE(nullif(v_c->>'supplier_id', '')::uuid,
                      v_novos[(v_c->>'supplier_novo')::integer + 1]);

    INSERT INTO fv.consignments (
      supplier_id, store_id, user_id, received_date, return_deadline,
      min_purchase_pct, total_pieces, total_cost_value, status
    ) VALUES (
      v_sup,
      nullif(v_c->>'store_id', '')::uuid,
      v_user,
      v_data,
      nullif(v_c->>'return_deadline', '')::date,
      nullif(v_c->>'min_purchase_pct', '')::numeric,
      (v_c->>'total_pieces')::integer,
      (v_c->>'total_cost_value')::numeric,
      'active'
    )
    RETURNING id INTO v_cons_id;
  END IF;

  -- ── 3. Cabeçalho da compra ─────────────────────────────────────────────────
  -- Vem ANTES das peças para que a peça nova já nasça com `purchase_id`.
  INSERT INTO fv.purchases (
    supplier_id, store_id, user_id, purchase_date, total_cost, total_items,
    nf_number, nf_url, notes, consignment_id, client_request_id
  ) VALUES (
    NULL, NULL, v_user, v_data,
    (v_compra->>'total_cost')::numeric,
    (v_compra->>'total_items')::integer,
    nullif(v_compra->>'nf_number', ''),
    nullif(v_compra->>'nf_url', ''),
    nullif(v_compra->>'notes', ''),
    v_cons_id,
    v_req
  )
  RETURNING id INTO v_purchase;

  -- Trava as peças reusadas de uma vez, em ordem de id: duas compras (ou
  -- compra + venda) com as mesmas peças em ordem inversa não se travam.
  PERFORM 1
     FROM fv.products
    WHERE id IN (SELECT nullif(l->>'product_id', '')::uuid FROM jsonb_array_elements(v_linhas) l)
    ORDER BY id
      FOR UPDATE;

  -- ── 4. Peças (criar / reusar) + itens da compra, na ordem da grade ─────────
  FOR v_l IN SELECT value FROM jsonb_array_elements(v_linhas) WITH ORDINALITY AS t(value, ord) ORDER BY ord
  LOOP
    v_pid := nullif(v_l->>'product_id', '')::uuid;

    IF v_pid IS NULL THEN
      v_sup := COALESCE(nullif(v_l->>'supplier_id', '')::uuid,
                        v_novos[(v_l->>'supplier_novo')::integer + 1]);

      -- `barcode_number` e `label_format` ficam no DEFAULT, como antes.
      INSERT INTO fv.products (
        code, name, category, material, supplier_id, store_id,
        cost_price, sale_price, promotional_price, quantity_in_stock,
        ownership_type, purchase_month, purchase_year, is_active,
        consignment_id, purchase_id
      ) VALUES (
        v_l->>'code',
        v_l->>'name',
        v_l->>'category',
        v_l->>'material',
        v_sup,
        (v_l->>'store_id')::uuid,
        (v_l->>'cost_price')::numeric,
        (v_l->>'sale_price')::numeric,
        nullif(v_l->>'promotional_price', '')::numeric,
        (v_l->>'quantity')::integer,
        CASE WHEN v_consig THEN 'consignment' ELSE 'own' END,
        (v_l->>'purchase_month')::smallint,
        (v_l->>'purchase_year')::smallint,
        true,
        v_cons_id,
        v_purchase
      )
      RETURNING id INTO v_pid;
    ELSE
      -- Peça reusada: soma ATÔMICA. A mesma peça em duas linhas soma as duas.
      -- Não troca `purchase_id` (ela pertence à compra em que entrou primeiro).
      UPDATE fv.products
         SET quantity_in_stock = quantity_in_stock + (v_l->>'quantity')::integer,
             consignment_id    = CASE WHEN v_consig THEN v_cons_id ELSE consignment_id END,
             updated_at        = now()
       WHERE id = v_pid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A peça "%" não existe mais no cadastro. Recarregue a página e confira a linha.',
          v_l->>'name';
      END IF;
    END IF;

    v_ids := v_ids || v_pid;

    INSERT INTO fv.purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal, label_format)
    VALUES (
      v_purchase,
      v_pid,
      (v_l->>'quantity')::integer,
      (v_l->>'cost_price')::numeric,
      (v_l->>'cost_price')::numeric * (v_l->>'quantity')::integer,
      COALESCE(nullif(v_l->>'label_format', ''), 'A')
    );
  END LOOP;

  -- ── 5. Parcelas + despesas (compra própria; consignação vem vazia) ─────────
  IF NOT v_consig THEN
    FOR v_pg IN SELECT value FROM jsonb_array_elements(COALESCE(p->'pagamentos', '[]'::jsonb))
    LOOP
      v_sup := COALESCE(nullif(v_pg->>'supplier_id', '')::uuid,
                        v_novos[nullif(v_pg->>'supplier_novo', '')::integer + 1]);
      v_status := CASE WHEN v_pg->>'status' = 'pending' THEN 'pending' ELSE 'completed' END;

      INSERT INTO fv.purchase_payments (
        purchase_id, supplier_id, payment_method, amount, installment_number,
        due_date, status, paid_at
      ) VALUES (
        v_purchase, v_sup, v_pg->>'payment_method', (v_pg->>'amount')::numeric,
        nullif(v_pg->>'installment_number', '')::smallint,
        nullif(v_pg->>'due_date', '')::date,
        v_status,
        CASE WHEN v_status = 'completed' THEN now() END
      );

      INSERT INTO fv.transactions (
        store_id, type, amount, category, description, reference_type, reference_id,
        user_id, payment_method, transaction_date, due_date, status, paid_at
      ) VALUES (
        NULL, 'expense', (v_pg->>'amount')::numeric, 'compra_fornecedor',
        v_pg->>'description', 'purchase', v_purchase,
        v_user, v_pg->>'payment_method', v_data,
        nullif(v_pg->>'due_date', '')::date,
        v_status,
        CASE WHEN v_status = 'completed' THEN now() END
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'purchase_id',    v_purchase,
    'ja_existia',     false,
    'consignment_id', v_cons_id,
    'product_ids',    to_jsonb(v_ids)
  );
END;
$$;

COMMENT ON FUNCTION fv.salvar_compra(jsonb) IS
  'Grava uma compra/consignação inteira numa transação (fornecedores novos, lote, compra, peças, estoque, itens, parcelas, despesas). O TS calcula e valida; aqui só persiste. Idempotente por client_request_id. Desde 01/10/2026.';


-- ── excluir_compra ───────────────────────────────────────────────────────────
--
-- Devolve { ok: true } | { erro: 'nao_encontrada' } | { erro: 'tem_venda', pecas: [nomes] }.
-- Tudo ou nada: financeiro, parcelas, vínculo das peças, itens, estorno do
-- estoque (nunca abaixo de zero, como antes) e cabeçalho.
--
-- RASTRO: cada peça cujo estoque muda ganha uma linha em `fv.stock_movements`
-- (ref_type 'purchase', reason 'compra_excluida'). Sem isso a conferência de
-- estoque não enxerga a mudança — a exclusão apaga os itens da compra, que
-- eram o único vestígio de que aquele saldo tinha entrado.

CREATE OR REPLACE FUNCTION fv.excluir_compra(p_purchase_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_vendidas   text[];
  v_estornadas integer := 0;
  v_e          record;
  v_antes      integer;
  v_depois     integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'excluir_compra: p_user_id é obrigatório (rastro em stock_movements).';
  END IF;

  PERFORM 1 FROM fv.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'nao_encontrada');
  END IF;

  -- Peça que já vendeu não sai por exclusão de compra (use a edição).
  SELECT array_agg(DISTINCT COALESCE(pr.name, 'peça sem nome') ORDER BY COALESCE(pr.name, 'peça sem nome'))
    INTO v_vendidas
    FROM fv.sale_items si
    LEFT JOIN fv.products pr ON pr.id = si.product_id
   WHERE si.product_id IN (SELECT product_id FROM fv.purchase_items WHERE purchase_id = p_purchase_id);

  IF v_vendidas IS NOT NULL AND array_length(v_vendidas, 1) > 0 THEN
    RETURN jsonb_build_object('erro', 'tem_venda', 'pecas', to_jsonb(v_vendidas));
  END IF;

  DELETE FROM fv.transactions
   WHERE reference_id = p_purchase_id AND reference_type = 'purchase';

  DELETE FROM fv.purchase_payments WHERE purchase_id = p_purchase_id;

  UPDATE fv.products SET purchase_id = NULL WHERE purchase_id = p_purchase_id;

  -- Estorno a partir dos itens (mesma peça em duas linhas soma antes), com a
  -- compra já travada — ninguém muda os itens no meio.
  FOR v_e IN
    SELECT product_id, sum(quantity)::integer AS qtd
      FROM fv.purchase_items
     WHERE purchase_id = p_purchase_id AND product_id IS NOT NULL
     GROUP BY product_id
     ORDER BY product_id   -- ordem fixa de travas: evita deadlock com vendas
  LOOP
    SELECT quantity_in_stock INTO v_antes FROM fv.products WHERE id = v_e.product_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;   -- peça apagada por outro caminho: nada a estornar

    v_depois := greatest(0, v_antes - v_e.qtd);
    CONTINUE WHEN v_depois = v_antes;

    UPDATE fv.products
       SET quantity_in_stock = v_depois, updated_at = now()
     WHERE id = v_e.product_id;

    INSERT INTO fv.stock_movements (
      product_id, quantity_before, delta, quantity_after, reason, ref_type, ref_id, user_id, notes
    ) VALUES (
      v_e.product_id, v_antes, v_depois - v_antes, v_depois,
      'compra_excluida', 'purchase', p_purchase_id, p_user_id,
      'Estorno da exclusão da compra.'
    );
    v_estornadas := v_estornadas + 1;
  END LOOP;

  DELETE FROM fv.purchase_items WHERE purchase_id = p_purchase_id;

  DELETE FROM fv.purchases WHERE id = p_purchase_id;

  RETURN jsonb_build_object('ok', true, 'estornadas', v_estornadas);
END;
$$;

COMMENT ON FUNCTION fv.excluir_compra(uuid, uuid) IS
  'Exclui a compra numa transação: financeiro, parcelas, vínculo das peças, itens, estorno do estoque (>= 0, com rastro em stock_movements) e cabeçalho. Recusa se alguma peça já vendeu. Desde 01/10/2026.';


-- ── editar_compra ────────────────────────────────────────────────────────────
--
-- p = {
--   purchase_id, purchase_date, notes, nf_number,
--   itens: [{ purchase_item_id, product_id, quantidade_original, quantity, name,
--             category, material, cost_price, sale_price, promotional_price,
--             label_format, supplier_id, store_id }],
--   pagamentos: [{ id, payment_method, amount, due_date, supplier_id }],
--   despesas:   [{ id | null, payment_method, amount, due_date, status, paid_at, description }],
--   despesas_remover: [uuid],
--   user_id
-- }
-- O TS já conferiu tudo (vendas, estoque, pertinência). Aqui:
--   · trava a compra e os itens; se a quantidade gravada de algum item mudou
--     desde a leitura do TS (outra edição no meio), ABORTA — o delta foi
--     calculado contra um número velho;
--   · estoque por delta atômico, recusando saldo negativo — e cada peça cujo
--     estoque muda ganha uma linha em `fv.stock_movements` (ref_type
--     'purchase', reason 'compra_editada'), para a conferência de estoque
--     enxergar a mudança;
--   · pagamentos/despesas só se a compra NÃO for consignação;
--   · totais refeitos a partir dos itens gravados.

CREATE OR REPLACE FUNCTION fv.editar_compra(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_purchase  uuid := (p->>'purchase_id')::uuid;
  v_user      uuid := (p->>'user_id')::uuid;
  v_consig    boolean;
  v_it        jsonb;
  v_qtd_grav  integer;
  v_prod_grav uuid;
  v_delta     record;
  v_novo      integer;
  v_pg        jsonb;
  v_tx        jsonb;
  v_status    text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'editar_compra: user_id é obrigatório (rastro em stock_movements).';
  END IF;

  SELECT consignment_id IS NOT NULL INTO v_consig
    FROM fv.purchases WHERE id = v_purchase FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra não encontrada.';
  END IF;

  -- ── Itens: pertinência + concorrência otimista ──
  FOR v_it IN SELECT value FROM jsonb_array_elements(COALESCE(p->'itens', '[]'::jsonb))
  LOOP
    SELECT quantity, product_id INTO v_qtd_grav, v_prod_grav
      FROM fv.purchase_items
     WHERE id = (v_it->>'purchase_item_id')::uuid
       AND purchase_id = v_purchase
     FOR UPDATE;

    IF NOT FOUND OR v_prod_grav <> (v_it->>'product_id')::uuid THEN
      RAISE EXCEPTION '"%" não pertence mais a esta compra. Recarregue a página antes de salvar.', v_it->>'name';
    END IF;

    IF v_qtd_grav <> (v_it->>'quantidade_original')::integer THEN
      RAISE EXCEPTION 'A compra foi alterada em outra tela enquanto você editava ("%"). Recarregue a página e salve de novo — nada foi alterado.', v_it->>'name';
    END IF;
  END LOOP;

  -- ── Estoque: um delta por peça, atômico, nunca negativo ──
  FOR v_delta IN
    SELECT (x->>'product_id')::uuid AS product_id,
           sum((x->>'quantity')::integer - (x->>'quantidade_original')::integer)::integer AS delta,
           min(x->>'name') AS nome,
           sum((x->>'quantity')::integer)::integer AS qtd_compra
      FROM jsonb_array_elements(COALESCE(p->'itens', '[]'::jsonb)) x
     GROUP BY 1
     ORDER BY 1   -- ordem fixa de travas: evita deadlock com vendas
  LOOP
    IF v_delta.delta <> 0 THEN
      UPDATE fv.products
         SET quantity_in_stock = quantity_in_stock + v_delta.delta,
             updated_at = now()
       WHERE id = v_delta.product_id
      RETURNING quantity_in_stock INTO v_novo;

      IF NOT FOUND THEN
        RAISE EXCEPTION '"%": a peça não foi encontrada no estoque. Recarregue a página.', v_delta.nome;
      END IF;
      IF v_novo < 0 THEN
        RAISE EXCEPTION '"%": só há % em estoque — as outras já saíram (venda, transferência ou baixa). A quantidade desta compra não pode ficar abaixo de %.',
          v_delta.nome, v_novo - v_delta.delta, v_delta.qtd_compra - v_novo;
      END IF;

      INSERT INTO fv.stock_movements (
        product_id, quantity_before, delta, quantity_after, reason, ref_type, ref_id, user_id, notes
      ) VALUES (
        v_delta.product_id, v_novo - v_delta.delta, v_delta.delta, v_novo,
        'compra_editada', 'purchase', v_purchase, v_user,
        'Quantidade da compra alterada na edição.'
      );
    END IF;
  END LOOP;

  -- ── Cadastro da peça + item da compra ──
  FOR v_it IN SELECT value FROM jsonb_array_elements(COALESCE(p->'itens', '[]'::jsonb))
  LOOP
    UPDATE fv.products SET
      name              = v_it->>'name',
      category          = v_it->>'category',
      material          = v_it->>'material',
      cost_price        = (v_it->>'cost_price')::numeric,
      sale_price        = (v_it->>'sale_price')::numeric,
      promotional_price = nullif(v_it->>'promotional_price', '')::numeric,
      label_format      = v_it->>'label_format',
      supplier_id       = nullif(v_it->>'supplier_id', '')::uuid,
      store_id          = (v_it->>'store_id')::uuid,
      updated_at        = now()
     WHERE id = (v_it->>'product_id')::uuid;

    UPDATE fv.purchase_items SET
      quantity     = (v_it->>'quantity')::integer,
      unit_cost    = (v_it->>'cost_price')::numeric,
      subtotal     = (v_it->>'cost_price')::numeric * (v_it->>'quantity')::integer,
      label_format = v_it->>'label_format'
     WHERE id = (v_it->>'purchase_item_id')::uuid;
  END LOOP;

  -- ── Pagamentos e financeiro (só compra própria) ──
  IF NOT v_consig THEN
    FOR v_pg IN SELECT value FROM jsonb_array_elements(COALESCE(p->'pagamentos', '[]'::jsonb))
    LOOP
      -- status/paid_at NÃO vêm da tela: quem quita é o financeiro.
      UPDATE fv.purchase_payments SET
        payment_method = v_pg->>'payment_method',
        amount         = (v_pg->>'amount')::numeric,
        due_date       = nullif(v_pg->>'due_date', '')::date,
        supplier_id    = nullif(v_pg->>'supplier_id', '')::uuid
       WHERE id = (v_pg->>'id')::uuid AND purchase_id = v_purchase;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Um dos pagamentos não pertence mais a esta compra. Recarregue a página antes de salvar.';
      END IF;
    END LOOP;

    FOR v_tx IN SELECT value FROM jsonb_array_elements(COALESCE(p->'despesas', '[]'::jsonb))
    LOOP
      v_status := CASE WHEN v_tx->>'status' = 'pending' THEN 'pending' ELSE 'completed' END;

      IF nullif(v_tx->>'id', '') IS NOT NULL THEN
        UPDATE fv.transactions SET
          amount           = (v_tx->>'amount')::numeric,
          payment_method   = v_tx->>'payment_method',
          transaction_date = (p->>'purchase_date')::date,
          due_date         = nullif(v_tx->>'due_date', '')::date,
          status           = v_status,
          paid_at          = CASE WHEN v_status = 'completed'
                                  THEN COALESCE(nullif(v_tx->>'paid_at', '')::timestamptz, now()) END,
          description      = v_tx->>'description'
         WHERE id = (v_tx->>'id')::uuid
           AND reference_id = v_purchase AND reference_type = 'purchase';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Um lançamento do financeiro desta compra mudou enquanto você editava. Recarregue a página e salve de novo.';
        END IF;
      ELSE
        INSERT INTO fv.transactions (
          store_id, type, amount, category, description, reference_type, reference_id,
          user_id, payment_method, transaction_date, due_date, status, paid_at
        ) VALUES (
          NULL, 'expense', (v_tx->>'amount')::numeric, 'compra_fornecedor',
          v_tx->>'description', 'purchase', v_purchase,
          v_user, v_tx->>'payment_method', (p->>'purchase_date')::date,
          nullif(v_tx->>'due_date', '')::date, v_status,
          CASE WHEN v_status = 'completed'
               THEN COALESCE(nullif(v_tx->>'paid_at', '')::timestamptz, now()) END
        );
      END IF;
    END LOOP;

    DELETE FROM fv.transactions
     WHERE id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(COALESCE(p->'despesas_remover', '[]'::jsonb)) x)
       AND reference_id = v_purchase AND reference_type = 'purchase';
  END IF;

  -- ── Cabeçalho + totais a partir dos itens gravados ──
  UPDATE fv.purchases pu SET
    purchase_date = (p->>'purchase_date')::date,
    notes         = nullif(p->>'notes', ''),
    nf_number     = nullif(p->>'nf_number', ''),
    total_cost    = t.custo,
    total_items   = t.pecas,
    updated_at    = now()
  FROM (
    SELECT round(COALESCE(sum(subtotal), 0), 2) AS custo,
           COALESCE(sum(quantity), 0)::integer  AS pecas
      FROM fv.purchase_items WHERE purchase_id = v_purchase
  ) t
  WHERE pu.id = v_purchase;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION fv.editar_compra(jsonb) IS
  'Grava a edição da compra numa transação (peças, estoque por delta, itens, pagamentos, financeiro, cabeçalho e totais). Aborta se a compra mudou desde a leitura. Desde 01/10/2026.';


-- ── registrar_acerto / remover_acerto ────────────────────────────────────────
--
-- A trava contra acerto acima do saldo é o FOR UPDATE no lote: dois acertos
-- simultâneos (duplo clique, duas abas) enfileiram, e o segundo já vê o
-- primeiro na soma. Substitui a "conferência depois de gravar" do TS.
--
-- p = { consignment_id, user_id, acerto_date, amount, payment_method, notes }
-- Devolve { ok, acerto_id, transaction_id, status } | { erro: 'nao_encontrada' }
--       | { erro: 'acima_do_saldo', falta }

CREATE OR REPLACE FUNCTION fv.registrar_acerto(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_lote      uuid := (p->>'consignment_id')::uuid;
  v_user      uuid := (p->>'user_id')::uuid;
  v_valor     numeric := (p->>'amount')::numeric;
  v_data      date := (p->>'acerto_date')::date;
  v_store     uuid;
  v_total     numeric;
  v_fornec    text;
  v_devolvido numeric;
  v_acertado  numeric;
  v_falta     numeric;
  v_tx        uuid;
  v_acerto    uuid;
BEGIN
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'Informe o valor do acerto.';
  END IF;
  IF v_data IS NULL THEN
    RAISE EXCEPTION 'Informe a data do acerto.';
  END IF;

  SELECT c.store_id, c.total_cost_value, s.name
    INTO v_store, v_total, v_fornec
    FROM fv.consignments c
    LEFT JOIN fv.suppliers s ON s.id = c.supplier_id
   WHERE c.id = v_lote
   FOR UPDATE OF c;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'nao_encontrada');
  END IF;

  v_devolvido := fv.devolvido_da_consignacao(v_lote);
  SELECT COALESCE(sum(amount), 0) INTO v_acertado
    FROM fv.consignment_acertos WHERE consignment_id = v_lote;
  v_falta := greatest(0, v_total - v_devolvido - v_acertado);

  IF round(v_valor * 100) > round(v_falta * 100) + 1 THEN
    RETURN jsonb_build_object('erro', 'acima_do_saldo', 'falta', round(v_falta, 2));
  END IF;

  INSERT INTO fv.transactions (
    store_id, type, amount, category, description, reference_type, reference_id,
    user_id, payment_method, transaction_date, due_date, status, paid_at
  ) VALUES (
    v_store, 'expense', v_valor, 'acerto_consignacao',
    'Acerto de consignação — ' || COALESCE(v_fornec, 'fornecedor'),
    'consignment', v_lote, v_user,
    nullif(p->>'payment_method', ''), v_data, v_data, 'completed', now()
  )
  RETURNING id INTO v_tx;

  INSERT INTO fv.consignment_acertos (
    consignment_id, acerto_date, amount, payment_method, notes, transaction_id, user_id
  ) VALUES (
    v_lote, v_data, v_valor, nullif(p->>'payment_method', ''),
    nullif(btrim(COALESCE(p->>'notes', '')), ''), v_tx, v_user
  )
  RETURNING id INTO v_acerto;

  RETURN jsonb_build_object(
    'ok', true, 'acerto_id', v_acerto, 'transaction_id', v_tx,
    'status', fv.recalcular_status_consignacao(v_lote)
  );
END;
$$;

COMMENT ON FUNCTION fv.registrar_acerto(jsonb) IS
  'Acerto de consignação numa transação (despesa + acerto + status do lote), com o lote travado: não passa do saldo (total − devolvido − acertado). Desde 01/10/2026.';

-- Devolve { ok, status } | { erro: 'nao_encontrado' }
CREATE OR REPLACE FUNCTION fv.remover_acerto(p_acerto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_lote uuid;
  v_tx   uuid;
BEGIN
  SELECT consignment_id INTO v_lote FROM fv.consignment_acertos WHERE id = p_acerto_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'nao_encontrado');
  END IF;

  -- Mesma ordem de trava do registrar (lote primeiro), para não haver deadlock.
  PERFORM 1 FROM fv.consignments WHERE id = v_lote FOR UPDATE;

  DELETE FROM fv.consignment_acertos WHERE id = p_acerto_id RETURNING transaction_id INTO v_tx;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'nao_encontrado');
  END IF;

  IF v_tx IS NOT NULL THEN
    DELETE FROM fv.transactions WHERE id = v_tx;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', fv.recalcular_status_consignacao(v_lote));
END;
$$;

COMMENT ON FUNCTION fv.remover_acerto(uuid) IS
  'Remove o acerto e a despesa dele numa transação, e recalcula o status do lote. Desde 01/10/2026.';


-- ── Permissões: só o service_role (server actions) ───────────────────────────
REVOKE EXECUTE ON FUNCTION fv.devolvido_da_consignacao(uuid)       FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fv.recalcular_status_consignacao(uuid)  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fv.salvar_compra(jsonb)                 FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fv.excluir_compra(uuid, uuid)           FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fv.editar_compra(jsonb)                 FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fv.registrar_acerto(jsonb)              FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fv.remover_acerto(uuid)                 FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION fv.devolvido_da_consignacao(uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION fv.recalcular_status_consignacao(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION fv.salvar_compra(jsonb)                  TO service_role;
GRANT EXECUTE ON FUNCTION fv.excluir_compra(uuid, uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION fv.editar_compra(jsonb)                  TO service_role;
GRANT EXECUTE ON FUNCTION fv.registrar_acerto(jsonb)               TO service_role;
GRANT EXECUTE ON FUNCTION fv.remover_acerto(uuid)                  TO service_role;

-- Recarrega o cache do PostgREST (pelo pooler pode não chegar — ver cabeçalho).
NOTIFY pgrst, 'reload schema';
