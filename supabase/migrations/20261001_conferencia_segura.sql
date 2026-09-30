-- ============================================================================
-- Conferência segura: fechar a sessão não desfaz o que aconteceu durante ela
-- ============================================================================
--
-- fv.close_inventory_session grava `quantity_in_stock = contado` (valor
-- ABSOLUTO). Isso tinha três furos:
--
-- 1. Aceitava qualquer product_id. A server action filtra a loja, mas a função
--    é SECURITY DEFINER e executável por anon/authenticated: quem a chamasse
--    direto gravava saldo em peça de outra loja, ou fora do escopo da sessão.
--
-- 2. Movimento DURANTE a contagem era sobrescrito. Bipou 1 às 10h, vendeu às
--    10h30 (estoque 0), fechou às 11h: o absoluto volta o saldo para 1 — peça
--    fantasma, que o PDV vai oferecer e não existe na gaveta. Mesma coisa com
--    transferência, baixa, troca e compra.
--
-- 3. Quantidade negativa no meio da lista fazia RETURN: as linhas anteriores
--    ficavam gravadas e a sessão continuava aberta. Fechar de novo aplicava
--    uma segunda rodada por cima.
--
-- DECISÃO (conferência é rara; vender não pode travar):
--   - Não bloqueia venda nem transferência durante a contagem.
--   - Peça com qualquer movimento de estoque DEPOIS de started_at NÃO é
--     ajustada no fechamento. Ela volta em `nao_ajustados` com o motivo, e a
--     tela pede para conferir essas peças de novo.
--   - As demais seguem como antes: valor absoluto + linha no ledger.
--   - Quantidade negativa = RAISE: nada é gravado, a sessão continua aberta.
--
-- De onde vem "teve movimento" — não existe UMA fonte que cubra tudo:
--   fv.stock_movements cobre transferência (envio, recebimento, cancelamento)
--   e baixa, mas a VENDA, a TROCA e a COMPRA escrevem direto em
--   products.quantity_in_stock (src/app/(sistema)/vendas|compras/actions.ts)
--   sem ledger. Por isso a checagem une:
--     stock_movements (exceto os da própria conferência)
--     sale_items/sales, exchange_items/exchanges, purchase_items/purchases,
--     transfer_items/transfers (origem E destino da peça)
--   `products.updated_at` NÃO entra: editar preço da peça durante a contagem
--   (exatamente o que a tela de bipe incentiva quando o preço do papel diverge)
--   tiraria a peça do ajuste sem motivo de estoque.
--
-- Assinatura e retorno de sucesso mantidos (CREATE OR REPLACE, sem overload,
-- grants preservados). O retorno ganha campos: `nao_ajustados` e `ignorados`.
-- ============================================================================

