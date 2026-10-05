-- ============================================================================
-- Transferência com DUAS PONTAS: em trânsito até o destino conferir
-- ============================================================================
--
-- Pedido da Eleandra (Brasília), 05/10/2026:
--
--   "O processo tem que ter duas pontas: sai daqui com romaneio, chega lá, a
--    pessoa confere e dá o ok para incorporar."
--
-- Desde 21/09 (20260921_transferencia_entrada_automatica) a IDA entrava direto
-- no destino, porque a Fernanda levava as peças na mão. Agora as peças vão por
-- SEDEX e quem abre a caixa é a funcionária da outra loja.
--
-- O QUE MUDA
--
-- 1. `fv.transfers.kind`: o tipo do romaneio.
--      transferencia          → entre lojas, simples (o de sempre)
--      consignacao            → Campinas manda para Brasília vender; o que não
--                               voltar vira conta a pagar do destino
--      devolucao_consignacao  → a volta de uma consignação (aponta para a ida
--                               em `consignacao_id`)
--      lote_fornecedor        → lote/compra lançado numa loja e despachado para
--                               outra; nasce pela compra (`purchase_id`)
--
-- 2. `enviar_transferencia` ganha `p_kind` e `p_consignacao_id`. A ida passa a
--    nascer 'enviada' (em trânsito) — a tela só manda `p_auto_receber` quando
--    a admin marca "levo na mão, entra direto".
--
-- 3. `receber_transferencia`: para `lote_fornecedor` a peça JÁ está cadastrada
--    no destino com saldo zero; a conferência soma nela. O que faltou não
--    "volta para a origem" (não saiu de estoque nenhum): fica como falta.
--
-- 4. `cancelar_transferencia`: lote de fornecedor não se cancela enquanto a
--    compra existir (o caminho é conferir ou excluir a compra).
--
-- 5. `abrir_remessa_de_compra` + `salvar_compra_com_remessa`: a compra salva
--    normalmente e, na MESMA transação, as linhas cujo destino não é a loja de
--    onde as peças saem viram remessa pendente (saldo 0 no destino).
--    `salvar_compra` não é alterada: é de `supabase_admin` e o `postgres` não
--    pode substituí-la. O invólucro roda como quem chama (service_role, que tem
--    EXECUTE nas duas).
--
-- 6. `acerto_consignacao_loja`: prévia (p_confirmar=false) e fechamento
--    (p_confirmar=true) do acerto de uma consignação entre lojas. O que FICOU no
--    destino (recebido na ida − devolvido) vira conta a pagar PENDENTE na loja
--    destino, com `reference_type = 'transfer'`. Critério padrão: custo; a tela
--    manda o critério (constante em src/lib/consignacaoEntreLojas.ts).
--
-- O QUE NÃO MUDA
--   Romaneios antigos: todos ficam com kind = 'transferencia' e o status que
--   têm. O lote da Emília (69dd9553) e as transferências de setembro não são
--   tocados.
--
-- APLICAR (ver o resumo da tarefa):
--   1. Esta migration inteira numa transação (psql -1 ou SQL editor), como
--      `postgres`.
--   2. Recarregar o schema do PostgREST (SIGUSR1 no container supabase_rest).
--   3. SÓ DEPOIS o push do código (o push publica sozinho), fora do horário.
--   Idempotente: rodar duas vezes não muda nada.
-- ============================================================================

BEGIN;

