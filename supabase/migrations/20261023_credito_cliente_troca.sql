-- ============================================================================
-- Crédito da cliente: troca com sobra fecha no PDV (23/10/2026)
-- ============================================================================
--
-- POR QUÊ
--
-- O PDV recusava a troca quando a peça devolvida valia mais que a levada ("o
-- sistema ainda não emite vale"). Combinado com a Eleandra em 23/10/2026: a
-- sobra tem três destinos, escolhidos no balcão:
--
--   guardado    vira crédito da cliente NA LOJA que gerou, sem validade;
--   dispensado  a cliente abre mão: nada guardado, nada sai do caixa;
--   devolvido   sai do caixa em dinheiro ou Pix (o servidor grava a despesa
--               `devolucao_troca`, e o fv.fluxo_caixa já a tira em `saidas`).
--
-- O crédito guardado paga compras futuras como `sale_payments.payment_method
-- = 'store_credit'` (tPag 21 na NFC-e), com uso parcial.
--
-- COMO
--
-- Saldo em `fv.customer_credits` (uma linha por loja × cliente, CHECK >= 0) e
-- o extrato em `fv.customer_credit_movements`. Todo movimento passa por
-- `fv._mover_credito`: upsert atômico `balance = balance + delta`. A linha do
-- saldo fica travada até o fim da transação da venda, então dois PDVs usando o
-- mesmo crédito entram em fila, e o segundo bate no CHECK (sem uso duplo, sem
-- saldo negativo). Tudo dentro de fv.salvar_venda: falhou, nada fica.
--
-- Excluir a venda estorna o que ela gerou/usou. Se o crédito que ela gerou já
-- foi gasto, a exclusão é recusada (o CHECK derruba): desfazer isso é decisão
-- do admin, com ajuste.
--
-- SEGURANÇA: tabelas com RLS ligada e sem policy, funções só service_role.
-- A vendedora vê e usa pelo servidor (escopo de loja lá); ajuste só admin.
--
-- Volta: 20261023_credito_cliente_troca.down.sql
-- ORDEM DO DEPLOY: aplicar ANTES do push.
-- ============================================================================


-- ─── Tabelas ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fv.customer_credits (
  store_id    uuid NOT NULL REFERENCES fv.stores(id),
  customer_id uuid NOT NULL REFERENCES fv.customers(id),
  balance     numeric(12,2) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, customer_id),
  CONSTRAINT customer_credits_nao_negativo CHECK (balance >= 0)
);

COMMENT ON TABLE fv.customer_credits IS
  'Saldo de crédito da cliente por loja (sobra de troca guardada). Só muda por fv._mover_credito.';

