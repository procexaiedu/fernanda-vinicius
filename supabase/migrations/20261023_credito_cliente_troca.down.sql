-- Volta de 20261023_credito_cliente_troca.sql
-- ATENÇÃO: apaga o extrato e os saldos de crédito. Antes de rodar, confira
-- se há saldo guardado (select * from fv.customer_credits where balance > 0)
-- e combine com a dona como devolver. Vendas pagas com store_credit impedem
-- a volta do CHECK de sale_payments: elas precisam ser tratadas antes.

CREATE OR REPLACE FUNCTION fv._gravar_corpo_da_venda(
  p_sale_id            uuid,
  p                    jsonb,
  p_marca_ultima_venda boolean
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_venda       fv.sales%ROWTYPE;
  v_item        jsonb;
  v_linha       fv.sale_items%ROWTYPE;
  v_item_id     uuid;
  v_conserto    jsonb;
  v_pendentes   jsonb := '[]'::jsonb;
  v_exchange_id uuid;
BEGIN
  SELECT * INTO v_venda FROM fv.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venda % não existe ao gravar o corpo', p_sale_id;
  END IF;

  /*
   * Trava de uma vez, em ordem de id, todas as peças que esta venda mexe
   * (itens + devolvidas na troca). Sem isto, duas vendas simultâneas com as
   * mesmas peças em ordem inversa se travam (deadlock, 40P01) e uma é
   * abortada no balcão; em ordem fixa, a segunda só espera a primeira.
   */
  PERFORM 1
     FROM fv.products
    WHERE id IN (
            SELECT (e->>'product_id')::uuid FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) e
             WHERE e->>'product_id' IS NOT NULL
            UNION
            SELECT (e->>'product_id')::uuid FROM jsonb_array_elements(COALESCE(p->'exchange'->'returned', '[]'::jsonb)) e
             WHERE e->>'product_id' IS NOT NULL
          )
    ORDER BY id
      FOR UPDATE;

  -- ── Itens (+ estoque + conserto), um a um: o conserto precisa do id da linha
  FOR v_item IN
    SELECT e.value FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) WITH ORDINALITY AS e(value, ord)
    ORDER BY e.ord
  LOOP
    v_linha := jsonb_populate_record(NULL::fv.sale_items, v_item);

    INSERT INTO fv.sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
    VALUES (p_sale_id, v_linha.product_id, v_linha.quantity, v_linha.unit_price, v_linha.unit_cost, v_linha.subtotal)
    RETURNING id INTO v_item_id;

    -- Atômico: sem ler o saldo antes. Pode ficar negativo (regra do balcão).
    UPDATE fv.products
       SET quantity_in_stock = quantity_in_stock - v_linha.quantity,
           last_sale_date    = CASE WHEN p_marca_ultima_venda THEN v_venda.sale_date ELSE last_sale_date END
     WHERE id = v_linha.product_id
       AND NOT is_service;

    v_conserto := v_item->'conserto';
    IF v_conserto IS NOT NULL AND jsonb_typeof(v_conserto) = 'object' THEN
      /*
       * Sub-bloco = savepoint. Falhou o vínculo, desfaz só ele; a venda segue.
       * Mesmos dois caminhos de consertos/interno.ts:
       *   { id }    → peça já registrada: a venda diz que foi PAGA (não entregue)
       *   { novo }  → cobrança direta no PDV: nasce o registro do conserto
       */
      BEGIN
        IF v_conserto ? 'id' THEN
          UPDATE fv.consertos
             SET sale_item_id = v_item_id,
                 updated_at   = now()
           WHERE id = (v_conserto->>'id')::uuid;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Conserto não encontrado ao registrar o pagamento.';
          END IF;
        ELSIF jsonb_typeof(v_conserto->'novo') = 'object' THEN
          INSERT INTO fv.consertos (store_id, customer_id, peca, recebido_em, status, entregue_em, sale_item_id, user_id)
          SELECT c.store_id, c.customer_id, c.peca, c.recebido_em, c.status, c.entregue_em, v_item_id, c.user_id
            FROM jsonb_populate_record(NULL::fv.consertos, v_conserto->'novo') AS c;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_pendentes := v_pendentes || jsonb_build_object(
          'conserto_id',  v_conserto->>'id',
          'sale_item_id', v_item_id,
          'erro',         SQLERRM
        );
      END;
    END IF;
  END LOOP;

  -- ── Pagamentos e o financeiro (uma transaction por pagamento) ──────────────
  INSERT INTO fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
  SELECT p_sale_id, x.payment_method, x.amount, x.installments, x.card_brand
    FROM jsonb_populate_recordset(NULL::fv.sale_payments, COALESCE(p->'payments', '[]'::jsonb)) AS x;

  INSERT INTO fv.transactions (
    store_id, type, amount, category, description, reference_type, reference_id,
    user_id, payment_method, transaction_date, status, paid_at
  )
  SELECT t.store_id, t.type, t.amount, t.category, t.description, t.reference_type, p_sale_id,
         t.user_id, t.payment_method, t.transaction_date, t.status, now()
    FROM jsonb_populate_recordset(NULL::fv.transactions, COALESCE(p->'transactions', '[]'::jsonb)) AS t;

  -- ── Troca: o que voltou (entra no estoque) e o que saiu ────────────────────
  IF jsonb_typeof(p->'exchange') = 'object' THEN
    INSERT INTO fv.exchanges (
      sale_id, original_sale_id, store_id, customer_id, user_id,
      exchange_date, reason, price_difference, payment_method
    )
    SELECT p_sale_id, e.original_sale_id, e.store_id, e.customer_id, e.user_id,
           e.exchange_date, e.reason, e.price_difference, e.payment_method
      FROM jsonb_populate_record(NULL::fv.exchanges, p->'exchange'->'row') AS e
    RETURNING id INTO v_exchange_id;

    INSERT INTO fv.exchange_items (exchange_id, direction, product_id, quantity, unit_price, unit_cost)
    SELECT v_exchange_id, 'returned', r.product_id, r.quantity, r.unit_price, COALESCE(r.unit_cost, 0)
      FROM jsonb_populate_recordset(NULL::fv.exchange_items, COALESCE(p->'exchange'->'returned', '[]'::jsonb)) AS r;

    /*
     * `is_active = true` junto com o saldo: peça vendida costuma estar zerada e
     * inativada; voltou para a gaveta, volta para as listas (ver a nota que
     * morava em gravarItensDaTroca).
     */
    UPDATE fv.products pr
       SET quantity_in_stock = pr.quantity_in_stock + d.qtd,
           is_active         = true,
           updated_at        = now()
      FROM (
        SELECT r.product_id, sum(r.quantity)::integer AS qtd
          FROM jsonb_populate_recordset(NULL::fv.exchange_items, COALESCE(p->'exchange'->'returned', '[]'::jsonb)) AS r
         GROUP BY r.product_id
      ) AS d
     WHERE pr.id = d.product_id
       AND NOT pr.is_service;

    INSERT INTO fv.exchange_items (exchange_id, direction, product_id, quantity, unit_price, unit_cost)
    SELECT v_exchange_id, 'given', g.product_id, g.quantity, g.unit_price, COALESCE(g.unit_cost, 0)
      FROM jsonb_populate_recordset(NULL::fv.exchange_items, COALESCE(p->'exchange'->'given', '[]'::jsonb)) AS g;
  END IF;

  RETURN jsonb_build_object(
    'exchange_id',         v_exchange_id,
    'consertos_pendentes', v_pendentes
  );