-- ── 1. Colunas ──────────────────────────────────────────────────────────────

ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'transferencia';
ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS consignacao_id uuid REFERENCES fv.transfers(id);
ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES fv.purchases(id) ON DELETE SET NULL;
ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS acerto_at timestamptz;
ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS acerto_by uuid REFERENCES fv.users(id);
ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS acerto_transaction_id uuid REFERENCES fv.transactions(id) ON DELETE SET NULL;
ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS acerto jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'transfers_kind_valido' AND conrelid = 'fv.transfers'::regclass) THEN
    ALTER TABLE fv.transfers ADD CONSTRAINT transfers_kind_valido
      CHECK (kind IN ('transferencia', 'consignacao', 'devolucao_consignacao', 'lote_fornecedor'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'transfers_devolucao_tem_ida' AND conrelid = 'fv.transfers'::regclass) THEN
    ALTER TABLE fv.transfers ADD CONSTRAINT transfers_devolucao_tem_ida
      CHECK (kind <> 'devolucao_consignacao' OR consignacao_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transfers_consignacao ON fv.transfers (consignacao_id) WHERE consignacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfers_purchase    ON fv.transfers (purchase_id)    WHERE purchase_id IS NOT NULL;

COMMENT ON COLUMN fv.transfers.kind IS
  'transferencia | consignacao (o que ficar no destino vira conta a pagar) | devolucao_consignacao (volta de uma consignação, ver consignacao_id) | lote_fornecedor (compra despachada para outra loja, ver purchase_id). Desde 05/10/2026.';
COMMENT ON COLUMN fv.transfers.acerto IS
  'Resumo congelado do acerto da consignação entre lojas (critério, peças que ficaram, valor). Só admin vê.';

-- Conta a pagar do acerto aponta para o romaneio da ida.
DO $$
DECLARE
  v_def  text;
  v_vals text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'transactions_reference_type_check' AND conrelid = 'fv.transactions'::regclass;

  -- `\m...\M` = palavra inteira: 'transfer' não casa com 'transferencia'.
  IF v_def IS NOT NULL AND v_def !~ '\mtransfer\M' THEN
    SELECT array_agg(m[1]) INTO v_vals FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') AS m;
    -- Trava: se a leitura da lista falhar, NÃO encolhe a constraint para só 'transfer'.
    IF v_vals IS NULL OR NOT ('sale' = ANY (v_vals)) THEN
      RAISE EXCEPTION 'Não consegui ler transactions_reference_type_check: %', v_def;
    END IF;
    v_vals := v_vals || 'transfer'::text;
    ALTER TABLE fv.transactions DROP CONSTRAINT transactions_reference_type_check;
    -- Mesma forma ARRAY['x'::text, ...] da original.
    EXECUTE format('ALTER TABLE fv.transactions ADD CONSTRAINT transactions_reference_type_check '
                   'CHECK (reference_type = ANY (ARRAY[%s]))',
                   (SELECT string_agg(quote_literal(v) || '::text', ', ') FROM unnest(v_vals) v));
  END IF;
END $$;


-- ── 2. Enviar ───────────────────────────────────────────────────────────────
-- Corpo = o do banco em 05/10 (20261001_transferencia_idempotente) + tipo.

DROP FUNCTION IF EXISTS fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid);

CREATE OR REPLACE FUNCTION fv.enviar_transferencia(
  p_from_store_id     uuid,
  p_to_store_id       uuid,
  p_itens             jsonb,
  p_user_id           uuid,
  p_notes             text    DEFAULT NULL,
  p_auto_receber      boolean DEFAULT false,
  p_client_request_id uuid    DEFAULT NULL,
  p_kind              text    DEFAULT 'transferencia',
  p_consignacao_id    uuid    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fv, public
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
  v_existente   fv.transfers%ROWTYPE;
  v_ida         fv.transfers%ROWTYPE;
  v_pedido      jsonb;
  v_gravado     jsonb;
  v_kind        text := COALESCE(nullif(p_kind, ''), 'transferencia');
BEGIN
  IF p_from_store_id = p_to_store_id THEN
    RETURN json_build_object('success', false, 'error', 'Origem e destino não podem ser a mesma loja.');
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Nenhuma peça no romaneio.');
  END IF;

  IF v_kind NOT IN ('transferencia', 'consignacao', 'devolucao_consignacao') THEN
    RETURN json_build_object('success', false, 'error', 'Tipo de romaneio inválido.');
  END IF;

  /*
   * Devolução de consignação: aponta para a IDA, que precisa ter saído do
   * destino desta volta para a origem desta volta, já conferida e sem acerto.
   */
  IF v_kind = 'devolucao_consignacao' THEN
    SELECT * INTO v_ida FROM fv.transfers WHERE id = p_consignacao_id;
    IF NOT FOUND OR v_ida.kind <> 'consignacao' THEN
      RETURN json_build_object('success', false, 'error', 'Escolha a consignação que está sendo devolvida.');
    END IF;
    IF v_ida.from_store_id <> p_to_store_id OR v_ida.to_store_id <> p_from_store_id THEN
      RETURN json_build_object('success', false, 'error', 'Esta consignação não saiu da loja para onde a devolução vai.');
    END IF;
    IF v_ida.status NOT IN ('recebida', 'divergente') THEN
      RETURN json_build_object('success', false, 'error', 'A consignação ainda não foi conferida no destino.');
    END IF;
    IF v_ida.acerto_at IS NOT NULL THEN
      RETURN json_build_object('success', false, 'error', 'Esta consignação já foi acertada.');
    END IF;
  ELSIF p_consignacao_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Só a devolução aponta para uma consignação.');
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('fv.transfers:' || p_client_request_id::text, 0));

    SELECT * INTO v_existente
      FROM fv.transfers
     WHERE client_request_id = p_client_request_id;

    IF FOUND THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('p', x.pid, 'q', x.qtd) ORDER BY x.pid), '[]'::jsonb)
        INTO v_pedido
        FROM (
          SELECT (e->>'product_id')::uuid AS pid, sum(coalesce((e->>'quantity')::integer, 0)) AS qtd
            FROM jsonb_array_elements(p_itens) e
           GROUP BY 1
        ) x;

      SELECT coalesce(jsonb_agg(jsonb_build_object('p', x.pid, 'q', x.qtd) ORDER BY x.pid), '[]'::jsonb)
        INTO v_gravado
        FROM (
          SELECT ti.product_id AS pid, sum(ti.quantity_sent) AS qtd
            FROM fv.transfer_items ti
           WHERE ti.transfer_id = v_existente.id
             AND ti.quantity_sent > 0
           GROUP BY 1
        ) x;

      IF v_existente.from_store_id <> p_from_store_id
         OR v_existente.to_store_id <> p_to_store_id
         OR v_existente.kind <> v_kind
         OR v_pedido <> v_gravado THEN
        RETURN json_build_object('success', false, 'error',
          'Este romaneio já foi enviado antes, com outras peças. Confira a lista de transferências; '
          || 'se é uma caixa nova, descarte o rascunho e bipe de novo.');
      END IF;

      RETURN json_build_object(
        'success',     true,
        'transfer_id', v_existente.id,
        'pecas',       coalesce((v_existente.totals->>'pecas')::integer, 0),
        'itens',       coalesce((v_existente.totals->>'itens')::integer, 0),
        'custo_total', coalesce((v_existente.totals->>'custo_total')::numeric, 0),
        'venda_total', coalesce((v_existente.totals->>'venda_total')::numeric, 0),
        'auto_recebida', CASE WHEN p_auto_receber
                              THEN v_existente.status IN ('recebida', 'divergente')
                              ELSE NULL END,
        'repetido',    true
      );
    END IF;
  END IF;

  INSERT INTO fv.transfers (from_store_id, to_store_id, sent_by, notes, client_request_id, kind, consignacao_id)
  VALUES (p_from_store_id, p_to_store_id, p_user_id, p_notes, p_client_request_id, v_kind, p_consignacao_id)
  RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_qtd := COALESCE((v_item->>'quantity')::integer, 0);

    IF v_qtd <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida para a peça %.', v_item->>'product_id';
    END IF;

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

