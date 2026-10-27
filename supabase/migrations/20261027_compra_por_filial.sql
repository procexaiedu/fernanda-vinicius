-- Compra própria: Campinas entra direto, demais filiais conferem.
-- Só afeta compras novas. Consignações e remessas existentes ficam intactas.
BEGIN;

ALTER TABLE fv.stores ADD COLUMN IF NOT EXISTS purchase_enters_directly boolean NOT NULL DEFAULT false;
-- Antes de aplicar, confirmar o ID na fonte autorizada e definir na sessão:
-- SET fv.compra_direta_campinas_id = '<UUID confirmado de Campinas>';
-- Sem confirmação não atribui política e a transação inteira é desfeita.
DO $$
DECLARE
  v_id uuid := nullif(current_setting('fv.compra_direta_campinas_id', true), '')::uuid;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Confirme o ID de Campinas e defina fv.compra_direta_campinas_id antes de aplicar.'; END IF;
  IF (SELECT count(*) FROM fv.stores WHERE is_active AND name = 'Campinas' AND city = 'Campinas' AND state = 'SP') <> 1
     OR NOT EXISTS (SELECT 1 FROM fv.stores WHERE id = v_id AND is_active AND name = 'Campinas' AND city = 'Campinas' AND state = 'SP')
     OR (SELECT count(*) FROM fv.stores WHERE is_active AND name = 'Brasília' AND city = 'Brasília' AND state = 'DF') <> 1
     OR EXISTS (SELECT 1 FROM fv.stores WHERE purchase_enters_directly AND id <> v_id) THEN
    RAISE EXCEPTION 'Configuração de filiais divergente: nenhuma política foi aplicada.';
  END IF;
  UPDATE fv.stores SET purchase_enters_directly = true WHERE id = v_id;
END;
$$;
COMMENT ON COLUMN fv.stores.purchase_enters_directly IS
  'Entrada de compras próprias novas: true = estoque direto; false = lote de fornecedor com conferência. Não altera consignações nem compras anteriores.';

-- A sobrecarga abaixo conserva a função antiga usada por consignações.