END;
$$;

CREATE OR REPLACE FUNCTION fv._desfazer_corpo_da_venda(
  p_sale_id uuid,
  p_user_id uuid,
  p_motivo  text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sem_rastro integer;
BEGIN
  -- Mesma trava em ordem de id da gravação (ver _gravar_corpo_da_venda).
  PERFORM 1
     FROM fv.products
    WHERE id IN (
            SELECT si.product_id FROM fv.sale_items si WHERE si.sale_id = p_sale_id
            UNION
            SELECT ei.product_id
              FROM fv.exchange_items ei
              JOIN fv.exchanges ex ON ex.id = ei.exchange_id
             WHERE ex.sale_id = p_sale_id
          )
    ORDER BY id
      FOR UPDATE;

  WITH deltas AS (
    SELECT x.product_id, sum(x.delta)::integer AS delta
      FROM (
        SELECT si.product_id, si.quantity AS delta
          FROM fv.sale_items si
         WHERE si.sale_id = p_sale_id
        UNION ALL
        SELECT ei.product_id, -ei.quantity
          FROM fv.exchange_items ei
          JOIN fv.exchanges ex ON ex.id = ei.exchange_id
         WHERE ex.sale_id = p_sale_id
           AND ei.direction = 'returned'
      ) AS x
     GROUP BY x.product_id
    HAVING sum(x.delta) <> 0
  ),
  mudou AS (
    UPDATE fv.products pr
       SET quantity_in_stock = pr.quantity_in_stock + d.delta
      FROM deltas d
     WHERE pr.id = d.product_id
       AND NOT pr.is_service
    RETURNING pr.id AS product_id, pr.quantity_in_stock AS depois, d.delta
  ),
  rastro AS (
    INSERT INTO fv.stock_movements (
      product_id, quantity_before, delta, quantity_after,
      reason, ref_type, ref_id, user_id, notes
    )
    SELECT m.product_id, m.depois - m.delta, m.delta, m.depois,
           p_motivo, 'sale', p_sale_id, p_user_id,
           CASE p_motivo WHEN 'venda_editada' THEN 'Venda editada: estoque da venda antiga devolvido'
                         ELSE 'Venda excluída: estoque devolvido' END
      FROM mudou m
     WHERE m.depois >= 0 AND m.depois - m.delta >= 0
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM mudou) - (SELECT count(*) FROM rastro) INTO v_sem_rastro;

  IF v_sem_rastro > 0 THEN
    RAISE NOTICE '_desfazer_corpo_da_venda: % peça(s) com saldo negativo ficaram sem linha em stock_movements (venda %)', v_sem_rastro, p_sale_id;
  END IF;

  DELETE FROM fv.exchange_items
   WHERE exchange_id IN (SELECT id FROM fv.exchanges WHERE sale_id = p_sale_id);
  DELETE FROM fv.exchanges     WHERE sale_id = p_sale_id;
  DELETE FROM fv.transactions  WHERE reference_id = p_sale_id AND reference_type = 'sale';
  DELETE FROM fv.sale_payments WHERE sale_id = p_sale_id;
  DELETE FROM fv.sale_items    WHERE sale_id = p_sale_id;
END;
$$;


DROP FUNCTION IF EXISTS fv.ajustar_credito_cliente(uuid, uuid, numeric, uuid, text);
DROP FUNCTION IF EXISTS fv._mover_credito(uuid, uuid, numeric, text, uuid, uuid, text);

ALTER TABLE fv.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_payment_method_check;
ALTER TABLE fv.sale_payments ADD CONSTRAINT sale_payments_payment_method_check
  CHECK (payment_method = ANY (ARRAY['credit', 'debit', 'pix', 'cash']));

ALTER TABLE fv.exchanges DROP CONSTRAINT IF EXISTS exchanges_sobra_check;
ALTER TABLE fv.exchanges
  DROP COLUMN IF EXISTS sobra_valor,
  DROP COLUMN IF EXISTS sobra_destino,
  DROP COLUMN IF EXISTS sobra_metodo;

DROP TABLE IF EXISTS fv.customer_credit_movements;
DROP TABLE IF EXISTS fv.customer_credits;

REVOKE ALL ON FUNCTION fv._gravar_corpo_da_venda(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv._desfazer_corpo_da_venda(uuid, uuid, text)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv._gravar_corpo_da_venda(uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION fv._desfazer_corpo_da_venda(uuid, uuid, text)   TO service_role;

NOTIFY pgrst, 'reload schema';