ALTER FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid, text, uuid) OWNER TO postgres;

COMMENT ON FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid, text, uuid) IS
  'Abre o romaneio e tira o saldo da origem. Nasce em trânsito (enviada) até o destino conferir; p_auto_receber só quando a admin leva na mão. '
  'p_kind: transferencia | consignacao | devolucao_consignacao (com p_consignacao_id = a ida). Idempotente por p_client_request_id.';

REVOKE ALL ON FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid, text, uuid)
  TO service_role;


-- ── 3. Receber ──────────────────────────────────────────────────────────────
-- Corpo = o do banco em 05/10 (20260916_etiqueta_unica_por_loja) + o ramo do
-- lote de fornecedor no começo do laço.

CREATE OR REPLACE FUNCTION fv.receber_transferencia(
  p_transfer_id uuid,
  p_recebidos   jsonb,
  p_user_id     uuid,
  p_notes       text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer    fv.transfers%ROWTYPE;
  v_item        fv.transfer_items%ROWTYPE;
  v_recebido    integer;
  v_falta       integer;
  v_origem      fv.products%ROWTYPE;
  v_destino     fv.products%ROWTYPE;
  v_achou       boolean;
  v_dest_id     uuid;
  v_divergiu    boolean := false;
  v_sobras      integer := 0;
  v_rec         jsonb;
  v_conflito    boolean;
BEGIN
  SELECT * INTO v_transfer FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Transferência não encontrada.');
  END IF;

  IF v_transfer.status <> 'enviada' THEN
    RETURN json_build_object('success', false,
      'error', format('Esta transferência já está como "%s".', v_transfer.status));
  END IF;

  IF v_transfer.kind = 'lote_fornecedor' AND v_transfer.purchase_id IS NULL THEN
    RETURN json_build_object('success', false,
      'error', 'A compra deste lote foi excluída. Cancele a remessa em vez de conferir.');
  END IF;

  FOR v_item IN
    SELECT * FROM fv.transfer_items
     WHERE transfer_id = p_transfer_id AND quantity_sent > 0
     ORDER BY product_name
  LOOP
    SELECT COALESCE(MAX((r->>'quantity')::integer), 0) INTO v_recebido
      FROM jsonb_array_elements(COALESCE(p_recebidos, '[]'::jsonb)) r
     WHERE (r->>'product_id')::uuid = v_item.product_id;

    IF v_recebido > v_item.quantity_sent THEN
      v_recebido := v_item.quantity_sent;
    END IF;

    v_falta    := v_item.quantity_sent - v_recebido;
    v_dest_id  := NULL;
    v_conflito := false;
    v_achou    := false;

    SELECT * INTO v_origem FROM fv.products WHERE id = v_item.product_id FOR UPDATE;

    IF v_transfer.kind = 'lote_fornecedor' THEN
      /*
       * Lote de fornecedor: a peça já está cadastrada NO DESTINO, com o saldo
       * desta remessa fora do estoque. O que chegou soma nela; o que faltou
       * não volta para lugar nenhum (nunca esteve em estoque de loja) e fica
       * como falta para a admin resolver com a fornecedora.
       */
      IF v_recebido > 0 THEN
        UPDATE fv.products
           SET quantity_in_stock = quantity_in_stock + v_recebido,
               is_active = true,
               updated_at = now()
         WHERE id = v_origem.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_origem.id, v_origem.quantity_in_stock, v_recebido,
          v_origem.quantity_in_stock + v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );
        v_dest_id := v_origem.id;
      END IF;

      IF v_falta > 0 THEN
        v_divergiu := true;
      END IF;

      UPDATE fv.transfer_items
         SET quantity_received = v_recebido,
             dest_product_id = v_dest_id,
             divergence_type = CASE WHEN v_falta > 0 THEN 'falta' ELSE NULL END
       WHERE id = v_item.id;

      CONTINUE;
    END IF;

    IF v_recebido > 0 THEN
      SELECT * INTO v_destino
        FROM fv.products
       WHERE store_id = v_transfer.to_store_id
         AND barcode_number = v_origem.barcode_number
         AND id <> v_origem.id
       LIMIT 1
       FOR UPDATE;

      IF FOUND THEN
        IF v_destino.code IS DISTINCT FROM v_origem.code
           OR v_destino.name IS DISTINCT FROM v_origem.name THEN
          v_conflito := true;
        ELSE
          v_achou := true;
        END IF;
      END IF;

      IF NOT v_achou AND NOT v_conflito THEN
        SELECT p.* INTO v_destino
          FROM fv.transfer_items ti
          JOIN fv.transfers t  ON t.id = ti.transfer_id
          JOIN fv.products  p  ON p.id = ti.dest_product_id
         WHERE ti.product_id = v_item.product_id
           AND ti.dest_product_id IS NOT NULL
           AND ti.dest_product_id <> v_origem.id
           AND t.to_store_id = v_transfer.to_store_id
           AND p.store_id    = v_transfer.to_store_id
         ORDER BY t.received_at DESC
         LIMIT 1
         FOR UPDATE OF p;

        v_achou := FOUND;
      END IF;

      IF v_achou THEN
        UPDATE fv.products
           SET quantity_in_stock = quantity_in_stock + v_recebido,
               is_active = true,
               updated_at = now()
         WHERE id = v_destino.id;

        v_dest_id := v_destino.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_destino.id, v_destino.quantity_in_stock, v_recebido,
          v_destino.quantity_in_stock + v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );

      ELSIF NOT v_conflito
         AND v_falta = 0
         AND v_origem.quantity_in_stock = 0
         AND v_origem.store_id = v_transfer.from_store_id
      THEN
        UPDATE fv.products
           SET store_id = v_transfer.to_store_id,
               quantity_in_stock = v_recebido,
               is_active = true,
               updated_at = now()
         WHERE id = v_origem.id;

        v_dest_id := v_origem.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_origem.id, 0, v_recebido, v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );

      ELSE
        IF v_conflito THEN
          INSERT INTO fv.products (
            code, name, category, material, supplier_id, store_id,
            cost_price, sale_price, promotional_price, promotional_active,
            quantity_in_stock, ownership_type, purchase_month, purchase_year,
            photo_url, supplier_reference, label_format, is_active
          )
          SELECT
            o.code, o.name, o.category, o.material, o.supplier_id, v_transfer.to_store_id,
            o.cost_price, o.sale_price, o.promotional_price, o.promotional_active,
            v_recebido, o.ownership_type, o.purchase_month, o.purchase_year,
            o.photo_url, o.supplier_reference, o.label_format, true
          FROM fv.products o WHERE o.id = v_origem.id
          RETURNING * INTO v_destino;
        ELSE
          INSERT INTO fv.products (
            code, name, category, material, supplier_id, store_id,
            cost_price, sale_price, promotional_price, promotional_active,
            quantity_in_stock, ownership_type, purchase_month, purchase_year,
            photo_url, supplier_reference, label_format, is_active, barcode_number
          )
          SELECT
            o.code, o.name, o.category, o.material, o.supplier_id, v_transfer.to_store_id,
            o.cost_price, o.sale_price, o.promotional_price, o.promotional_active,
            v_recebido, o.ownership_type, o.purchase_month, o.purchase_year,
            o.photo_url, o.supplier_reference, o.label_format, true, o.barcode_number
          FROM fv.products o WHERE o.id = v_origem.id
          RETURNING * INTO v_destino;
        END IF;

        v_dest_id := v_destino.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_destino.id, 0, v_recebido, v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );
      END IF;
    END IF;

    IF v_falta > 0 THEN
      v_divergiu := true;

      UPDATE fv.products
         SET quantity_in_stock = quantity_in_stock + v_falta,
             is_active = true,
             updated_at = now()
       WHERE id = v_origem.id;

      INSERT INTO fv.stock_movements (
        product_id, quantity_before, delta, quantity_after,
        reason, ref_type, ref_id, user_id, notes
      ) VALUES (
        v_origem.id, v_origem.quantity_in_stock, v_falta,
        v_origem.quantity_in_stock + v_falta,
        'transferencia_falta', 'transfer', p_transfer_id, p_user_id,
        'Peça não chegou na conferência do destino; saldo devolvido à origem.'
      );
    END IF;

    UPDATE fv.transfer_items
       SET quantity_received = v_recebido,
           dest_product_id = v_dest_id,
           divergence_type = CASE WHEN v_falta > 0 THEN 'falta' ELSE NULL END,
           reetiquetar = v_conflito
     WHERE id = v_item.id;
  END LOOP;

  FOR v_rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_recebidos, '[]'::jsonb))
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM fv.transfer_items
       WHERE transfer_id = p_transfer_id
         AND product_id = (v_rec->>'product_id')::uuid
    ) THEN
      INSERT INTO fv.transfer_items (
        transfer_id, product_id, product_code, product_name, barcode_number,
        quantity_sent, quantity_received, unit_cost, divergence_type, divergence_notes
      )
      SELECT
        p_transfer_id, p.id, p.code, p.name, p.barcode_number,
        0, COALESCE((v_rec->>'quantity')::integer, 1), p.cost_price, 'sobra',
        'Bipada na conferência sem constar no romaneio. Não deu entrada em estoque.'
      FROM fv.products p WHERE p.id = (v_rec->>'product_id')::uuid;

      v_divergiu := true;
      v_sobras := v_sobras + 1;
    END IF;
  END LOOP;

  UPDATE fv.transfers
     SET status = CASE WHEN v_divergiu THEN 'divergente' ELSE 'recebida' END,
         received_by = p_user_id,
         received_at = now(),
         receipt_notes = p_notes,
         updated_at = now()
   WHERE id = p_transfer_id;

  RETURN json_build_object('success', true,
    'status', CASE WHEN v_divergiu THEN 'divergente' ELSE 'recebida' END,
    'sobras', v_sobras);
