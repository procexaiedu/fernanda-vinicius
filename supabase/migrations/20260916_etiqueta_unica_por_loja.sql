-- ============================================================================
-- Etiqueta única POR LOJA — transferência parcial não pede mais etiqueta nova
-- ============================================================================
--
-- Reunião de 15/09. Na tela apareceu "5 peças vai parcial — no destino ela
-- ganha código de barras próprio, reimprima a etiqueta na chegada". A resposta:
--
--   — "Não faz sentido você chegar lá e reetiquetar, certo? Você não quer isso."
--   — "Não, jamais."
--
-- E o dado que muda a decisão: "quem vai etiquetar Brasília sou eu. Vai ser
-- por aqui." Toda etiqueta nasce em Campinas, da mesma sequência. O risco que o
-- índice único GLOBAL protegia — duas peças diferentes com o mesmo código em
-- lojas diferentes — não existe na operação real.
--
--
-- O QUE MUDA
--
-- 1. `idx_products_barcode_number` (UNIQUE em barcode_number) sai. Entra UNIQUE
--    em (store_id, barcode_number) e um índice comum em barcode_number para as
--    buscas continuarem rápidas.
--
-- 2. `receber_transferencia` passa a achar a linha do destino PELA ETIQUETA, e a
--    linha nova no destino HERDA a etiqueta da origem.
--
--    Achar pela etiqueta não é só conveniência — é o que impede colisão no
--    índice novo. Sem isso, dois casos quebrariam:
--      · manda 1 de 3 (linha nova em Brasília com a etiqueta X) e depois os 2
--        restantes (a linha de Campinas muda de loja inteira) → duas linhas com
--        X em Brasília;
--      · a peça volta de Brasília para Campinas, onde ainda existe a linha X.
--    Nos dois, a peça que chega SOMA na linha que já está lá.
--
--    Se a etiqueta existir no destino num cadastro DIFERENTE (outro código ou
--    outro nome — só acontece com etiqueta digitada à mão), não soma: cria
--    linha com etiqueta nova e marca `reetiquetar`, que é o comportamento
--    antigo, reservado para o único caso em que ele ainda faz sentido.
--
-- 3. `enviar_transferencia` para de marcar `reetiquetar` no envio parcial.
--
-- 4. Romaneios em trânsito deixam de pedir reetiqueta — a chegada deles já usa
--    a regra nova.
--
--
-- ORDEM DE APLICAÇÃO: o código que busca etiqueta POR LOJA precisa estar no ar
-- ANTES (commit desta mesma data). Código novo funciona com o índice velho;
-- código velho com o índice novo quebra no primeiro parcial recebido, porque
-- `.maybeSingle()` recebe duas linhas.
-- ============================================================================


-- ── 1. Índice ────────────────────────────────────────────────────────────────

-- Pode ter nascido como CONSTRAINT ou como INDEX; DROP INDEX num índice que é
-- de constraint falha. Cobre os dois.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'idx_products_barcode_number'
       AND conrelid = 'fv.products'::regclass
  ) THEN
    ALTER TABLE fv.products DROP CONSTRAINT idx_products_barcode_number;
  ELSE
    DROP INDEX IF EXISTS fv.idx_products_barcode_number;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_loja_etiqueta
  ON fv.products (store_id, barcode_number);

CREATE INDEX IF NOT EXISTS idx_products_etiqueta
  ON fv.products (barcode_number);

COMMENT ON INDEX fv.idx_products_loja_etiqueta IS
  'Etiqueta única dentro da loja, não na rede (desde 16/09/2026). A mesma peça transferida mantém a etiqueta física nas duas lojas.';


