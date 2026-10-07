-- ─────────────────────────────────────────────────────────────────────────────
-- Conferência da chegada: duas remessas da MESMA peça em trânsito (07/10/2026)
--
-- DEFEITO (achado no teste ponta a ponta local de 07/10, dados fictícios):
-- Campinas manda o brinco 90001 em duas caixas (1 + 2 unidades) e o saldo de lá
-- zera. Brasília confere a 1ª caixa inteira: como a origem ficou com 0 e nada
-- faltou, receber_transferencia MUDA A LINHA de loja (store_id = Brasília).
-- A 2ª caixa ainda aponta para essa mesma linha. Ao conferi-la:
--   * o que chegou tenta INSERIR outra linha com a etiqueta 90001 em Brasília
--     → "duplicate key value violates unique constraint idx_products_loja_etiqueta"
--     e a conferência não fecha (a operadora fica travada);
--   * se faltasse alguma, o saldo da falta voltava para a linha... que já está
--     em Brasília (loja errada). cancelar_transferencia tem o mesmo efeito.
--
-- CORREÇÃO:
--   1. Raiz: a linha só muda de loja se NENHUMA outra remessa 'enviada' tiver
--      essa peça. Senão nasce linha nova no destino herdando a etiqueta (o
--      caminho que já existia) e a linha da origem fica lá, com 0.
--   2. Defesa para linhas que JÁ mudaram antes desta migration: se a linha da
--      origem está no destino, o que chegou soma nela, e a falta volta para a
--      linha da origem com a mesma etiqueta (ou recria essa linha lá).
--
-- Só troca o corpo da função (CREATE OR REPLACE mantém dono e GRANTs).
-- Teste: supabase/tests/20261007_receber_duas_remessas_mesma_peca.test.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION fv.receber_transferencia(p_transfer_id uuid, p_recebidos jsonb, p_user_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_movida      boolean;
  v_volta       fv.products%ROWTYPE;
BEGIN
  SELECT * INTO v_transfer FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Transferência não encontrada.');
  END IF;

  IF v_transfer.status <> 'enviada' THEN
    RETURN json_build_object('success', false,
      'error', format('Esta transferência já está como "%s".', v_transfer.status));
  END IF;

  IF v_transfer.kind = 'lote_fornecedor' AND v_transfer.purchase_id IS NULL THEN
    RETURN json_build_object('success', false,
      'error', 'A compra deste lote foi excluída. Cancele a remessa em vez de conferir.');
  END IF;

  FOR v_item IN
    SELECT * FROM fv.transfer_items
     WHERE transfer_id = p_transfer_id AND quantity_sent > 0
     ORDER BY product_name
  LOOP
    SELECT COALESCE(MAX((r->>'quantity')::integer), 0) INTO v_recebido
      FROM jsonb_array_elements(COALESCE(p_recebidos, '[]'::jsonb)) r
     WHERE (r->>'product_id')::uuid = v_item.product_id;

    IF v_recebido > v_item.quantity_sent THEN
      v_recebido := v_item.quantity_sent;
    END IF;

    v_falta    := v_item.quantity_sent - v_recebido;
    v_dest_id  := NULL;
    v_conflito := false;
    v_achou    := false;

    SELECT * INTO v_origem FROM fv.products WHERE id = v_item.product_id FOR UPDATE;

    /*
     * A linha da origem JÁ ESTÁ no destino: outra remessa da mesma peça foi
     * recebida inteira antes desta e levou a linha (ramo "muda de loja" abaixo,
     * antes de 07/10 ele não olhava se havia outra remessa em trânsito). O que
     * chega soma nela; inserir outra linha com a mesma etiqueta batia no índice
     * único (loja, etiqueta) e a conferência não fechava.
     */
    v_movida := v_transfer.kind <> 'lote_fornecedor'
                AND v_origem.store_id = v_transfer.to_store_id;

    IF v_transfer.kind = 'lote_fornecedor' THEN
      /*
       * Lote de fornecedor: a peça já está cadastrada NO DESTINO, com o saldo
       * desta remessa fora do estoque. O que chegou soma nela; o que faltou
       * não volta para lugar nenhum (nunca esteve em estoque de loja) e fica
       * como falta para a admin resolver com a fornecedora.
       */
      IF v_recebido > 0 THEN
        UPDATE fv.products
           SET quantity_in_stock = quantity_in_stock + v_recebido,
               is_active = true,
               updated_at = now()
         WHERE id = v_origem.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_origem.id, v_origem.quantity_in_stock, v_recebido,
          v_origem.quantity_in_stock + v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );
        v_dest_id := v_origem.id;
      END IF;

      IF v_falta > 0 THEN
        v_divergiu := true;
      END IF;

      UPDATE fv.transfer_items
         SET quantity_received = v_recebido,
             dest_product_id = v_dest_id,
             divergence_type = CASE WHEN v_falta > 0 THEN 'falta' ELSE NULL END
       WHERE id = v_item.id;

      CONTINUE;
    END IF;

    IF v_recebido > 0 THEN
      IF v_movida THEN
        v_destino := v_origem;
        v_achou   := true;
      ELSE
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
      END IF;

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
         -- Outra remessa com esta peça ainda em trânsito: a linha fica na
         -- origem, senão a falta ou o cancelamento daquela devolveria o saldo
         -- para a loja errada (07/10/2026).
         AND NOT EXISTS (
           SELECT 1 FROM fv.transfer_items ti2
             JOIN fv.transfers t2 ON t2.id = ti2.transfer_id
            WHERE ti2.product_id = v_origem.id
              AND t2.status = 'enviada'
              AND t2.id <> p_transfer_id
         )
      THEN
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

    IF v_falta > 0 AND v_movida THEN
      /*
       * A falta volta para a ORIGEM, e a linha não está mais lá: soma na linha
       * da origem com a mesma etiqueta ou recria a linha lá, herdando a etiqueta.
       */
      v_divergiu := true;

      SELECT * INTO v_volta
        FROM fv.products
       WHERE store_id = v_transfer.from_store_id
         AND barcode_number = v_origem.barcode_number
       LIMIT 1
       FOR UPDATE;

      IF FOUND THEN
        UPDATE fv.products
           SET quantity_in_stock = quantity_in_stock + v_falta,
               is_active = true,
               updated_at = now()
         WHERE id = v_volta.id;
      ELSE
        INSERT INTO fv.products (
          code, name, category, material, supplier_id, store_id,
          cost_price, sale_price, promotional_price, promotional_active,
          quantity_in_stock, ownership_type, purchase_month, purchase_year,
          photo_url, supplier_reference, label_format, is_active, barcode_number
        )
        SELECT
          o.code, o.name, o.category, o.material, o.supplier_id, v_transfer.from_store_id,
          o.cost_price, o.sale_price, o.promotional_price, o.promotional_active,
          v_falta, o.ownership_type, o.purchase_month, o.purchase_year,
          o.photo_url, o.supplier_reference, o.label_format, true, o.barcode_number
        FROM fv.products o WHERE o.id = v_origem.id
        RETURNING * INTO v_volta;

        v_volta.quantity_in_stock := 0;   -- para o movimento abaixo: 0 → falta
      END IF;

      INSERT INTO fv.stock_movements (
        product_id, quantity_before, delta, quantity_after,
        reason, ref_type, ref_id, user_id, notes
      ) VALUES (
        v_volta.id, v_volta.quantity_in_stock, v_falta,
        v_volta.quantity_in_stock + v_falta,
        'transferencia_falta', 'transfer', p_transfer_id, p_user_id,
        'Peça não chegou na conferência do destino; saldo devolvido à origem.'
      );

    ELSIF v_falta > 0 THEN
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
$function$;

COMMIT;
