-- ============================================================================
-- Compra só entra no estoque depois da conferência na loja (12/10/2026)
-- ============================================================================
--
-- Pedido da Eleandra: "compra (com NF) → remessa em Transferências para a loja
-- de destino → a loja confere e aceita → só aí entra no estoque".
--
-- Desde 05/10 isso já valia para as linhas de OUTRA loja ("Peças saem de"):
-- `abrir_remessa_de_compra` abria um romaneio `lote_fornecedor` e a peça ficava
-- com saldo 0 até a conferência. As linhas da própria loja de "saem de" (e a
-- opção "Já estão na loja de destino") continuavam entrando direto.
--
-- O QUE MUDA
--
-- 1. A origem do lote é o FORNECEDOR: `transfers.from_store_id` aceita nulo,
--    só em `lote_fornecedor`. Antes a origem era Campinas, e a RLS "origem OU
--    destino" mostrava a compra de Brasília para Campinas. Com origem nula,
--    `fv.pode_ver_loja(null)` só é verdade para a admin global: a remessa é
--    vista pela loja de destino e por ninguém mais.
--
-- 2. `fv.salvar_compra_conferida(p, p_entra_direto)`: grava a compra
--    (`salvar_compra`, intacta, é de supabase_admin) e, na MESMA transação,
--    abre uma remessa por loja de destino com TODAS as linhas
--    (`abrir_remessas_do_fornecedor`). `p_entra_direto` = a admin marcou "as
--    peças já estão na loja": entra direto, como antes (vale para consignação).
--
-- 3. `fv.excluir_compra_conferida`: `excluir_compra` estorna do estoque a
--    quantidade dos ITENS da compra. Com remessa, parte disso nunca entrou (em
--    trânsito ou falta da conferência) e o estorno tirava estoque real de peça
--    reaproveitada. O invólucro ajusta os itens para o que entrou de fato,
--    encerra as remessas pendentes e só então chama `excluir_compra`.
--
-- 4. Falta na conferência do lote: a admin decide se desconta o valor das
--    peças que faltaram (`fv.decidir_falta_do_lote`). Onde o desconto cai:
--      · compra própria → abate das parcelas PENDENTES da fornecedora daquela
--        peça, da última para a primeira (parcela e despesa do financeiro
--        juntas). O que já estava pago vira crédito a receber da fornecedora
--        (transactions income pendente, categoria credito_fornecedor).
--        `purchases.desconto_falta` guarda o que saiu das parcelas, para a
--        edição da compra fechar os pagamentos contra (itens − desconto).
--      · consignação → reduz o valor e as peças do lote (o que se deve).
--    A decisão (descontada | mantida) fica no romaneio, com o detalhe.
--
-- O QUE NÃO MUDA
--   Compras e remessas que já existem. `salvar_compra`, `excluir_compra`,
--   `abrir_remessa_de_compra` e `salvar_compra_com_remessa` ficam como estão
--   (o código anterior continua funcionando enquanto o novo não sobe).
--
-- APLICAR: como `postgres`, numa transação (o arquivo tem BEGIN/COMMIT);
-- depois SIGUSR1 no supabase_rest; SÓ DEPOIS o push (o push publica sozinho),
-- fora do horário da loja. Idempotente.
--
-- DESFAZER (só se nenhuma remessa nasceu com origem nula):
--   BEGIN;
--   DROP FUNCTION IF EXISTS fv.decidir_falta_do_lote(uuid, uuid, boolean, boolean);
--   DROP FUNCTION IF EXISTS fv.excluir_compra_conferida(uuid, uuid);
--   DROP FUNCTION IF EXISTS fv.salvar_compra_conferida(jsonb, boolean);
--   DROP FUNCTION IF EXISTS fv.abrir_remessas_do_fornecedor(uuid, uuid);
--   ALTER TABLE fv.transfers DROP CONSTRAINT IF EXISTS transfers_origem_so_no_lote;
--   ALTER TABLE fv.transfers ALTER COLUMN from_store_id SET NOT NULL;
--   ALTER TABLE fv.transfers DROP COLUMN IF EXISTS falta_decisao, DROP COLUMN IF EXISTS falta_valor,
--     DROP COLUMN IF EXISTS falta_decidida_at, DROP COLUMN IF EXISTS falta_decidida_by,
--     DROP COLUMN IF EXISTS falta_detalhe;
--   ALTER TABLE fv.purchases DROP COLUMN IF EXISTS desconto_falta;
--   COMMIT;
-- ============================================================================