-- ── 2. Receber ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fv.receber_transferencia(
  p_transfer_id uuid,
  p_recebidos   jsonb,   -- [{"product_id": "...", "quantity": 1}, ...]
  p_user_id     uuid,
  p_notes       text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer    fv.transfers%ROWTYPE;
  v_item        fv.transfer_items%ROWTYPE;
  v_recebido    integer;
  v_falta       integer;
  v_origem      fv.products%ROWTYPE;
  v_destino     fv.products%ROWTYPE;
  v_achou       boolean;
  v_dest_id     uuid;
  v_divergiu    boolean := false;
  v_sobras      integer := 0;
  v_rec         jsonb;
  v_conflito    boolean;
BEGIN
  SELECT * INTO v_transfer FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Transferência não encontrada.');
  END IF;

  -- Idempotência: dois cliques em "Confirmar" não podem dar entrada duas vezes.
  IF v_transfer.status <> 'enviada' THEN
    RETURN json_build_object('success', false,
      'error', format('Esta transferência já está como "%s".', v_transfer.status));
  END IF;

  FOR v_item IN
    SELECT * FROM fv.transfer_items
     WHERE transfer_id = p_transfer_id AND quantity_sent > 0
     ORDER BY product_name
  LOOP
    -- Não bipada é zero recebido, e não "não conferida": a conferência acabou.
    SELECT COALESCE(MAX((r->>'quantity')::integer), 0) INTO v_recebido
      FROM jsonb_array_elements(COALESCE(p_recebidos, '[]'::jsonb)) r
     WHERE (r->>'product_id')::uuid = v_item.product_id;

    IF v_recebido > v_item.quantity_sent THEN
      v_recebido := v_item.quantity_sent;   -- excedente da mesma peça é sobra, tratada abaixo
    END IF;

    v_falta    := v_item.quantity_sent - v_recebido;
    v_dest_id  := NULL;
    v_conflito := false;
    v_achou    := false;

    SELECT * INTO v_origem FROM fv.products WHERE id = v_item.product_id FOR UPDATE;

    -- ─ o que chegou entra no destino ─
    IF v_recebido > 0 THEN

      /*
       * 1º: já existe no destino uma linha com ESTA etiqueta?
       *
       * É o caso da peça que já foi mandada em parte antes, ou que está
       * voltando para a loja de onde saiu. Soma nela — mover ou inserir aqui
       * bateria no índice único (loja, etiqueta).
       *
       * Só soma se for o MESMO cadastro (código e nome). Etiqueta igual com
       * peça diferente só acontece com etiqueta digitada à mão, e somar ali
       * juntaria colar com anel.
       */
      SELECT * INTO v_destino
        FROM fv.products
       WHERE store_id = v_transfer.to_store_id
         AND barcode_number = v_origem.barcode_number
         AND id <> v_origem.id
       LIMIT 1
       FOR UPDATE;

      IF FOUND THEN
        IF v_destino.code IS DISTINCT FROM v_origem.code
           OR v_destino.name IS DISTINCT FROM v_origem.name THEN
          v_conflito := true;
        ELSE
          v_achou := true;
        END IF;
      END IF;

      /*
       * 2º, só se não achou pela etiqueta: linha criada por uma transferência
       * ANTERIOR a 16/09, quando o destino ganhava etiqueta nova. Casa pelo
       * `dest_product_id`, nunca por `code` — 227 códigos se repetem dentro da
       * mesma loja e um code cobre até 8 peças distintas.
       */
      IF NOT v_achou AND NOT v_conflito THEN
        SELECT p.* INTO v_destino
          FROM fv.transfer_items ti
          JOIN fv.transfers t  ON t.id = ti.transfer_id
          JOIN fv.products  p  ON p.id = ti.dest_product_id
         WHERE ti.product_id = v_item.product_id
           AND ti.dest_product_id IS NOT NULL
           AND ti.dest_product_id <> v_origem.id
           AND t.to_store_id = v_transfer.to_store_id
           AND p.store_id    = v_transfer.to_store_id
         ORDER BY t.received_at DESC
         LIMIT 1
         FOR UPDATE OF p;

        v_achou := FOUND;
      END IF;

      IF v_achou THEN
        -- Soma na linha que já está no destino.
        UPDATE fv.products
           SET quantity_in_stock = quantity_in_stock + v_recebido,
               is_active = true,
               updated_at = now()
         WHERE id = v_destino.id;

        v_dest_id := v_destino.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_destino.id, v_destino.quantity_in_stock, v_recebido,
          v_destino.quantity_in_stock + v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );

      ELSIF NOT v_conflito
         AND v_falta = 0
         AND v_origem.quantity_in_stock = 0
         AND v_origem.store_id = v_transfer.from_store_id
      THEN
        /*
         * A linha inteira foi embora, chegou inteira e não existe nada dela no
         * destino: ela própria muda de loja, com etiqueta e histórico.
         * (`sales.store_id` fica na venda, então mover a linha não reescreve
         * quem vendeu o quê.)
         */
        UPDATE fv.products
           SET store_id = v_transfer.to_store_id,
               quantity_in_stock = v_recebido,
               is_active = true,
               updated_at = now()
         WHERE id = v_origem.id;

        v_dest_id := v_origem.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_origem.id, 0, v_recebido, v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );

      ELSE
        /*
         * Linha nova no destino. Sem conflito, HERDA a etiqueta — é a mesma
         * peça, com a mesma etiqueta física colada. Com conflito, recebe uma
         * nova pelo DEFAULT da sequência e o item sai marcado para reetiquetar.
         */
        IF v_conflito THEN
          INSERT INTO fv.products (
            code, name, category, material, supplier_id, store_id,
            cost_price, sale_price, promotional_price, promotional_active,
            quantity_in_stock, ownership_type, purchase_month, purchase_year,
            photo_url, supplier_reference, label_format, is_active
          )
          SELECT
            o.code, o.name, o.category, o.material, o.supplier_id, v_transfer.to_store_id,
            o.cost_price, o.sale_price, o.promotional_price, o.promotional_active,
            v_recebido, o.ownership_type, o.purchase_month, o.purchase_year,
            o.photo_url, o.supplier_reference, o.label_format, true
          FROM fv.products o WHERE o.id = v_origem.id
          RETURNING * INTO v_destino;
        ELSE
          INSERT INTO fv.products (
            code, name, category, material, supplier_id, store_id,
            cost_price, sale_price, promotional_price, promotional_active,
            quantity_in_stock, ownership_type, purchase_month, purchase_year,
            photo_url, supplier_reference, label_format, is_active, barcode_number
          )
          SELECT
            o.code, o.name, o.category, o.material, o.supplier_id, v_transfer.to_store_id,
            o.cost_price, o.sale_price, o.promotional_price, o.promotional_active,
            v_recebido, o.ownership_type, o.purchase_month, o.purchase_year,
            o.photo_url, o.supplier_reference, o.label_format, true, o.barcode_number
          FROM fv.products o WHERE o.id = v_origem.id
          RETURNING * INTO v_destino;
        END IF;

        v_dest_id := v_destino.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_destino.id, 0, v_recebido, v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );
      END IF;
    END IF;

    -- ─ o que faltou volta para a origem ─
    IF v_falta > 0 THEN
      v_divergiu := true;

      UPDATE fv.products
         SET quantity_in_stock = quantity_in_stock + v_falta,
             is_active = true,
             updated_at = now()
       WHERE id = v_origem.id;

      INSERT INTO fv.stock_movements (
        product_id, quantity_before, delta, quantity_after,
        reason, ref_type, ref_id, user_id, notes
      ) VALUES (
        v_origem.id, v_origem.quantity_in_stock, v_falta,
        v_origem.quantity_in_stock + v_falta,
        'transferencia_falta', 'transfer', p_transfer_id, p_user_id,
        'Peça não chegou na conferência do destino; saldo devolvido à origem.'
      );
    END IF;

    UPDATE fv.transfer_items
       SET quantity_received = v_recebido,
           dest_product_id = v_dest_id,
           divergence_type = CASE WHEN v_falta > 0 THEN 'falta' ELSE NULL END,
           reetiquetar = v_conflito
     WHERE id = v_item.id;
  END LOOP;

  -- ─ bipado no destino sem estar no romaneio ─
  -- Só fica registrado. Não vira saldo: não se sabe de onde a peça veio.
  FOR v_rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_recebidos, '[]'::jsonb))
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM fv.transfer_items
       WHERE transfer_id = p_transfer_id
         AND product_id = (v_rec->>'product_id')::uuid
    ) THEN
      INSERT INTO fv.transfer_items (
        transfer_id, product_id, product_code, product_name, barcode_number,
        quantity_sent, quantity_received, unit_cost, divergence_type, divergence_notes
      )
      SELECT
        p_transfer_id, p.id, p.code, p.name, p.barcode_number,
        0, COALESCE((v_rec->>'quantity')::integer, 1), p.cost_price, 'sobra',
        'Bipada na conferência sem constar no romaneio. Não deu entrada em estoque.'
      FROM fv.products p WHERE p.id = (v_rec->>'product_id')::uuid;

      v_divergiu := true;
      v_sobras := v_sobras + 1;
    END IF;
  END LOOP;

  UPDATE fv.transfers
     SET status = CASE WHEN v_divergiu THEN 'divergente' ELSE 'recebida' END,
         received_by = p_user_id,
         received_at = now(),
         receipt_notes = p_notes,
         updated_at = now()
   WHERE id = p_transfer_id;

  RETURN json_build_object('success', true,
    'status', CASE WHEN v_divergiu THEN 'divergente' ELSE 'recebida' END,
    'sobras', v_sobras);