CREATE OR REPLACE FUNCTION fv.abrir_remessas_do_fornecedor(
  p_purchase_id uuid,
  p_user_id     uuid,
  p_lojas       uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_loja     uuid;
  v_transfer uuid;
  v_ids      uuid[] := ARRAY[]::uuid[];
  v_l        record;
  v_tirar    integer;
  v_pecas    integer;
  v_itens    integer;
  v_custo    numeric(12,2);
  v_venda    numeric(12,2);
  v_preco    numeric(12,2);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fv.remessa_compra:' || p_purchase_id::text, 0));

  IF EXISTS (SELECT 1 FROM fv.transfers WHERE purchase_id = p_purchase_id AND kind = 'lote_fornecedor') THEN
    RETURN jsonb_build_object('remessas',
      (SELECT jsonb_agg(id) FROM fv.transfers WHERE purchase_id = p_purchase_id AND kind = 'lote_fornecedor'),
      'repetido', true);
  END IF;

  FOR v_loja IN
    SELECT DISTINCT pr.store_id
      FROM fv.purchase_items pi
      JOIN fv.products pr ON pr.id = pi.product_id
     WHERE pi.purchase_id = p_purchase_id
       AND pr.store_id IS NOT NULL
       AND pr.store_id = ANY(p_lojas)
     ORDER BY 1
  LOOP
    INSERT INTO fv.transfers (from_store_id, to_store_id, sent_by, notes, kind, purchase_id)
    VALUES (NULL, v_loja, p_user_id,
            'Compra do fornecedor: entra no estoque na conferência.',
            'lote_fornecedor', p_purchase_id)
    RETURNING id INTO v_transfer;

    v_pecas := 0; v_itens := 0; v_custo := 0; v_venda := 0;

    FOR v_l IN
      SELECT pr.id, pr.code, pr.name, pr.barcode_number, pr.quantity_in_stock,
             pr.sale_price, pr.promotional_price, pr.promotional_active,
             sum(pi.quantity)::integer AS qtd,
             max(pi.unit_cost) AS custo
        FROM fv.purchase_items pi
        JOIN fv.products pr ON pr.id = pi.product_id
       WHERE pi.purchase_id = p_purchase_id
         AND pr.store_id = v_loja
       GROUP BY pr.id
       ORDER BY pr.id          -- ordem fixa de travas: evita deadlock com vendas
    LOOP
      PERFORM 1 FROM fv.products WHERE id = v_l.id FOR UPDATE;
      v_tirar := least(v_l.qtd, v_l.quantity_in_stock);
      CONTINUE WHEN v_tirar <= 0;

      v_preco := COALESCE(CASE WHEN v_l.promotional_active AND COALESCE(v_l.promotional_price, 0) > 0
                               THEN v_l.promotional_price ELSE v_l.sale_price END, 0);

      INSERT INTO fv.transfer_items (
        transfer_id, product_id, product_code, product_name, barcode_number,
        quantity_sent, unit_cost, unit_sale_price, reetiquetar
      ) VALUES (
        v_transfer, v_l.id, v_l.code, v_l.name, v_l.barcode_number,
        v_tirar, COALESCE(v_l.custo, 0), v_preco, false
      );

      UPDATE fv.products
         SET quantity_in_stock = quantity_in_stock - v_tirar,
             is_active = (quantity_in_stock - v_tirar) > 0,
             updated_at = now()
       WHERE id = v_l.id;

      INSERT INTO fv.stock_movements (
        product_id, quantity_before, delta, quantity_after,
        reason, ref_type, ref_id, user_id, notes
      ) VALUES (
        v_l.id, v_l.quantity_in_stock, -v_tirar, v_l.quantity_in_stock - v_tirar,
        'lote_em_transito', 'transfer', v_transfer, p_user_id,
        'Peça da compra em trânsito; entra no estoque na conferência da loja.'
      );

      v_pecas := v_pecas + v_tirar;
      v_itens := v_itens + 1;
      v_custo := v_custo + COALESCE(v_l.custo, 0) * v_tirar;
      v_venda := v_venda + v_preco * v_tirar;
    END LOOP;

    IF v_itens = 0 THEN
      DELETE FROM fv.transfers WHERE id = v_transfer;
      CONTINUE;
    END IF;

    UPDATE fv.transfers
       SET totals = jsonb_build_object('pecas', v_pecas, 'itens', v_itens,
                                       'custo_total', v_custo, 'venda_total', v_venda),
           updated_at = now()
     WHERE id = v_transfer;

    v_ids := v_ids || v_transfer;
  END LOOP;

  RETURN jsonb_build_object('remessas', to_jsonb(v_ids));
END;
$$;


REVOKE ALL ON FUNCTION fv.abrir_remessas_do_fornecedor(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.abrir_remessas_do_fornecedor(uuid, uuid, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION fv.salvar_compra_conferida(p jsonb, p_entra_direto boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path = fv, pg_temp AS $$
DECLARE
  v_r jsonb;
  v_m jsonb;
  v_lojas uuid[];
  v_consig boolean := COALESCE((p->>'is_consignment')::boolean, false);
BEGIN
  v_r := fv.salvar_compra(p);
  -- Reenvio nunca converte compra antiga ou lote em trânsito para outra política.
  IF v_r ? 'erro' OR COALESCE((v_r->>'ja_existia')::boolean, false) THEN
    RETURN v_r;
  END IF;

  IF v_consig THEN
    IF COALESCE(p_entra_direto, false) THEN RETURN v_r; END IF;
    v_m := fv.abrir_remessas_do_fornecedor((v_r->>'purchase_id')::uuid, (p->>'user_id')::uuid);
  ELSE
    -- Valida o destino gravado, não o checkbox do navegador.
    SELECT COALESCE(array_agg(DISTINCT pr.store_id ORDER BY pr.store_id), ARRAY[]::uuid[])
      INTO v_lojas
      FROM fv.purchase_items pi
      JOIN fv.products pr ON pr.id = pi.product_id
      JOIN fv.stores s ON s.id = pr.store_id
     WHERE pi.purchase_id = (v_r->>'purchase_id')::uuid
       AND NOT s.purchase_enters_directly;
    v_m := fv.abrir_remessas_do_fornecedor((v_r->>'purchase_id')::uuid, (p->>'user_id')::uuid, v_lojas);
  END IF;
  RETURN v_r || jsonb_build_object('remessas', v_m->'remessas');
END;
$$;

REVOKE ALL ON FUNCTION fv.salvar_compra_conferida(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.salvar_compra_conferida(jsonb, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
