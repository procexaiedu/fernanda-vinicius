-- Função RPC atômica para transferência de estoque entre lojas
-- SECURITY DEFINER garante que a função roda com privilégios de superuser
-- independente do papel do usuário que a chama.

CREATE OR REPLACE FUNCTION fv.transfer_stock(
  p_product_id    uuid,
  p_from_store_id uuid,
  p_to_store_id   uuid,
  p_quantity      integer,
  p_user_id       uuid,
  p_notes         text DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_product        fv.products%ROWTYPE;
  v_dest_product   fv.products%ROWTYPE;
  v_transfer_id    uuid;
BEGIN
  -- 1. Validações básicas
  IF p_from_store_id = p_to_store_id THEN
    RETURN json_build_object('success', false, 'error', 'Loja de origem e destino não podem ser iguais.');
  END IF;

  IF p_quantity <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Quantidade deve ser maior que zero.');
  END IF;

  -- 2. Lock e validar produto origem (FOR UPDATE previne race condition)
  SELECT * INTO v_product
    FROM fv.products
    WHERE id = p_product_id
      AND store_id = p_from_store_id
      AND is_active = true
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Produto não encontrado na loja de origem ou está inativo.');
  END IF;

  IF v_product.quantity_in_stock < p_quantity THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Estoque insuficiente. Disponível: %s unidade(s).', v_product.quantity_in_stock)
    );
  END IF;

  -- 3. Decrementar origem
  UPDATE fv.products
    SET quantity_in_stock = quantity_in_stock - p_quantity,
        updated_at = NOW()
    WHERE id = p_product_id;

  -- 4. Verificar se produto já existe na loja destino (mesmo code + supplier_id)
  SELECT * INTO v_dest_product
    FROM fv.products
    WHERE code = v_product.code
      AND supplier_id = v_product.supplier_id
      AND store_id = p_to_store_id
    LIMIT 1;

  IF FOUND THEN
    -- 4a. Produto já existe no destino: incrementar quantidade e reativar se inativo
    UPDATE fv.products
      SET quantity_in_stock = quantity_in_stock + p_quantity,
          is_active = true,
          updated_at = NOW()
      WHERE id = v_dest_product.id;
  ELSE
    -- 4b. Produto não existe no destino: criar novo row como cópia
    INSERT INTO fv.products (
      code, name, category, material,
      supplier_id, store_id,
      cost_price, sale_price, promotional_price,
      quantity_in_stock, ownership_type,
      purchase_month, purchase_year,
      photo_url, is_active
    ) VALUES (
      v_product.code, v_product.name, v_product.category, v_product.material,
      v_product.supplier_id, p_to_store_id,
      v_product.cost_price, v_product.sale_price, v_product.promotional_price,
      p_quantity, v_product.ownership_type,
      v_product.purchase_month, v_product.purchase_year,
      v_product.photo_url, true
    );
  END IF;

  -- 5. Registrar no histórico de transferências
  INSERT INTO fv.stock_transfers (
    product_id, from_store_id, to_store_id, quantity, user_id, notes
  ) VALUES (
    p_product_id, p_from_store_id, p_to_store_id, p_quantity, p_user_id, p_notes
  ) RETURNING id INTO v_transfer_id;

  -- 6. Se origem ficou com qty = 0, inativar automaticamente
  IF (v_product.quantity_in_stock - p_quantity) = 0 THEN
    UPDATE fv.products
      SET is_active = false, updated_at = NOW()
      WHERE id = p_product_id;
  END IF;

  RETURN json_build_object('success', true, 'transfer_id', v_transfer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permissão: apenas authenticated pode chamar (a Server Action valida role admin antes)
GRANT EXECUTE ON FUNCTION fv.transfer_stock(uuid, uuid, uuid, integer, uuid, text) TO authenticated;
