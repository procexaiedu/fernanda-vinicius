-- ============================================================================
-- Transferência: ENVIO sem conferência (entrada automática na ida)
-- ============================================================================
--
-- Pedido da Fernanda (21/09). Ela leva as peças na mão entre as lojas, então
-- não faz sentido "conferir o que chegou" na IDA — chegou tudo, ela carregou.
--
--   IDA (envio):     ao enviar, as peças JÁ entram no estoque do destino.
--                    Sem bipar, sem tela de conferência.
--   VOLTA (devolução): o que não vendeu volta; aí sim ela BIPA cada peça e o
--                    bipe dá entrada (é a conferência do que voltou). Esse
--                    fluxo NÃO muda — segue enviar('enviada') + receber por bipe.
--
-- COMO: `enviar_transferencia` ganha `p_auto_receber`. Quando true, depois de
-- criar a transferência ('enviada') e baixar a origem como sempre, ela CHAMA
-- `fv.receber_transferencia` com tudo o que foi enviado. Reusar (em vez de
-- reescrever) é o que garante que a entrada automática HERDA a etiqueta única
-- por loja, gera os mesmos stock_movements de recebimento e marca 'recebida' —
-- exatamente como uma conferência 100% batida, só que sem a pessoa bipar.
-- Tudo na MESMA transação: se o recebimento falhar, o envio inteiro desfaz.
--
-- Assinatura: dropamos a versão de 5 args e criamos a de 6 (com default). Duas
-- versões coexistindo dariam "function is not unique" quando o cliente chama
-- por parâmetro nomeado.
-- ============================================================================

DROP FUNCTION IF EXISTS fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text);

CREATE OR REPLACE FUNCTION fv.enviar_transferencia(
  p_from_store_id uuid,
  p_to_store_id   uuid,
  p_itens         jsonb,   -- [{"product_id": "...", "quantity": 1}, ...]
  p_user_id       uuid,
  p_notes         text DEFAULT NULL,
  p_auto_receber  boolean DEFAULT false   -- IDA: entra direto no destino, sem bipe
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
  v_rec         json;
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
      false
    );

    UPDATE fv.products
       SET quantity_in_stock = quantity_in_stock - v_qtd,
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

  -- IDA (envio sem conferência): entra direto no destino, reusando o recebimento
  -- (herda etiqueta, gera os movimentos e marca 'recebida'). Mesma transação: se
  -- falhar, o RAISE desfaz o envio inteiro.
  IF p_auto_receber THEN
    v_rec := fv.receber_transferencia(
      v_transfer_id, p_itens, p_user_id,
      'Entrada automática no envio (sem conferência).'
    );
    IF NOT COALESCE((v_rec->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'Falha na entrada automática: %', COALESCE(v_rec->>'error', 'desconhecido');
    END IF;

    RETURN json_build_object('success', true, 'transfer_id', v_transfer_id,
                             'pecas', v_pecas, 'itens', v_itens,
                             'custo_total', v_custo, 'venda_total', v_venda,
                             'auto_recebida', true);
  END IF;

  RETURN json_build_object('success', true, 'transfer_id', v_transfer_id,
                           'pecas', v_pecas, 'itens', v_itens,
                           'custo_total', v_custo, 'venda_total', v_venda);
END;
$$;

COMMENT ON FUNCTION fv.enviar_transferencia IS
  'Envia peças entre lojas. p_auto_receber=true (IDA): já dá entrada no destino reusando receber_transferencia (herda etiqueta, marca recebida), sem conferência. false (VOLTA/devolução): fica enviada e a chegada é conferida por bipe.';