BEGIN;

-- ── 1. Estrutura ────────────────────────────────────────────────────────────

ALTER TABLE fv.transfers ALTER COLUMN from_store_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'fv.transfers'::regclass AND conname = 'transfers_origem_so_no_lote') THEN
    ALTER TABLE fv.transfers ADD CONSTRAINT transfers_origem_so_no_lote
      CHECK (from_store_id IS NOT NULL OR kind = 'lote_fornecedor');
  END IF;
END $$;

ALTER TABLE fv.transfers
  ADD COLUMN IF NOT EXISTS falta_decisao     text,
  ADD COLUMN IF NOT EXISTS falta_valor       numeric(12,2),
  ADD COLUMN IF NOT EXISTS falta_decidida_at timestamptz,
  ADD COLUMN IF NOT EXISTS falta_decidida_by uuid REFERENCES fv.users(id),
  ADD COLUMN IF NOT EXISTS falta_detalhe     jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'fv.transfers'::regclass AND conname = 'transfers_falta_decisao_check') THEN
    ALTER TABLE fv.transfers ADD CONSTRAINT transfers_falta_decisao_check
      CHECK (falta_decisao IS NULL OR falta_decisao IN ('descontada', 'mantida'));
  END IF;
END $$;

COMMENT ON COLUMN fv.transfers.from_store_id IS
  'Loja de onde a remessa saiu. NULA só em lote_fornecedor nascido da compra (desde 12/10/2026): a origem é o fornecedor.';
COMMENT ON COLUMN fv.transfers.falta_decisao IS
  'Lote do fornecedor com falta na conferência: descontada (valor abatido da compra) | mantida (paga cheio). NULL = a decidir.';

ALTER TABLE fv.purchases
  ADD COLUMN IF NOT EXISTS desconto_falta numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN fv.purchases.desconto_falta IS
  'Valor abatido das parcelas por peça que faltou na conferência do lote (fv.decidir_falta_do_lote). Os pagamentos fecham contra itens − este valor.';


-- ── 2. Remessas da compra: uma por loja de destino, origem = fornecedor ────────
--
-- Mesmo corpo de `abrir_remessa_de_compra` (05/10), sem a loja de origem: TODA
-- linha vira remessa. Tira desta compra o saldo que `salvar_compra` acabou de
-- pôr na peça (nunca mais do que ela tem) e abre o romaneio em trânsito.
-- Idempotente: compra que já tem lote devolve o(s) que existe(m).

