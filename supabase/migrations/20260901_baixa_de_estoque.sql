-- ============================================================================
-- Baixa manual de estoque: peça com defeito, devolvida ao fornecedor, perdida
-- ============================================================================
--
-- Pedido no treinamento de 31/08: a dona tinha um colar e dois brincos com
-- defeito para devolver ao fornecedor e não conseguia tirar do estoque. A
-- orientação na hora foi "deixa aí e avisa a equipe" — ou seja, o estoque fica
-- errado de propósito até alguém mexer no banco.
--
--
-- NÃO CRIA TABELA NOVA.
--
-- `fv.stock_movements` já é o diário de ajustes de estoque, criado na migration
-- 20260824 para a conferência. Ele já guarda quantidade antes, delta,
-- quantidade depois, motivo, quem e observação — que é exatamente o que uma
-- baixa precisa registrar.
--
-- Uma tabela `stock_adjustments` separada daria DOIS lugares contando a mesma
-- história, e um dia os dois discordariam. O ledger existe para isso; usar.
--
--
-- POR QUE É FUNÇÃO E NÃO SERVER ACTION
--
-- Decrementar o saldo e gravar o ledger tem de ser uma coisa só. Feito em duas
-- chamadas do TypeScript, uma falha no meio deixa estoque baixado sem registro
-- — ou registro sem baixa. E o `FOR UPDATE` impede que duas baixas simultâneas
-- da mesma peça leiam o mesmo saldo e derrubem o estoque duas vezes.
-- ============================================================================

CREATE OR REPLACE FUNCTION fv.baixar_estoque(
  p_product_id uuid,
  p_quantidade integer,
  p_motivo     text,
  p_user_id    uuid,
  p_notas      text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_produto fv.products%ROWTYPE;
  v_novo    integer;
BEGIN
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Quantidade deve ser maior que zero.');
  END IF;

  IF p_motivo NOT IN ('defeito', 'devolucao_fornecedor', 'perda', 'uso_interno') THEN
    RETURN json_build_object('success', false, 'error', 'Motivo inválido.');
  END IF;

  SELECT * INTO v_produto FROM fv.products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Peça não encontrada.');
  END IF;

  IF v_produto.is_service THEN
    RETURN json_build_object('success', false, 'error', 'Conserto é serviço e não controla estoque.');
  END IF;

  IF v_produto.quantity_in_stock < p_quantidade THEN
    RETURN json_build_object('success', false,
      'error', format('Só há %s em estoque de "%s".', v_produto.quantity_in_stock, v_produto.name));
  END IF;

  v_novo := v_produto.quantity_in_stock - p_quantidade;

  UPDATE fv.products
     SET quantity_in_stock = v_novo,
         -- Zerou: sai das listas, como qualquer peça sem saldo. Se voltar
         -- (devolução da cliente, transferência), volta ativa.
         is_active = (v_novo > 0),
         updated_at = now()
   WHERE id = p_product_id;

  INSERT INTO fv.stock_movements (
    product_id, quantity_before, delta, quantity_after,
    reason, ref_type, user_id, notes
  ) VALUES (
    p_product_id, v_produto.quantity_in_stock, -p_quantidade, v_novo,
    p_motivo, 'manual', p_user_id, p_notas
  );

  RETURN json_build_object('success', true, 'saldo_novo', v_novo, 'peca', v_produto.name);
END;
$$;

COMMENT ON FUNCTION fv.baixar_estoque IS
  'Baixa manual de estoque com rastro no ledger. Motivos: defeito | devolucao_fornecedor | perda | uso_interno.';

GRANT EXECUTE ON FUNCTION fv.baixar_estoque(uuid, integer, text, uuid, text)
  TO authenticated, service_role;
