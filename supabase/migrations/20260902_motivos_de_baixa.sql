-- ============================================================================
-- Motivos de baixa: dois novos, e um rótulo que dizia a coisa errada
-- ============================================================================
--
-- Pedido no treinamento de Campinas em 02/09, dando baixa ao vivo. A dona abriu
-- a lista e faltavam dois casos que ela usa toda semana:
--
--   presente_blogueira      peça enviada para influenciadora. É AÇÃO DE
--                           MARKETING, não perda — e é o número que ela precisa
--                           para saber quanto está gastando com isso.
--   retirada_proprietaria   ela mesma pega a peça. Chamou de "retirar da
--                           Fernanda" na reunião.
--
-- Hoje os dois caem em "uso_interno" e somem no meio.
--
--
-- O RÓTULO "Peça com defeito" MUDA, O VALOR NÃO
--
-- Na tela passa a ser "Troca por defeito", porque a peça não some: volta ao
-- fornecedor e vira outra. No banco continua `defeito`.
--
-- Renomear o VALOR obrigaria a migrar as linhas já gravadas em
-- `fv.stock_movements` — e o que a dona lê é o rótulo. Seria trabalho e risco
-- para não mudar nada que ela veja.
--
--
-- POR QUE MEXER NA FUNÇÃO E NÃO NUMA TABELA DE MOTIVOS
--
-- O motivo é validado por um IF dentro de `fv.baixar_estoque`. Uma tabela de
-- domínio seria mais "correta" e resolveria zero problemas reais: são seis
-- valores, mudam de ano em ano, e a lista da tela vem de
-- `src/lib/estoque/baixa.ts` de qualquer jeito. O comentário lá já avisa que os
-- dois lados têm de bater.
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

  IF p_motivo NOT IN (
    'defeito',
    'devolucao_fornecedor',
    'perda',
    'uso_interno',
    'presente_blogueira',
    'retirada_proprietaria'
  ) THEN
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
  'Baixa manual de estoque com rastro no ledger. Motivos: defeito | devolucao_fornecedor | perda | uso_interno | presente_blogueira | retirada_proprietaria.';

GRANT EXECUTE ON FUNCTION fv.baixar_estoque(uuid, integer, text, uuid, text)
  TO authenticated, service_role;
