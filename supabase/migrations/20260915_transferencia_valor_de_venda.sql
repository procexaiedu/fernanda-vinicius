-- ============================================================================
-- Transferência: guardar também o valor de VENDA do que foi enviado
-- ============================================================================
--
-- Pedido da dona na reunião de 15/09, com estas palavras:
--
--   "Eu preciso ver valor, porque aí eu vou vendo o valor total, eu vejo se tá
--    bom ou se eu mando mais."
--   "Coloca assim, ó: peça, custo e venda."
--
-- O rodapé da tela de montagem já mostra os três (calcula no navegador). O que
-- falta é DEPOIS: ela perguntou "nem no final, quando é acabada, dá pra ver?".
-- Hoje `transfers.totals` guarda só pecas/itens/custo_total, e `transfer_items`
-- só `unit_cost` — o preço de venda do momento do envio não existe em lugar
-- nenhum.
--
--
-- POR QUE SNAPSHOT, E NÃO JOIN COM products
--
-- Preço de venda muda. Se o romaneio de hoje for exibido amanhã com o preço de
-- amanhã, o papel dentro da caixa e a tela passam a discordar — que é
-- exatamente o motivo de `unit_cost` já ser copiado para a linha do item em vez
-- de lido de `products`. O de venda segue a mesma regra.
--
-- Guarda o preço EFETIVO (promoção já aplicada, e só se estiver ativa e maior
-- que zero), que é a mesma regra do PDV, da etiqueta e da conferência. Guardar
-- o preço cheio daria um total que ela nunca vai cobrar.
--
--
-- ROMANEIO ANTIGO NÃO GANHA O NÚMERO
--
-- `unit_sale_price` fica NULL nos itens já enviados e `venda_total` ausente nos
-- totals anteriores a esta migração. Não dá para reconstruir: o preço daquele
-- dia não foi guardado. A tela trata o ausente como "—", nunca como R$ 0,00 —
-- zero seria uma mentira precisa, e ela usa esse número para decidir quanto
-- mandar para a outra loja.
-- ============================================================================

ALTER TABLE fv.transfer_items
  ADD COLUMN IF NOT EXISTS unit_sale_price numeric(12,2);

COMMENT ON COLUMN fv.transfer_items.unit_sale_price IS
  'Preço de venda efetivo (promoção aplicada) no instante do envio. NULL nos romaneios anteriores a 15/09/2026, quando o campo passou a existir — não é zero, é desconhecido.';

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
      -- Parcial: no destino vira linha nova, com código de barras novo.
      v_qtd < v_produto.quantity_in_stock
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

COMMENT ON FUNCTION fv.enviar_transferencia IS
  'Abre o romaneio e tira o saldo da origem. Tudo numa transação: se uma peça falhar, nenhuma sai. Congela custo e preço de venda de cada peça no envio.';