END;
$$;

COMMENT ON FUNCTION fv.receber_transferencia(uuid, jsonb, uuid, text) IS
  'Confere a chegada. Soma na linha do destino com a MESMA etiqueta; senão a linha muda de loja inteira ou nasce herdando a etiqueta. '
  'Lote de fornecedor (desde 05/10/2026): soma na própria peça, que já está no destino; falta não volta para a origem.';


-- ── 4. Cancelar ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fv.cancelar_transferencia(
  p_transfer_id uuid,
  p_user_id     uuid,
  p_motivo      text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer fv.transfers%ROWTYPE;
  v_item     fv.transfer_items%ROWTYPE;
  v_saldo    integer;
BEGIN
  SELECT * INTO v_transfer FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Transferência não encontrada.');
  END IF;

  IF v_transfer.status <> 'enviada' THEN
    RETURN json_build_object('success', false,
      'error', 'Só dá para cancelar transferência que ainda não foi conferida.');
  END IF;

  /*
   * Lote de fornecedor: o saldo nunca saiu de uma loja, então não há para onde
   * "devolver". Enquanto a compra existe, o caminho é conferir (o que não veio
   * fica como falta). Compra excluída: a remessa só é encerrada.
   */
  IF v_transfer.kind = 'lote_fornecedor' THEN
    IF v_transfer.purchase_id IS NOT NULL THEN
      RETURN json_build_object('success', false,
        'error', 'Remessa de lote do fornecedor não se cancela: confira a chegada (o que não veio fica como falta) ou exclua a compra.');
    END IF;

    UPDATE fv.transfers
       SET status = 'cancelada', receipt_notes = p_motivo, updated_at = now()
     WHERE id = p_transfer_id;
    RETURN json_build_object('success', true);
  END IF;

  FOR v_item IN
    SELECT * FROM fv.transfer_items WHERE transfer_id = p_transfer_id AND quantity_sent > 0
  LOOP
    SELECT quantity_in_stock INTO v_saldo FROM fv.products WHERE id = v_item.product_id FOR UPDATE;

    UPDATE fv.products
       SET quantity_in_stock = quantity_in_stock + v_item.quantity_sent,
           is_active = true,
           updated_at = now()
     WHERE id = v_item.product_id;

    INSERT INTO fv.stock_movements (
      product_id, quantity_before, delta, quantity_after,
      reason, ref_type, ref_id, user_id, notes
    ) VALUES (
      v_item.product_id, v_saldo, v_item.quantity_sent, v_saldo + v_item.quantity_sent,
      'transferencia_cancelada', 'transfer', p_transfer_id, p_user_id, p_motivo
    );
  END LOOP;

  UPDATE fv.transfers
     SET status = 'cancelada', receipt_notes = p_motivo, updated_at = now()
   WHERE id = p_transfer_id;

  RETURN json_build_object('success', true);
END;
$$;


-- ── 5. Remessa de compra para outra loja ────────────────────────────────────
--
-- Chamada DEPOIS de salvar_compra, na mesma transação (ver o invólucro abaixo).
-- Para cada loja de destino diferente de p_from_store_id, tira desta compra o
-- saldo que ela acabou de pôr no destino e abre um romaneio 'lote_fornecedor'
-- em trânsito. Idempotente: se a compra já tem remessa, devolve a(s) que existe(m).

CREATE OR REPLACE FUNCTION fv.abrir_remessa_de_compra(
  p_purchase_id   uuid,
  p_from_store_id uuid,
  p_user_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fv, public
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
  IF p_from_store_id IS NULL THEN
    RETURN jsonb_build_object('remessas', '[]'::jsonb);
  END IF;

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
       AND pr.store_id <> p_from_store_id
     ORDER BY 1
  LOOP
    INSERT INTO fv.transfers (from_store_id, to_store_id, sent_by, notes, kind, purchase_id)
    VALUES (p_from_store_id, v_loja, p_user_id,
            'Lote do fornecedor despachado para a loja. Confira a chegada para entrar no estoque.',
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
       ORDER BY pr.id
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
        'Peça do lote ainda em trânsito; entra no estoque na conferência da loja.'
      );

      v_pecas := v_pecas + v_tirar;
      v_itens := v_itens + 1;
      v_custo := v_custo + COALESCE(v_l.custo, 0) * v_tirar;
      v_venda := v_venda + v_preco * v_tirar;
    END LOOP;

    IF v_itens = 0 THEN
      DELETE FROM fv.transfers WHERE id = v_transfer;   -- nada a despachar para esta loja
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

ALTER FUNCTION fv.abrir_remessa_de_compra(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION fv.abrir_remessa_de_compra(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.abrir_remessa_de_compra(uuid, uuid, uuid) TO service_role;

-- Invólucro: salvar_compra + remessa numa transação só. SECURITY INVOKER de
-- propósito: quem chama é o service_role, que tem EXECUTE em salvar_compra
-- (função de supabase_admin, que o postgres não pode substituir).
CREATE OR REPLACE FUNCTION fv.salvar_compra_com_remessa(p jsonb, p_remessa_de uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_r jsonb;
  v_m jsonb;
BEGIN
  v_r := fv.salvar_compra(p);
  IF v_r ? 'erro' OR p_remessa_de IS NULL THEN
    RETURN v_r;
  END IF;
  v_m := fv.abrir_remessa_de_compra((v_r->>'purchase_id')::uuid, p_remessa_de, (p->>'user_id')::uuid);
  RETURN v_r || jsonb_build_object('remessas', v_m->'remessas');
END;
$$;

ALTER FUNCTION fv.salvar_compra_com_remessa(jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION fv.salvar_compra_com_remessa(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.salvar_compra_com_remessa(jsonb, uuid) TO service_role;


-- ── 6. Acerto da consignação entre lojas ────────────────────────────────────
--
-- Por peça da ida: ficou = recebido no destino − devolvido (o que o destino
-- mandou de volta, nas devoluções já conferidas). O que faltou na IDA não é
-- cobrado (nunca chegou) e o que faltou na VOLTA aparece à parte, também sem
-- cobrança automática: a admin decide.
-- p_criterio: 'custo' (padrão) ou 'venda'.

CREATE OR REPLACE FUNCTION fv.acerto_consignacao_loja(
  p_transfer_id uuid,
  p_user_id     uuid,
  p_criterio    text    DEFAULT 'custo',
  p_vencimento  date    DEFAULT NULL,
  p_confirmar   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fv, public
AS $$
DECLARE
  v_t        fv.transfers%ROWTYPE;
  v_itens    jsonb;
  v_pecas    integer;
  v_valor    numeric(12,2);
  v_falta_ida   integer;
  v_falta_volta integer;
  v_devolvido   integer;
  v_resumo   jsonb;
  v_tx       uuid;
  v_de       text;
  v_para     text;
  v_hoje     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF p_criterio NOT IN ('custo', 'venda') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Critério de acerto inválido.');
  END IF;

  SELECT * INTO v_t FROM fv.transfers WHERE id = p_transfer_id
    FOR UPDATE;   -- também na prévia: barato, e evita dois fechamentos lado a lado

  IF NOT FOUND OR v_t.kind <> 'consignacao' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não é uma consignação entre lojas.');
  END IF;
  IF v_t.status NOT IN ('recebida', 'divergente') THEN
    RETURN jsonb_build_object('success', false, 'error', 'A consignação ainda não foi conferida no destino.');
  END IF;
  IF v_t.acerto_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta consignação já foi acertada.', 'acerto', v_t.acerto);
  END IF;
  IF EXISTS (SELECT 1 FROM fv.transfers
              WHERE consignacao_id = p_transfer_id AND status = 'enviada') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Há devolução desta consignação em trânsito. Confira a chegada antes do acerto.');
  END IF;

  WITH volta AS (
    SELECT vi.product_id,
           sum(vi.quantity_sent)::integer                         AS enviado,
           sum(COALESCE(vi.quantity_received, 0))::integer        AS recebido
      FROM fv.transfers v
      JOIN fv.transfer_items vi ON vi.transfer_id = v.id
     WHERE v.consignacao_id = p_transfer_id
       AND v.status IN ('recebida', 'divergente')
       AND vi.quantity_sent > 0
     GROUP BY vi.product_id
  ), linhas AS (
    SELECT i.barcode_number, i.product_name,
           i.quantity_sent                                         AS enviado,
           COALESCE(i.quantity_received, 0)                        AS recebido,
           COALESCE(vo.enviado, 0)                                 AS devolvido,
           COALESCE(vo.enviado, 0) - COALESCE(vo.recebido, 0)      AS faltou_volta,
           greatest(COALESCE(i.quantity_received, 0) - COALESCE(vo.enviado, 0), 0) AS ficou,
           CASE WHEN p_criterio = 'venda' THEN COALESCE(i.unit_sale_price, 0) ELSE i.unit_cost END AS unitario
      FROM fv.transfer_items i
      LEFT JOIN volta vo ON vo.product_id = i.dest_product_id
     WHERE i.transfer_id = p_transfer_id
       AND i.quantity_sent > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'etiqueta', barcode_number, 'peca', product_name,
           'enviado', enviado, 'recebido', recebido, 'devolvido', devolvido,
           'faltou_volta', faltou_volta, 'ficou', ficou,
           'unitario', unitario, 'valor', round(ficou * unitario, 2))
           ORDER BY product_name), '[]'::jsonb),
         COALESCE(sum(ficou), 0)::integer,
         COALESCE(round(sum(ficou * unitario), 2), 0),
         COALESCE(sum(enviado - recebido), 0)::integer,
         COALESCE(sum(faltou_volta), 0)::integer,
         COALESCE(sum(devolvido), 0)::integer
    INTO v_itens, v_pecas, v_valor, v_falta_ida, v_falta_volta, v_devolvido
    FROM linhas;

  SELECT name INTO v_de   FROM fv.stores WHERE id = v_t.from_store_id;
  SELECT name INTO v_para FROM fv.stores WHERE id = v_t.to_store_id;

  v_resumo := jsonb_build_object(
    'criterio', p_criterio,
    'de', v_de, 'para', v_para,
    'pecas_enviadas', COALESCE((v_t.totals->>'pecas')::integer, 0),
    'pecas_devolvidas', v_devolvido,
    'pecas_ficaram', v_pecas,
    'faltou_na_ida', v_falta_ida,
    'faltou_na_volta', v_falta_volta,
    'valor', v_valor
  );

  IF NOT p_confirmar THEN
    RETURN jsonb_build_object('success', true, 'previa', true, 'resumo', v_resumo, 'itens', v_itens);
  END IF;

  IF v_valor > 0 THEN
    INSERT INTO fv.transactions (
      store_id, type, amount, category, description, reference_type, reference_id,
      user_id, transaction_date, due_date, status, notes
    ) VALUES (
      v_t.to_store_id, 'expense', v_valor, 'acerto_consignacao_loja',
      format('Acerto da consignação %s → %s (romaneio %s): %s peça(s) ficaram',
             v_de, v_para, upper(left(v_t.id::text, 8)), v_pecas),
      'transfer', v_t.id,
      p_user_id, v_hoje, COALESCE(p_vencimento, v_hoje), 'pending',
      format('A pagar para %s. Critério: preço de %s.', v_de, p_criterio)
    )
    RETURNING id INTO v_tx;
  END IF;

  UPDATE fv.transfers
     SET acerto_at = now(),
         acerto_by = p_user_id,
         acerto_transaction_id = v_tx,
         acerto = v_resumo || jsonb_build_object('itens', v_itens),
         updated_at = now()
   WHERE id = p_transfer_id;

  RETURN jsonb_build_object('success', true, 'previa', false, 'resumo', v_resumo,
                            'itens', v_itens, 'transaction_id', v_tx);
END;
$$;

ALTER FUNCTION fv.acerto_consignacao_loja(uuid, uuid, text, date, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION fv.acerto_consignacao_loja(uuid, uuid, text, date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.acerto_consignacao_loja(uuid, uuid, text, date, boolean) TO service_role;

COMMIT;