CREATE OR REPLACE FUNCTION fv.close_inventory_session(
  p_session_id   uuid,
  p_adjustments  jsonb,
  p_totals       jsonb,
  p_user_id      uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fv, public
AS $$
DECLARE
  v_sessao        fv.inventory_sessions%ROWTYPE;
  v_adj           jsonb;
  v_product_id    uuid;
  v_new_qty       integer;
  v_old_qty       integer;
  v_store_id      uuid;
  v_name          text;
  v_code          text;
  v_reason        text;
  v_motivo        text;
  v_aplicados     integer := 0;
  v_movidos       jsonb;
  v_nao_ajustados jsonb := '[]'::jsonb;
  v_ignorados     jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_sessao
    FROM fv.inventory_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Conferência não encontrada.');
  END IF;
  IF v_sessao.status <> 'contando' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta conferência já foi fechada.');
  END IF;

  /*
   * Peças com movimento de estoque depois do início da contagem, com o motivo.
   * Calculado uma vez, antes do laço (as tabelas de itens não têm índice por
   * product_id; o filtro por data vem primeiro). Um motivo por peça, pela
   * ordem de prioridade abaixo.
   */
  SELECT coalesce(jsonb_object_agg(m.pid, m.motivo), '{}'::jsonb)
    INTO v_movidos
    FROM (
      SELECT DISTINCT ON (u.pid) u.pid, u.motivo
        FROM (
          SELECT si.product_id AS pid, 'venda' AS motivo, 1 AS prioridade
            FROM fv.sale_items si
            JOIN fv.sales s ON s.id = si.sale_id
           WHERE si.created_at > v_sessao.started_at
              OR s.created_at  > v_sessao.started_at
          UNION ALL
          SELECT ti.product_id, 'transferencia', 2
            FROM fv.transfer_items ti
            JOIN fv.transfers t ON t.id = ti.transfer_id
           WHERE ti.created_at > v_sessao.started_at
              OR t.sent_at     > v_sessao.started_at
              OR t.received_at > v_sessao.started_at
              OR t.updated_at  > v_sessao.started_at
          UNION ALL
          SELECT ti.dest_product_id, 'transferencia', 2
            FROM fv.transfer_items ti
            JOIN fv.transfers t ON t.id = ti.transfer_id
           WHERE ti.dest_product_id IS NOT NULL
             AND (ti.created_at > v_sessao.started_at
               OR t.sent_at     > v_sessao.started_at
               OR t.received_at > v_sessao.started_at
               OR t.updated_at  > v_sessao.started_at)
          UNION ALL
          SELECT ei.product_id, 'troca', 3
            FROM fv.exchange_items ei
            JOIN fv.exchanges e ON e.id = ei.exchange_id
           WHERE ei.created_at > v_sessao.started_at
              OR e.created_at  > v_sessao.started_at
          UNION ALL
          SELECT pi.product_id, 'compra', 4
            FROM fv.purchase_items pi
            JOIN fv.purchases pu ON pu.id = pi.purchase_id
           WHERE pi.created_at > v_sessao.started_at
              OR pu.created_at > v_sessao.started_at
              OR pu.updated_at > v_sessao.started_at
          UNION ALL
          SELECT sm.product_id,
                 CASE sm.ref_type
                   WHEN 'transfer' THEN 'transferencia'
                   WHEN 'sale'     THEN 'venda'
                   WHEN 'purchase' THEN 'compra'
                   WHEN 'manual'   THEN 'baixa'
                   ELSE 'movimento'
                 END,
                 5
            FROM fv.stock_movements sm
           WHERE sm.created_at > v_sessao.started_at
             AND sm.ref_type <> 'inventory_session'
        ) u
       ORDER BY u.pid, u.prioridade
    ) m;

  FOR v_adj IN SELECT value FROM jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb))
  LOOP
    v_product_id := (v_adj->>'product_id')::uuid;
    v_new_qty    := (v_adj->>'new_quantity')::integer;
    v_reason     := coalesce(nullif(v_adj->>'reason', ''), 'contagem');

    IF v_product_id IS NULL OR v_new_qty IS NULL THEN CONTINUE; END IF;

    -- Antes era RETURN aqui: gravava metade e deixava a sessão aberta. Agora a
    -- exceção desfaz tudo o que esta chamada fez (o bloco EXCEPTION abaixo é
    -- um subtransação que cobre o corpo inteiro).
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'Quantidade negativa não é permitida.';
    END IF;

    SELECT quantity_in_stock, store_id, name, code
      INTO v_old_qty, v_store_id, v_name, v_code
      FROM fv.products WHERE id = v_product_id FOR UPDATE;

    IF NOT FOUND THEN
      v_ignorados := v_ignorados || jsonb_build_object('product_id', v_product_id, 'motivo', 'nao_encontrado');
      CONTINUE;
    END IF;

    -- Só peça DESTA loja.
    IF v_store_id <> v_sessao.store_id THEN
      v_ignorados := v_ignorados || jsonb_build_object('product_id', v_product_id, 'motivo', 'outra_loja');
      CONTINUE;
    END IF;

    -- Só peça do escopo congelado OU bipada nesta sessão. A bipada fora do
    -- escopo (outra gaveta, mesma loja) é a "sobra" que a reconciliação mostra
    -- de propósito (ver fv.reconciliar_conferencia) — continua ajustável.
    IF NOT (v_product_id = ANY (v_sessao.scope_product_ids))
       AND NOT EXISTS (SELECT 1 FROM fv.inventory_scans sc
                        WHERE sc.session_id = p_session_id
                          AND sc.product_id = v_product_id) THEN
      v_ignorados := v_ignorados || jsonb_build_object('product_id', v_product_id, 'motivo', 'fora_do_escopo');
      CONTINUE;
    END IF;

    IF v_old_qty = v_new_qty THEN CONTINUE; END IF;

    -- Movimentou durante a contagem: o número contado pode estar velho.
    v_motivo := v_movidos->>v_product_id::text;
    IF v_motivo IS NOT NULL THEN
      v_nao_ajustados := v_nao_ajustados || jsonb_build_object(
        'product_id', v_product_id,
        'name',       v_name,
        'code',       v_code,
        'motivo',     v_motivo
      );
      CONTINUE;
    END IF;

    UPDATE fv.products
       SET quantity_in_stock = v_new_qty,
           updated_at = now()
     WHERE id = v_product_id;

    INSERT INTO fv.stock_movements
      (product_id, quantity_before, delta, quantity_after, reason, ref_type, ref_id, user_id, notes)
    VALUES
      (v_product_id, v_old_qty, v_new_qty - v_old_qty, v_new_qty, v_reason,
       'inventory_session', p_session_id, p_user_id, nullif(v_adj->>'notes', ''));

    v_aplicados := v_aplicados + 1;
  END LOOP;

  UPDATE fv.inventory_sessions
     SET status    = 'fechada',
         closed_at = now(),
         totals    = coalesce(p_totals, '{}'::jsonb)
                     || jsonb_build_object(
                          'ajustes_aplicados', v_aplicados,
                          'nao_ajustados',     jsonb_array_length(v_nao_ajustados),
                          'ignorados',         jsonb_array_length(v_ignorados))
   WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success',           true,
    'ajustes_aplicados', v_aplicados,
    'nao_ajustados',     v_nao_ajustados,
    'ignorados',         v_ignorados
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION fv.close_inventory_session(uuid, jsonb, jsonb, uuid) IS
  'Aplica os ajustes da conferência e fecha a sessão numa transação só. Só ajusta peça da loja da sessão e do escopo (ou bipada nela); '
  'peça com venda/transferência/baixa/troca/compra depois de started_at NÃO é ajustada e volta em nao_ajustados. '
  'Qualquer erro desfaz tudo e a sessão continua aberta.';

-- Grants: CREATE OR REPLACE preserva os existentes (no banco: anon,
-- authenticated e service_role — dump de 30/09). Nada a fazer aqui.