END;
$$;

COMMENT ON FUNCTION fv.receber_transferencia IS
  'Confere a chegada. Soma na linha do destino que tem a MESMA etiqueta; se não houver, a linha muda de loja inteira ou nasce herdando a etiqueta. Etiqueta nova só em conflito de cadastro (desde 16/09/2026).';


-- ── 3. Enviar (igual à de 15/09, só sem marcar reetiquetar) ──────────────────

CREATE OR REPLACE FUNCTION fv.enviar_transferencia(
  p_from_store_id uuid,
  p_to_store_id   uuid,
  p_itens         jsonb,   -- [{"product_id": "...", "quantity": 1}, ...]
  p_user_id       uuid,
  p_notes         text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer_id uuid;
  v_item        jsonb;
  v_produto     fv.products%ROWTYPE;
  v_qtd         integer;
  v_pecas       integer := 0;
  v_itens       integer := 0;
  v_custo       numeric(12,2) := 0;
  v_venda       numeric(12,2) := 0;
  v_preco       numeric(12,2);
BEGIN
  IF p_from_store_id = p_to_store_id THEN
    RETURN json_build_object('success', false, 'error', 'Origem e destino não podem ser a mesma loja.');
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Nenhuma peça no romaneio.');
  END IF;

  INSERT INTO fv.transfers (from_store_id, to_store_id, sent_by, notes)
  VALUES (p_from_store_id, p_to_store_id, p_user_id, p_notes)
  RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_qtd := COALESCE((v_item->>'quantity')::integer, 0);

    IF v_qtd <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida para a peça %.', v_item->>'product_id';
    END IF;

    -- FOR UPDATE: duas transferências simultâneas da mesma peça enfileiram, em
    -- vez de as duas lerem o mesmo saldo e mandarem a peça duas vezes.
    SELECT * INTO v_produto
      FROM fv.products
     WHERE id = (v_item->>'product_id')::uuid
       AND store_id = p_from_store_id
       AND is_active = true
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Peça % não está ativa na loja de origem.', v_item->>'product_id';
    END IF;

    IF v_produto.quantity_in_stock < v_qtd THEN
      RAISE EXCEPTION 'Estoque insuficiente de "%" — disponível: %.',
        v_produto.name, v_produto.quantity_in_stock;
    END IF;

    -- Preço que a cliente pagaria hoje. Mesma regra do PDV e da etiqueta:
    -- promoção só vale se estiver ativa E for maior que zero.
    v_preco := COALESCE(
      CASE
        WHEN v_produto.promotional_active AND COALESCE(v_produto.promotional_price, 0) > 0
          THEN v_produto.promotional_price
        ELSE v_produto.sale_price
      END, 0);

    INSERT INTO fv.transfer_items (
      transfer_id, product_id, product_code, product_name, barcode_number,
      quantity_sent, unit_cost, unit_sale_price, reetiquetar
    ) VALUES (
      v_transfer_id, v_produto.id, v_produto.code, v_produto.name, v_produto.barcode_number,
      v_qtd, v_produto.cost_price, v_preco,
      -- Desde 16/09 a etiqueta é única POR LOJA: parcial chega com a mesma
      -- etiqueta que está colada na peça. Só vira true na chegada, no caso
      -- raro de conflito de cadastro — ver receber_transferencia.
      false
    );

    UPDATE fv.products
       SET quantity_in_stock = quantity_in_stock - v_qtd,
           -- Zerou: sai das listas de estoque enquanto está em trânsito. Volta a
           -- ficar ativa no destino, na conferência.
           is_active = (quantity_in_stock - v_qtd) > 0,
           updated_at = now()
     WHERE id = v_produto.id;

    INSERT INTO fv.stock_movements (
      product_id, quantity_before, delta, quantity_after,
      reason, ref_type, ref_id, user_id
    ) VALUES (
      v_produto.id, v_produto.quantity_in_stock, -v_qtd, v_produto.quantity_in_stock - v_qtd,
      'transferencia_envio', 'transfer', v_transfer_id, p_user_id
    );

    v_pecas := v_pecas + v_qtd;
    v_itens := v_itens + 1;
    v_custo := v_custo + (v_produto.cost_price * v_qtd);
    v_venda := v_venda + (v_preco * v_qtd);
  END LOOP;

  UPDATE fv.transfers
     SET totals = json_build_object('pecas', v_pecas, 'itens', v_itens,
                                    'custo_total', v_custo, 'venda_total', v_venda),
         updated_at = now()
   WHERE id = v_transfer_id;

  RETURN json_build_object('success', true, 'transfer_id', v_transfer_id,
                           'pecas', v_pecas, 'itens', v_itens,
                           'custo_total', v_custo, 'venda_total', v_venda);
END;
$$;


-- ── 4. Romaneios em trânsito ─────────────────────────────────────────────────

UPDATE fv.transfer_items ti
   SET reetiquetar = false
  FROM fv.transfers t
 WHERE t.id = ti.transfer_id
   AND t.status = 'enviada'
   AND ti.reetiquetar;
