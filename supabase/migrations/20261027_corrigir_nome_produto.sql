-- Atualiza somente o cadastro atual. Snapshots de compra/venda/envio são preservados.
-- Serviço autenticado no servidor; sem acesso RPC direto por anon/authenticated.
CREATE OR REPLACE FUNCTION fv.corrigir_nome_produto(
  p_product_id uuid, p_store_id uuid, p_name text, p_expected_name text,
  p_user_id uuid, p_store_scope uuid,
  p_transfer_id uuid DEFAULT NULL, p_item_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = fv, pg_temp AS $$
DECLARE
  u fv.users%ROWTYPE;
  p fv.products%ROWTYPE;
  t fv.transfers%ROWTYPE;
  i fv.transfer_items%ROWTYPE;
  scope_id uuid;
  novo text := btrim(p_name);
BEGIN
  SELECT * INTO u FROM fv.users WHERE id = p_user_id AND is_active;
  IF NOT FOUND OR u.role <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Somente administradores podem corrigir o nome.');
  END IF;
  scope_id := coalesce(u.store_id, p_store_scope);
  IF novo IS NULL OR novo = '' OR novo ~ '[[:cntrl:]]' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe um nome sem quebras de linha ou caracteres de controle.');
  END IF;
  IF (p_transfer_id IS NULL) <> (p_item_id IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item do romaneio inválido.');
  END IF;
  IF p_transfer_id IS NOT NULL THEN
    -- Mesma ordem de travas do recebimento/correção de preço: romaneio antes da peça.
    SELECT * INTO t FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND OR t.kind IS DISTINCT FROM 'lote_fornecedor'
      OR t.status IS DISTINCT FROM 'enviada' OR t.purchase_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Correção permitida somente em lote do fornecedor aguardando recebimento.');
    END IF;
    IF scope_id IS NOT NULL AND scope_id <> t.to_store_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Somente a administração da loja de destino pode corrigir este lote.');
    END IF;
    SELECT * INTO i FROM fv.transfer_items WHERE id = p_item_id AND transfer_id = t.id FOR UPDATE;
    IF NOT FOUND OR coalesce(i.quantity_sent, 0) <= 0
      OR coalesce(i.dest_product_id, i.product_id) IS DISTINCT FROM p_product_id
      OR t.to_store_id IS DISTINCT FROM p_store_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cadastro da peça indisponível neste romaneio. Reabra os itens.');
    END IF;
  END IF;
  SELECT * INTO p FROM fv.products WHERE id = p_product_id AND store_id = p_store_id FOR UPDATE;
  IF NOT FOUND OR (scope_id IS NOT NULL AND p.store_id <> scope_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Produto indisponível nesta loja.');
  END IF;
  IF p.name IS DISTINCT FROM p_expected_name THEN
    RETURN jsonb_build_object('success', false, 'error', 'O nome mudou em outra sessão. Reabra a peça antes de salvar.');
  END IF;
  IF p.name IS DISTINCT FROM novo THEN
    UPDATE fv.products SET name = novo, updated_at = clock_timestamp()
      WHERE id = p.id AND store_id = p.store_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'name', novo);
END;
$$;
REVOKE ALL ON FUNCTION fv.corrigir_nome_produto(uuid,uuid,text,text,uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.corrigir_nome_produto(uuid,uuid,text,text,uuid,uuid,uuid,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