CREATE OR REPLACE FUNCTION fv.abrir_remessas_do_fornecedor(
  p_purchase_id uuid,
  p_user_id     uuid
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

COMMENT ON FUNCTION fv.abrir_remessas_do_fornecedor(uuid, uuid) IS
  'Abre uma remessa lote_fornecedor (origem = fornecedor, from_store_id nulo) por loja de destino com todas as linhas da compra; as peças ficam com o saldo da compra fora do estoque até a conferência. Desde 12/10/2026.';


-- ── 3. Salvar a compra (com ou sem conferência) ─────────────────────────────

CREATE OR REPLACE FUNCTION fv.salvar_compra_conferida(p jsonb, p_entra_direto boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_r jsonb;
  v_m jsonb;
BEGIN
  v_r := fv.salvar_compra(p);
  -- Erro, reenvio da mesma compra (já tratado no 1º envio) ou "entra direto".
  IF v_r ? 'erro' OR COALESCE((v_r->>'ja_existia')::boolean, false) OR COALESCE(p_entra_direto, false) THEN
    RETURN v_r;
  END IF;
  v_m := fv.abrir_remessas_do_fornecedor((v_r->>'purchase_id')::uuid, (p->>'user_id')::uuid);
  RETURN v_r || jsonb_build_object('remessas', v_m->'remessas');
END;
$$;

COMMENT ON FUNCTION fv.salvar_compra_conferida(jsonb, boolean) IS
  'Grava a compra (fv.salvar_compra) e, na mesma transação, abre as remessas para conferência na loja (a menos que p_entra_direto). Desde 12/10/2026.';


-- ── 4. Excluir compra sem estornar o que nunca entrou ───────────────────────

CREATE OR REPLACE FUNCTION fv.excluir_compra_conferida(p_purchase_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_r      jsonb;
  v_p      record;
  v_resto  integer;
  v_it     record;
  v_tira   integer;
BEGIN
  PERFORM 1 FROM fv.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'nao_encontrada');
  END IF;

  BEGIN
    /*
     * O que NÃO entrou no estoque por causa das remessas desta compra: em
     * trânsito (enviada) ou falta da conferência. Os itens são ajustados para
     * o que entrou de fato — `excluir_compra` estorna a partir deles — e as
     * remessas pendentes são encerradas.
     */
    FOR v_p IN
      SELECT ti.product_id,
             sum(ti.quantity_sent - CASE WHEN t.status = 'enviada' THEN 0
                                         ELSE COALESCE(ti.quantity_received, 0) END)::integer AS fora
        FROM fv.transfer_items ti
        JOIN fv.transfers t ON t.id = ti.transfer_id
       WHERE t.purchase_id = p_purchase_id
         AND t.kind = 'lote_fornecedor'
         AND t.status IN ('enviada', 'recebida', 'divergente')
         AND ti.quantity_sent > 0
       GROUP BY ti.product_id
    LOOP
      v_resto := v_p.fora;
      FOR v_it IN
        SELECT id, quantity FROM fv.purchase_items
         WHERE purchase_id = p_purchase_id AND product_id = v_p.product_id
         ORDER BY quantity DESC, id
           FOR UPDATE
      LOOP
        EXIT WHEN v_resto <= 0;
        v_tira := least(v_resto, v_it.quantity);
        UPDATE fv.purchase_items SET quantity = quantity - v_tira WHERE id = v_it.id;
        v_resto := v_resto - v_tira;
      END LOOP;
    END LOOP;

    -- Crédito com a fornecedora lançado pela falta: sai junto com a compra.
    DELETE FROM fv.transactions
     WHERE reference_type = 'transfer'
       AND category = 'credito_fornecedor'
       AND reference_id IN (SELECT id FROM fv.transfers
                             WHERE purchase_id = p_purchase_id AND kind = 'lote_fornecedor');

    UPDATE fv.transfers
       SET status = 'cancelada',
           receipt_notes = 'Compra excluída antes da conferência.',
           updated_at = now()
     WHERE purchase_id = p_purchase_id
       AND kind = 'lote_fornecedor'
       AND status = 'enviada';

    v_r := fv.excluir_compra(p_purchase_id, p_user_id);

    IF v_r ? 'erro' THEN
      -- Recusou (peça vendida): desfaz os ajustes acima e devolve a recusa.
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__fv_excluir_recusado__';
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = '__fv_excluir_recusado__' THEN
      RETURN v_r;
    END IF;
    RAISE;
  END;

  RETURN v_r;
END;
$$;

COMMENT ON FUNCTION fv.excluir_compra_conferida(uuid, uuid) IS
  'Exclui a compra (fv.excluir_compra) estornando só o que entrou no estoque: encerra as remessas pendentes e desconta dos itens o que ficou em trânsito ou faltou. Desde 12/10/2026.';


-- ── 5. Falta no lote: descontar ou não ──────────────────────────────────────
--
-- p_confirmar = false: prévia (nada é gravado). true: grava a decisão.
-- Devolve { success, ... } | { success: false, error }.

CREATE OR REPLACE FUNCTION fv.decidir_falta_do_lote(
  p_transfer_id uuid,
  p_user_id     uuid,
  p_descontar   boolean,
  p_confirmar   boolean
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_t        fv.transfers%ROWTYPE;
  v_compra   fv.purchases%ROWTYPE;
  v_loja     text;
  v_itens    jsonb;
  v_grupos   jsonb := '[]'::jsonb;
  v_valor    numeric(12,2);
  v_pecas    integer;
  v_g        record;
  v_pg       record;
  v_tx       uuid;
  v_usadas   uuid[] := ARRAY[]::uuid[];
  v_resto    numeric(12,2);
  v_tira     numeric(12,2);
  v_abatido  numeric(12,2) := 0;
  v_credito  numeric(12,2) := 0;
  v_mudou    jsonb := '[]'::jsonb;
  v_creditos jsonb := '[]'::jsonb;
  v_cred_id  uuid;
  v_pend     numeric(12,2);
  v_nota     text;
BEGIN
  SELECT * INTO v_t FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Remessa não encontrada.');
  END IF;
  IF v_t.kind <> 'lote_fornecedor' OR v_t.status <> 'divergente' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Só remessa de compra conferida com falta tem desconto a decidir.');
  END IF;
  IF v_t.purchase_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'A compra desta remessa foi excluída.');
  END IF;
  IF v_t.falta_decisao IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', format('O desconto desta falta já foi decidido (%s).', v_t.falta_decisao));
  END IF;

  SELECT * INTO v_compra FROM fv.purchases WHERE id = v_t.purchase_id FOR UPDATE;
  SELECT name INTO v_loja FROM fv.stores WHERE id = v_t.to_store_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'etiqueta',   ti.barcode_number,
           'peca',       ti.product_name,
           'fornecedor', COALESCE(s.name, 'sem fornecedor'),
           'faltou',     ti.quantity_sent - COALESCE(ti.quantity_received, 0),
           'unitario',   ti.unit_cost,
           'valor',      round(ti.unit_cost * (ti.quantity_sent - COALESCE(ti.quantity_received, 0)), 2)
         ) ORDER BY ti.product_name), '[]'::jsonb),
         COALESCE(sum(round(ti.unit_cost * (ti.quantity_sent - COALESCE(ti.quantity_received, 0)), 2)), 0),
         COALESCE(sum(ti.quantity_sent - COALESCE(ti.quantity_received, 0)), 0)::integer
    INTO v_itens, v_valor, v_pecas
    FROM fv.transfer_items ti
    LEFT JOIN fv.products pr ON pr.id = ti.product_id
    LEFT JOIN fv.suppliers s ON s.id = pr.supplier_id
   WHERE ti.transfer_id = p_transfer_id
     AND ti.divergence_type = 'falta'
     AND ti.quantity_sent > COALESCE(ti.quantity_received, 0);

  IF v_pecas = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta remessa não tem peça faltando.');
  END IF;

  -- Por fornecedora: quanto falta e quanto ainda está pendente nas parcelas.
  FOR v_g IN
    SELECT pr.supplier_id, COALESCE(s.name, 'sem fornecedor') AS nome,
           sum(round(ti.unit_cost * (ti.quantity_sent - COALESCE(ti.quantity_received, 0)), 2)) AS valor
      FROM fv.transfer_items ti
      LEFT JOIN fv.products pr ON pr.id = ti.product_id
      LEFT JOIN fv.suppliers s ON s.id = pr.supplier_id
     WHERE ti.transfer_id = p_transfer_id
       AND ti.divergence_type = 'falta'
       AND ti.quantity_sent > COALESCE(ti.quantity_received, 0)
     GROUP BY 1, 2
     ORDER BY 2
  LOOP
    SELECT COALESCE(sum(amount), 0) INTO v_pend
      FROM fv.purchase_payments
     WHERE purchase_id = v_t.purchase_id AND status = 'pending'
       AND supplier_id IS NOT DISTINCT FROM v_g.supplier_id;
    v_grupos := v_grupos || jsonb_build_object(
      'fornecedor', v_g.nome, 'valor', v_g.valor,
      'abate',   CASE WHEN v_compra.consignment_id IS NULL THEN least(v_g.valor, v_pend) ELSE 0 END,
      'credito', CASE WHEN v_compra.consignment_id IS NULL THEN greatest(0, v_g.valor - v_pend) ELSE 0 END);
  END LOOP;

  IF NOT p_confirmar THEN
    RETURN jsonb_build_object('success', true, 'previa', true,
      'valor', v_valor, 'pecas', v_pecas, 'itens', v_itens, 'fornecedoras', v_grupos,
      'consignacao', v_compra.consignment_id IS NOT NULL, 'loja', v_loja);
  END IF;

  IF NOT COALESCE(p_descontar, false) THEN
    v_nota := format('FALTA NA CONFERÊNCIA (%s, %s): %s peça(s), R$ %s. NÃO descontado.',
                     to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), v_loja, v_pecas,
                     replace(to_char(v_valor, 'FM9999990.00'), '.', ','));
  ELSIF v_compra.consignment_id IS NOT NULL THEN
    -- Consignação: o que se deve à fornecedora é o valor do lote.
    PERFORM 1 FROM fv.consignments WHERE id = v_compra.consignment_id FOR UPDATE;
    UPDATE fv.consignments
       SET total_cost_value = greatest(0, total_cost_value - v_valor),
           total_pieces     = greatest(0, total_pieces - v_pecas),
           updated_at       = now()
     WHERE id = v_compra.consignment_id;
    PERFORM fv.recalcular_status_consignacao(v_compra.consignment_id);
    v_abatido := v_valor;
    v_nota := format('FALTA NA CONFERÊNCIA (%s, %s): %s peça(s), R$ %s descontados do lote consignado.',
                     to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), v_loja, v_pecas,
                     replace(to_char(v_valor, 'FM9999990.00'), '.', ','));
  ELSE
    FOR v_g IN
      SELECT pr.supplier_id, COALESCE(s.name, 'fornecedora') AS nome,
             sum(round(ti.unit_cost * (ti.quantity_sent - COALESCE(ti.quantity_received, 0)), 2)) AS valor
        FROM fv.transfer_items ti
        LEFT JOIN fv.products pr ON pr.id = ti.product_id
        LEFT JOIN fv.suppliers s ON s.id = pr.supplier_id
       WHERE ti.transfer_id = p_transfer_id
         AND ti.divergence_type = 'falta'
         AND ti.quantity_sent > COALESCE(ti.quantity_received, 0)
       GROUP BY 1, 2
       ORDER BY 2
    LOOP
      v_resto := v_g.valor;

      -- Da última parcela pendente para a primeira.
      FOR v_pg IN
        SELECT * FROM fv.purchase_payments
         WHERE purchase_id = v_t.purchase_id AND status = 'pending'
           AND supplier_id IS NOT DISTINCT FROM v_g.supplier_id
         ORDER BY due_date DESC NULLS LAST, installment_number DESC NULLS LAST, id
           FOR UPDATE
      LOOP
        EXIT WHEN v_resto <= 0;
        v_tira := least(v_resto, v_pg.amount);

        -- A despesa do financeiro que nasceu com esta parcela (mesmo critério
        -- de pareamento da edição: método + valor + vencimento).
        SELECT id INTO v_tx
          FROM fv.transactions
         WHERE reference_type = 'purchase' AND reference_id = v_t.purchase_id
           AND type = 'expense' AND status = 'pending'
           AND COALESCE(payment_method, '') = COALESCE(v_pg.payment_method, '')
           AND round(amount * 100) = round(v_pg.amount * 100)
           AND due_date IS NOT DISTINCT FROM v_pg.due_date
           AND NOT (id = ANY (v_usadas))
         ORDER BY created_at
         LIMIT 1
           FOR UPDATE;
        IF FOUND THEN v_usadas := v_usadas || v_tx; ELSE v_tx := NULL; END IF;

        IF round(v_tira * 100) >= round(v_pg.amount * 100) THEN
          DELETE FROM fv.purchase_payments WHERE id = v_pg.id;
          IF v_tx IS NOT NULL THEN DELETE FROM fv.transactions WHERE id = v_tx; END IF;
        ELSE
          UPDATE fv.purchase_payments SET amount = amount - v_tira WHERE id = v_pg.id;
          IF v_tx IS NOT NULL THEN
            UPDATE fv.transactions SET amount = amount - v_tira WHERE id = v_tx;
          END IF;
        END IF;

        v_mudou := v_mudou || jsonb_build_object(
          'pagamento', v_pg.id, 'despesa', v_tx, 'vencimento', v_pg.due_date,
          'antes', v_pg.amount, 'depois', v_pg.amount - v_tira);
        v_resto   := v_resto - v_tira;
        v_abatido := v_abatido + v_tira;
      END LOOP;

      -- Já estava pago: vira crédito a receber da fornecedora.
      IF v_resto > 0 THEN
        INSERT INTO fv.transactions (
          store_id, type, amount, category, description, reference_type, reference_id,
          user_id, transaction_date, status
        ) VALUES (
          v_t.to_store_id, 'income', v_resto, 'credito_fornecedor',
          format('Crédito com %s: peças que faltaram na conferência da compra%s',
                 v_g.nome, COALESCE(' NF ' || v_compra.nf_number, '')),
          'transfer', p_transfer_id, p_user_id,
          (now() AT TIME ZONE 'America/Sao_Paulo')::date, 'pending'
        ) RETURNING id INTO v_cred_id;
        v_creditos := v_creditos || jsonb_build_object('despesa', v_cred_id, 'fornecedor', v_g.nome, 'valor', v_resto);
        v_credito := v_credito + v_resto;
      END IF;
    END LOOP;

    UPDATE fv.purchases
       SET desconto_falta = desconto_falta + v_abatido, updated_at = now()
     WHERE id = v_t.purchase_id;

    v_nota := format('FALTA NA CONFERÊNCIA (%s, %s): %s peça(s), R$ %s descontados (R$ %s das parcelas pendentes%s).',
                     to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), v_loja, v_pecas,
                     replace(to_char(v_valor, 'FM9999990.00'), '.', ','), replace(to_char(v_abatido, 'FM9999990.00'), '.', ','),
                     CASE WHEN v_credito > 0
                          THEN format(', R$ %s como crédito a receber da fornecedora', replace(to_char(v_credito, 'FM9999990.00'), '.', ','))
                          ELSE '' END);
  END IF;

  UPDATE fv.purchases
     SET notes = concat_ws(E'\n', nullif(notes, ''), v_nota), updated_at = now()
   WHERE id = v_t.purchase_id;

  UPDATE fv.transfers
     SET falta_decisao     = CASE WHEN COALESCE(p_descontar, false) THEN 'descontada' ELSE 'mantida' END,
         falta_valor       = v_valor,
         falta_decidida_at = now(),
         falta_decidida_by = p_user_id,
         falta_detalhe     = jsonb_build_object('itens', v_itens, 'parcelas', v_mudou,
                                                'creditos', v_creditos, 'abatido', v_abatido,
                                                'credito', v_credito),
         updated_at        = now()
   WHERE id = p_transfer_id;

  RETURN jsonb_build_object('success', true, 'previa', false,
    'decisao', CASE WHEN COALESCE(p_descontar, false) THEN 'descontada' ELSE 'mantida' END,
    'valor', v_valor, 'abatido', v_abatido, 'credito', v_credito);
END;
$$;

COMMENT ON FUNCTION fv.decidir_falta_do_lote(uuid, uuid, boolean, boolean) IS
  'Falta na conferência do lote da compra: prévia ou decisão de descontar (abate das parcelas pendentes da fornecedora; o já pago vira crédito a receber; consignação reduz o lote) ou não. Desde 12/10/2026.';


-- ── 6. Permissões: só o service_role (server actions) ───────────────────────
REVOKE ALL ON FUNCTION fv.abrir_remessas_do_fornecedor(uuid, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv.salvar_compra_conferida(jsonb, boolean)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv.excluir_compra_conferida(uuid, uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv.decidir_falta_do_lote(uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.abrir_remessas_do_fornecedor(uuid, uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION fv.salvar_compra_conferida(jsonb, boolean)           TO service_role;
GRANT EXECUTE ON FUNCTION fv.excluir_compra_conferida(uuid, uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION fv.decidir_falta_do_lote(uuid, uuid, boolean, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