CREATE TABLE IF NOT EXISTS fv.customer_credit_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES fv.stores(id),
  customer_id   uuid NOT NULL REFERENCES fv.customers(id),
  kind          text NOT NULL CHECK (kind IN ('gerou', 'usou', 'ajuste', 'estorno')),
  amount        numeric(12,2) NOT NULL CHECK (amount <> 0),
  balance_after numeric(12,2) NOT NULL,
  -- Venda excluída: o extrato fica (com o estorno), só perde o vínculo.
  sale_id       uuid REFERENCES fv.sales(id) ON DELETE SET NULL,
  user_id       uuid,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_credit_movements_cliente
  ON fv.customer_credit_movements (store_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_credit_movements_venda
  ON fv.customer_credit_movements (sale_id) WHERE sale_id IS NOT NULL;

COMMENT ON TABLE fv.customer_credit_movements IS
  'Extrato do crédito da cliente: gerou (sobra guardada), usou (pagamento store_credit), ajuste (admin), estorno (venda excluída).';

ALTER TABLE fv.customer_credits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fv.customer_credit_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fv.customer_credits, fv.customer_credit_movements FROM PUBLIC, anon, authenticated;
GRANT ALL ON fv.customer_credits, fv.customer_credit_movements TO service_role;


-- ─── A sobra fica registrada na troca ───────────────────────────────────────

ALTER TABLE fv.exchanges
  ADD COLUMN IF NOT EXISTS sobra_valor   numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sobra_destino text,
  ADD COLUMN IF NOT EXISTS sobra_metodo  text;

ALTER TABLE fv.exchanges DROP CONSTRAINT IF EXISTS exchanges_sobra_check;
-- COALESCE: CHECK com NULL passa (devolvido sem forma passava no teste).
ALTER TABLE fv.exchanges ADD CONSTRAINT exchanges_sobra_check CHECK (COALESCE(
  (sobra_valor = 0 AND sobra_destino IS NULL AND sobra_metodo IS NULL)
  OR (sobra_valor > 0 AND sobra_destino IN ('guardado', 'dispensado') AND sobra_metodo IS NULL)
  OR (sobra_valor > 0 AND sobra_destino = 'devolvido' AND sobra_metodo IN ('cash', 'pix')),
  false
));


-- ─── Pagamento com o crédito ────────────────────────────────────────────────

ALTER TABLE fv.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_payment_method_check;
ALTER TABLE fv.sale_payments ADD CONSTRAINT sale_payments_payment_method_check
  CHECK (payment_method = ANY (ARRAY['credit', 'debit', 'pix', 'cash', 'store_credit']));


-- ─── Mover o saldo ──────────────────────────────────────────────────────────
--
-- delta > 0 entra, < 0 sai. Passar do saldo = CHECK customer_credits_nao_negativo
-- (23514), que o servidor traduz para "saldo insuficiente".

CREATE OR REPLACE FUNCTION fv._mover_credito(
  p_store_id    uuid,
  p_customer_id uuid,
  p_delta       numeric,
  p_kind        text,
  p_sale_id     uuid,
  p_user_id     uuid,
  p_notes       text
) RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo numeric;
BEGIN
  IF p_delta IS NULL OR round(p_delta, 2) = 0 THEN
    RETURN NULL;
  END IF;
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'crédito da cliente sem cliente';
  END IF;

  /*
   * Saída é UPDATE, não upsert: o INSERT confere o CHECK na linha proposta
   * (saldo = delta negativo) antes de ver o conflito, e toda saída falhava.
   */
  IF p_delta > 0 THEN
    INSERT INTO fv.customer_credits AS c (store_id, customer_id, balance, updated_at)
    VALUES (p_store_id, p_customer_id, round(p_delta, 2), now())
    ON CONFLICT (store_id, customer_id)
    DO UPDATE SET balance = c.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_saldo;
  ELSE
    UPDATE fv.customer_credits
       SET balance = balance + round(p_delta, 2), updated_at = now()
     WHERE store_id = p_store_id AND customer_id = p_customer_id
    RETURNING balance INTO v_saldo;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A cliente não tem crédito nesta loja.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'customer_credits_nao_negativo';
    END IF;
  END IF;

  INSERT INTO fv.customer_credit_movements (store_id, customer_id, kind, amount, balance_after, sale_id, user_id, notes)
  VALUES (p_store_id, p_customer_id, p_kind, round(p_delta, 2), v_saldo, p_sale_id, p_user_id, p_notes);

  RETURN v_saldo;
END;
$$;


-- ─── Ajuste do admin (o servidor confere o papel) ──────────────────────────
--
-- Define o saldo NOVO (zerar = 0). Grava a diferença como 'ajuste'.

CREATE OR REPLACE FUNCTION fv.ajustar_credito_cliente(
  p_store_id    uuid,
  p_customer_id uuid,
  p_novo_saldo  numeric,
  p_user_id     uuid,
  p_notes       text
) RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_atual numeric;
BEGIN
  IF p_novo_saldo IS NULL OR p_novo_saldo < 0 THEN
    RAISE EXCEPTION 'saldo novo inválido';
  END IF;
  INSERT INTO fv.customer_credits (store_id, customer_id, balance)
  VALUES (p_store_id, p_customer_id, 0)
  ON CONFLICT DO NOTHING;
  SELECT balance INTO v_atual FROM fv.customer_credits
   WHERE store_id = p_store_id AND customer_id = p_customer_id FOR UPDATE;
  PERFORM fv._mover_credito(p_store_id, p_customer_id, round(p_novo_saldo, 2) - v_atual,
                            'ajuste', NULL, p_user_id, NULLIF(trim(p_notes), ''));
  RETURN round(p_novo_saldo, 2);
END;
$$;


-- ─── Corpo da venda: + crédito ──────────────────────────────────────────────
-- Igual a 20261001, com dois acréscimos marcados "CRÉDITO".

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
  v_troca       fv.exchanges%ROWTYPE;
  v_usado       numeric;
BEGIN
  SELECT * INTO v_venda FROM fv.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venda % não existe ao gravar o corpo', p_sale_id;
  END IF;

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

  FOR v_item IN
    SELECT e.value FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) WITH ORDINALITY AS e(value, ord)
    ORDER BY e.ord
  LOOP
    v_linha := jsonb_populate_record(NULL::fv.sale_items, v_item);

    INSERT INTO fv.sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
    VALUES (p_sale_id, v_linha.product_id, v_linha.quantity, v_linha.unit_price, v_linha.unit_cost, v_linha.subtotal)
    RETURNING id INTO v_item_id;

    UPDATE fv.products
       SET quantity_in_stock = quantity_in_stock - v_linha.quantity,
           last_sale_date    = CASE WHEN p_marca_ultima_venda THEN v_venda.sale_date ELSE last_sale_date END
     WHERE id = v_linha.product_id
       AND NOT is_service;

    v_conserto := v_item->'conserto';
    IF v_conserto IS NOT NULL AND jsonb_typeof(v_conserto) = 'object' THEN
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

  INSERT INTO fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
  SELECT p_sale_id, x.payment_method, x.amount, x.installments, x.card_brand
    FROM jsonb_populate_recordset(NULL::fv.sale_payments, COALESCE(p->'payments', '[]'::jsonb)) AS x;

  -- CRÉDITO: o que esta venda pagou com o crédito da cliente sai do saldo.
  SELECT COALESCE(sum(x.amount), 0) INTO v_usado
    FROM jsonb_populate_recordset(NULL::fv.sale_payments, COALESCE(p->'payments', '[]'::jsonb)) AS x
   WHERE x.payment_method = 'store_credit';
  IF v_usado > 0 THEN
    PERFORM fv._mover_credito(v_venda.store_id, v_venda.customer_id, -v_usado,
                              'usou', p_sale_id, v_venda.user_id, NULL);
  END IF;

  INSERT INTO fv.transactions (
    store_id, type, amount, category, description, reference_type, reference_id,
    user_id, payment_method, transaction_date, status, paid_at
  )
  SELECT t.store_id, t.type, t.amount, t.category, t.description, t.reference_type, p_sale_id,
         t.user_id, t.payment_method, t.transaction_date, t.status, now()
    FROM jsonb_populate_recordset(NULL::fv.transactions, COALESCE(p->'transactions', '[]'::jsonb)) AS t;

  IF jsonb_typeof(p->'exchange') = 'object' THEN
    v_troca := jsonb_populate_record(NULL::fv.exchanges, p->'exchange'->'row');

    INSERT INTO fv.exchanges (
      sale_id, original_sale_id, store_id, customer_id, user_id,
      exchange_date, reason, price_difference, payment_method,
      sobra_valor, sobra_destino, sobra_metodo
    ) VALUES (
      p_sale_id, v_troca.original_sale_id, v_troca.store_id, v_troca.customer_id, v_troca.user_id,
      v_troca.exchange_date, v_troca.reason, v_troca.price_difference, v_troca.payment_method,
      COALESCE(v_troca.sobra_valor, 0), v_troca.sobra_destino, v_troca.sobra_metodo
    )
    RETURNING id INTO v_exchange_id;

    -- CRÉDITO: sobra guardada entra no saldo da cliente, na loja da venda.
    IF v_troca.sobra_destino = 'guardado' THEN
      PERFORM fv._mover_credito(v_venda.store_id, v_venda.customer_id, v_troca.sobra_valor,
                                'gerou', p_sale_id, v_venda.user_id, 'Sobra da troca');
    END IF;

    INSERT INTO fv.exchange_items (exchange_id, direction, product_id, quantity, unit_price, unit_cost)
    SELECT v_exchange_id, 'returned', r.product_id, r.quantity, r.unit_price, COALESCE(r.unit_cost, 0)
      FROM jsonb_populate_recordset(NULL::fv.exchange_items, COALESCE(p->'exchange'->'returned', '[]'::jsonb)) AS r;

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


