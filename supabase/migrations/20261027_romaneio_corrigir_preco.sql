-- Correção administrativa explícita, só lote de fornecedor aguardando chegada.
-- Não toca custo, quantidade, financeiro, identidade ou vendas.
BEGIN;
CREATE TABLE fv.romaneio_price_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES fv.transfers(id),
  item_id uuid NOT NULL REFERENCES fv.transfer_items(id),
  product_id uuid NOT NULL REFERENCES fv.products(id),
  changed_by uuid NOT NULL REFERENCES fv.users(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  previous_sale_price numeric(12,2) NOT NULL,
  sale_price numeric(12,2) NOT NULL,
  previous_label_price numeric(12,2),
  label_price numeric(12,2) NOT NULL
);
ALTER TABLE fv.romaneio_price_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fv.romaneio_price_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON fv.romaneio_price_changes TO service_role;

CREATE FUNCTION fv.corrigir_preco_romaneio(
  p_transfer_id uuid, p_item_id uuid, p_sale_price numeric,
  p_expected jsonb, p_user_id uuid, p_store_scope uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = fv, pg_temp AS $$
DECLARE
  t fv.transfers%ROWTYPE;
  i fv.transfer_items%ROWTYPE;
  pr fv.products%ROWTYPE;
  u fv.users%ROWTYPE;
  effective numeric(12,2);
  total numeric(12,2);
BEGIN
  SELECT * INTO u FROM fv.users WHERE id = p_user_id AND is_active;
  IF NOT FOUND OR u.role <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Somente administradores podem corrigir preços.');
  END IF;
  -- Mesma ordem do recebimento: transferência primeiro, depois produto.
  SELECT * INTO t FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR (u.store_id IS NOT NULL AND u.store_id <> t.to_store_id)
    OR (p_store_scope IS NOT NULL AND p_store_scope <> t.to_store_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Romaneio fora da sua loja ou não encontrado.');
  END IF;
  IF t.kind <> 'lote_fornecedor' OR t.status <> 'enviada' OR t.purchase_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Correção permitida somente em lote do fornecedor aguardando recebimento.');
  END IF;
  SELECT * INTO i FROM fv.transfer_items WHERE id = p_item_id AND transfer_id = t.id FOR UPDATE;
  IF NOT FOUND OR i.quantity_sent <= 0 OR i.quantity_received IS NOT NULL OR i.dest_product_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item já conferido ou não pertence ao romaneio.');
  END IF;
  SELECT * INTO pr FROM fv.products WHERE id = i.product_id FOR UPDATE;
  IF NOT FOUND OR pr.store_id <> t.to_store_id OR pr.barcode_number IS DISTINCT FROM i.barcode_number
    OR pr.code IS DISTINCT FROM i.product_code THEN
    RETURN jsonb_build_object('success', false, 'error', 'Identidade da peça mudou. Recarregue e solicite revisão administrativa.');
  END IF;
  IF p_sale_price IS NULL OR p_sale_price::text IN ('NaN','Infinity','-Infinity')
    OR p_sale_price <= 0 OR p_sale_price > 9999999999.99 OR round(p_sale_price, 2) <> p_sale_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe um preço positivo com até duas casas decimais.');
  END IF;
  IF p_expected IS NULL
    OR (p_expected->>'transfer_updated_at')::timestamptz IS DISTINCT FROM t.updated_at
    OR (p_expected->>'product_updated_at')::timestamptz IS DISTINCT FROM pr.updated_at
    OR (p_expected->>'sale_price')::numeric IS DISTINCT FROM pr.sale_price
    OR (p_expected->>'promotional_price')::numeric IS DISTINCT FROM pr.promotional_price
    OR (p_expected->>'promotional_active')::boolean IS DISTINCT FROM pr.promotional_active
    OR (p_expected->>'unit_sale_price')::numeric IS DISTINCT FROM i.unit_sale_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Os dados mudaram em outra sessão. Feche e reabra os itens antes de salvar.');
  END IF;
  -- Cadastro compartilhado exige decisão própria: não propagar silenciosamente.
  IF pr.quantity_in_stock <> 0
    OR EXISTS (SELECT 1 FROM fv.sale_items WHERE product_id = pr.id)
    OR EXISTS (SELECT 1 FROM fv.transfer_items WHERE (product_id = pr.id OR dest_product_id = pr.id) AND id <> i.id)
    OR EXISTS (SELECT 1 FROM fv.purchase_items WHERE product_id = pr.id AND purchase_id <> t.purchase_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça com saldo, venda ou outro vínculo. A correção exige revisão específica para preservar o histórico.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fv.purchase_items WHERE purchase_id = t.purchase_id AND product_id = pr.id)
    OR EXISTS (SELECT 1 FROM fv.transfer_items WHERE transfer_id = t.id AND quantity_sent > 0 AND unit_sale_price IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vínculo da compra ou preços do romaneio incompletos. Solicite revisão administrativa.');
  END IF;
  effective := CASE WHEN pr.promotional_active AND COALESCE(pr.promotional_price, 0) > 0
                    THEN pr.promotional_price ELSE p_sale_price END;
  -- Auditoria e os três valores são atômicos. Falha em qualquer escrita reverte tudo.
  INSERT INTO fv.romaneio_price_changes(transfer_id,item_id,product_id,changed_by,previous_sale_price,sale_price,previous_label_price,label_price)
    VALUES (t.id,i.id,pr.id,u.id,pr.sale_price,p_sale_price,i.unit_sale_price,effective);
  UPDATE fv.products SET sale_price = p_sale_price, updated_at = clock_timestamp() WHERE id = pr.id;
  UPDATE fv.transfer_items SET unit_sale_price = effective WHERE id = i.id;
  SELECT sum(quantity_sent * unit_sale_price) INTO total FROM fv.transfer_items WHERE transfer_id = t.id AND quantity_sent > 0;
  UPDATE fv.transfers SET totals = jsonb_set(COALESCE(totals, '{}'::jsonb), '{venda_total}', to_jsonb(total)),
    updated_at = clock_timestamp() WHERE id = t.id;
  RETURN jsonb_build_object('success', true, 'effective_price', effective);
END;
$$;
REVOKE ALL ON FUNCTION fv.corrigir_preco_romaneio(uuid,uuid,numeric,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.corrigir_preco_romaneio(uuid,uuid,numeric,jsonb,uuid,uuid) TO service_role;
COMMIT;