-- ─── Desfazer o corpo: + estorno do crédito ─────────────────────────────────
-- Igual a 20261001, com o bloco "CRÉDITO" no começo.

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
  v_mov        record;
BEGIN
  /*
   * CRÉDITO: estorna o que a venda gerou (sai) e usou (volta). Se o crédito
   * gerado já foi gasto em outra compra, o saldo ficaria negativo e o CHECK
   * derruba a exclusão inteira — de propósito.
   */
  FOR v_mov IN
    SELECT m.store_id, m.customer_id, sum(m.amount) AS liquido
      FROM fv.customer_credit_movements m
     WHERE m.sale_id = p_sale_id
     GROUP BY m.store_id, m.customer_id
    HAVING sum(m.amount) <> 0
  LOOP
    PERFORM fv._mover_credito(v_mov.store_id, v_mov.customer_id, -v_mov.liquido, 'estorno', p_sale_id, p_user_id,
                              CASE p_motivo WHEN 'venda_editada' THEN 'Venda editada' ELSE 'Venda excluída' END);
  END LOOP;

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


-- ─── Quem pode chamar: só o service_role ────────────────────────────────────

REVOKE ALL ON FUNCTION fv._mover_credito(uuid, uuid, numeric, text, uuid, uuid, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv.ajustar_credito_cliente(uuid, uuid, numeric, uuid, text)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv._gravar_corpo_da_venda(uuid, jsonb, boolean)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv._desfazer_corpo_da_venda(uuid, uuid, text)                   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv._mover_credito(uuid, uuid, numeric, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION fv.ajustar_credito_cliente(uuid, uuid, numeric, uuid, text)    TO service_role;
GRANT EXECUTE ON FUNCTION fv._gravar_corpo_da_venda(uuid, jsonb, boolean)                TO service_role;
GRANT EXECUTE ON FUNCTION fv._desfazer_corpo_da_venda(uuid, uuid, text)                  TO service_role;

-- Pelo pooler o NOTIFY pode não chegar: se der PGRST202, SIGUSR1 no supabase_rest.
NOTIFY pgrst, 'reload schema';
