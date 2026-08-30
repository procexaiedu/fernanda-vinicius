-- ============================================================================
-- Transferência entre lojas: romaneio de envio + conferência no destino
-- ============================================================================
--
-- Substitui o fluxo de `fv.stock_transfers` (uma peça por vez, saldo mudando
-- na hora, sem conferência). A tabela antiga e a função `fv.transfer_stock`
-- FICAM NO LUGAR, intocadas — estavam com zero linhas quando isto foi escrito
-- (30/08/2026) e não há nada para migrar. Não são mais chamadas pela interface.
--
--
-- DECISÃO 1 — A etiqueta não muda; quem muda de loja é a LINHA do produto.
--
-- `products.barcode_number` tem índice ÚNICO GLOBAL. Duas linhas (uma por loja)
-- nunca podem dividir o mesmo código de barras. Como a etiqueta é física e vai
-- colada na peça, criar uma linha nova no destino significaria que a peça chega
-- em Brasília com a etiqueta 01234 e o sistema de lá a conhece como 01888 — e
-- bipar a peça na conferência de Brasília não acharia nada.
--
-- Era exatamente isso que `fv.transfer_stock` fazia: o INSERT no destino omitia
-- `barcode_number`, então a linha nova pegava o próximo valor da sequência.
-- Nunca chegou a rodar em produção; se tivesse rodado, a primeira conferência
-- de Brasília acusaria a loja inteira como "não cadastrado".
--
-- Aqui, quando a peça INTEIRA é enviada e recebida, é a própria linha que muda
-- de `store_id`. A etiqueta continua valendo. Isso só é possível porque
-- `sales.store_id` fica na venda, não no produto — mover a linha não reescreve
-- o histórico de qual loja vendeu o quê.
--
--
-- DECISÃO 2 — Envio parcial cria linha nova, e a peça precisa de etiqueta nova.
--
-- 62 produtos têm quantidade > 1 dividindo UMA etiqueta. Mandar 1 de 3 não tem
-- como preservar o código de barras no destino (o índice único proíbe), então a
-- linha nova nasce com barcode novo e o item sai marcado `reetiquetar = true`.
-- O romaneio destaca essas peças: elas têm de ser reetiquetadas na chegada,
-- senão ficam invisíveis para o bipe no destino.
--
--
-- DECISÃO 3 — Em trânsito não é estoque de ninguém.
--
-- No envio o saldo sai da origem na hora (a peça saiu da loja, não pode ser
-- vendida lá). No destino só entra na conferência. Entre um e outro a peça mora
-- no romaneio. O total continua fechando: origem + trânsito + destino.
--
--
-- DECISÃO 4 — O que falta volta para a origem; o que sobra não vira estoque.
--
-- Faltou peça na conferência: a diferença VOLTA para o saldo da origem. É a
-- hipótese mais provável (não foi embalada) e mantém o total fechado; se de
-- fato sumiu, a conferência de estoque da origem acusa. O contrário — dar baixa
-- e deixar o total furado — esconde o problema.
--
-- Sobrou peça que não está no romaneio: fica REGISTRADA na transferência para
-- triagem e NÃO mexe em saldo nenhum. Ninguém sabe de onde ela veio, e criar
-- estoque a partir de um palpite é como se inventa peça no sistema.
-- ============================================================================


-- ── 1. Cabeçalho da transferência ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fv.transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_store_id  uuid NOT NULL REFERENCES fv.stores(id),
  to_store_id    uuid NOT NULL REFERENCES fv.stores(id),
  status         text NOT NULL DEFAULT 'enviada',
  sent_by        uuid NOT NULL REFERENCES fv.users(id),
  received_by    uuid REFERENCES fv.users(id),
  sent_at        timestamptz NOT NULL DEFAULT now(),
  received_at    timestamptz,
  notes          text,
  receipt_notes  text,
  totals         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transfers_lojas_diferentes
    CHECK (from_store_id <> to_store_id),
  CONSTRAINT transfers_status_valido
    CHECK (status IN ('enviada', 'recebida', 'divergente', 'cancelada')),
  CONSTRAINT transfers_recebida_tem_quem
    CHECK (status NOT IN ('recebida', 'divergente') OR received_by IS NOT NULL)
);

COMMENT ON TABLE fv.transfers IS
  'Um romaneio de transferência entre lojas. Enviada = em trânsito, saldo já saiu da origem e ainda não entrou no destino.';
COMMENT ON COLUMN fv.transfers.totals IS
  'Congelado no envio: {pecas, itens, custo_total}. É o que o romaneio impresso mostra — não recalcular depois, senão o papel e a tela divergem.';
COMMENT ON COLUMN fv.transfers.receipt_notes IS
  'Justificativa da conferência. Obrigatória na interface quando há divergência.';

CREATE INDEX IF NOT EXISTS idx_transfers_destino_status
  ON fv.transfers (to_store_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_origem
  ON fv.transfers (from_store_id, sent_at DESC);


-- ── 2. Itens do romaneio ────────────────────────────────────────────────────
--
-- Nome, código, etiqueta e custo ficam CONGELADOS na linha do item. O romaneio
-- é um documento: precisa ser legível daqui a dois anos mesmo que o produto
-- tenha sido renomeado, reprecificado ou desativado. Ler tudo por join com
-- `products` faria o papel impresso e a tela contarem histórias diferentes.

CREATE TABLE IF NOT EXISTS fv.transfer_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id       uuid NOT NULL REFERENCES fv.transfers(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES fv.products(id),
  dest_product_id   uuid REFERENCES fv.products(id),
  product_code      text NOT NULL,
  product_name      text NOT NULL,
  barcode_number    text NOT NULL,
  quantity_sent     integer NOT NULL,
  quantity_received integer,
  unit_cost         numeric(10,2) NOT NULL DEFAULT 0,
  reetiquetar       boolean NOT NULL DEFAULT false,
  divergence_type   text,
  divergence_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transfer_items_qtd_enviada_nao_negativa
    CHECK (quantity_sent >= 0),
  CONSTRAINT transfer_items_qtd_recebida_nao_negativa
    CHECK (quantity_received IS NULL OR quantity_received >= 0),
  CONSTRAINT transfer_items_divergencia_valida
    CHECK (divergence_type IS NULL OR divergence_type IN ('falta', 'sobra')),
  -- quantity_sent = 0 só existe para a peça que apareceu na conferência sem
  -- estar no romaneio. Fora isso, item com zero peça não faz sentido.
  CONSTRAINT transfer_items_zero_so_para_sobra
    CHECK (quantity_sent > 0 OR divergence_type = 'sobra'),
  CONSTRAINT transfer_items_sem_duplicata
    UNIQUE (transfer_id, product_id)
);

COMMENT ON TABLE fv.transfer_items IS
  'Item do romaneio. Nome/código/etiqueta/custo são cópias congeladas do envio, de propósito.';
COMMENT ON COLUMN fv.transfer_items.dest_product_id IS
  'A linha de products que recebeu a peça no destino. Preenchida na conferência. É por ela — e NUNCA por code — que um envio parcial seguinte encontra a linha certa: o mesmo code cobre até 8 peças diferentes (anel, brinco, colar) porque code é código de lote/preço, não identidade da peça.';
COMMENT ON COLUMN fv.transfer_items.reetiquetar IS
  'true quando o envio foi PARCIAL: no destino a peça ganha linha nova com código de barras novo, e a etiqueta física precisa ser reimpressa na chegada.';
COMMENT ON COLUMN fv.transfer_items.quantity_received IS
  'NULL enquanto não conferido. Zero significa conferido e não chegou — que é diferente de não conferido.';

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer
  ON fv.transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_barcode
  ON fv.transfer_items (barcode_number);


-- ── 3. Enviar: tira da origem e abre o romaneio ─────────────────────────────

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

    INSERT INTO fv.transfer_items (
      transfer_id, product_id, product_code, product_name, barcode_number,
      quantity_sent, unit_cost, reetiquetar
    ) VALUES (
      v_transfer_id, v_produto.id, v_produto.code, v_produto.name, v_produto.barcode_number,
      v_qtd, v_produto.cost_price,
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
  END LOOP;

  UPDATE fv.transfers
     SET totals = json_build_object('pecas', v_pecas, 'itens', v_itens, 'custo_total', v_custo),
         updated_at = now()
   WHERE id = v_transfer_id;

  RETURN json_build_object('success', true, 'transfer_id', v_transfer_id,
                           'pecas', v_pecas, 'itens', v_itens, 'custo_total', v_custo);
END;
$$;

COMMENT ON FUNCTION fv.enviar_transferencia IS
  'Abre o romaneio e tira o saldo da origem. Tudo numa transação: se uma peça falhar, nenhuma sai.';


-- ── 4. Receber: confere o que chegou e dá entrada no destino ────────────────

CREATE OR REPLACE FUNCTION fv.receber_transferencia(
  p_transfer_id uuid,
  p_recebidos   jsonb,   -- [{"product_id": "...", "quantity": 1}, ...]
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
  v_dest_id     uuid;
  v_divergiu    boolean := false;
  v_sobras      integer := 0;
  v_rec         jsonb;
BEGIN
  SELECT * INTO v_transfer FROM fv.transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Transferência não encontrada.');
  END IF;

  -- Idempotência: dois cliques em "Confirmar" não podem dar entrada duas vezes.
  IF v_transfer.status <> 'enviada' THEN
    RETURN json_build_object('success', false,
      'error', format('Esta transferência já está como "%s".', v_transfer.status));
  END IF;

  FOR v_item IN
    SELECT * FROM fv.transfer_items
     WHERE transfer_id = p_transfer_id AND quantity_sent > 0
     ORDER BY product_name
  LOOP
    -- Não bipada é zero recebido, e não "não conferida": a conferência acabou.
    SELECT COALESCE(MAX((r->>'quantity')::integer), 0) INTO v_recebido
      FROM jsonb_array_elements(COALESCE(p_recebidos, '[]'::jsonb)) r
     WHERE (r->>'product_id')::uuid = v_item.product_id;

    IF v_recebido > v_item.quantity_sent THEN
      v_recebido := v_item.quantity_sent;   -- excedente da mesma peça é sobra, tratada abaixo
    END IF;

    v_falta := v_item.quantity_sent - v_recebido;
    v_dest_id := NULL;

    SELECT * INTO v_origem FROM fv.products WHERE id = v_item.product_id FOR UPDATE;

    -- ─ o que chegou entra no destino ─
    IF v_recebido > 0 THEN
      /*
       * Caminho bom: a linha inteira foi embora e chegou inteira. Ela própria
       * muda de loja, então o código de barras da etiqueta continua valendo.
       * Só vale se a origem está zerada — se entrou peça nova pelo mesmo
       * cadastro enquanto isto estava em trânsito, cai no caminho de baixo.
       */
      IF NOT v_item.reetiquetar
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

        -- A peça continua sendo a MESMA linha: destino e origem coincidem.
        v_dest_id := v_origem.id;

        INSERT INTO fv.stock_movements (
          product_id, quantity_before, delta, quantity_after,
          reason, ref_type, ref_id, user_id
        ) VALUES (
          v_origem.id, 0, v_recebido, v_recebido,
          'transferencia_recebimento', 'transfer', p_transfer_id, p_user_id
        );

      ELSE
        /*
         * Parcial (ou origem já reabastecida): linha própria no destino.
         *
         * A linha é achada pelo `dest_product_id` de uma transferência ANTERIOR
         * da MESMA peça para a MESMA loja. Não por `code`: 227 códigos se
         * repetem dentro da mesma loja e um único code cobre até 8 peças
         * distintas — anel, brinco e colar dividem "FNO06499". Casar por code
         * somaria a quantidade do colar na linha do anel, calado.
         * (É o que `fv.transfer_stock`, a função antiga, fazia.)
         */
        SELECT p.* INTO v_destino
          FROM fv.transfer_items ti
          JOIN fv.transfers t  ON t.id = ti.transfer_id
          JOIN fv.products  p  ON p.id = ti.dest_product_id
         WHERE ti.product_id = v_item.product_id
           AND ti.dest_product_id IS NOT NULL
           AND t.to_store_id = v_transfer.to_store_id
           AND p.store_id    = v_transfer.to_store_id
         ORDER BY t.received_at DESC
         LIMIT 1
         FOR UPDATE OF p;

        IF FOUND THEN
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
        ELSE
          -- barcode_number fica de fora: o DEFAULT gera um novo, porque o
          -- índice único não deixa repetir o da origem. Daí `reetiquetar`.
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
    END IF;

    -- ─ o que faltou volta para a origem ─
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
           divergence_type = CASE WHEN v_falta > 0 THEN 'falta' ELSE NULL END
     WHERE id = v_item.id;
  END LOOP;

  -- ─ bipado no destino sem estar no romaneio ─
  -- Só fica registrado. Não vira saldo: não se sabe de onde a peça veio.
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

COMMENT ON FUNCTION fv.receber_transferencia IS
  'Confere o romaneio no destino. O que chegou entra, o que faltou volta para a origem, o que sobrou fica só registrado.';


-- ── 5. Cancelar: devolve tudo para a origem ─────────────────────────────────

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

  -- Só cancela o que ainda está em trânsito. Recebida já virou estoque no
  -- destino: desfazer aqui criaria peça em duas lojas ao mesmo tempo.
  IF v_transfer.status <> 'enviada' THEN
    RETURN json_build_object('success', false,
      'error', 'Só dá para cancelar transferência que ainda não foi conferida.');
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

COMMENT ON FUNCTION fv.cancelar_transferencia IS
  'Devolve para a origem tudo que estava em trânsito. Só vale enquanto o status é "enviada".';


-- ── 6. Permissões ───────────────────────────────────────────────────────────
-- O schema não herda GRANT: sem isto o PostgREST responde 42501.

GRANT SELECT, INSERT, UPDATE ON fv.transfers      TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON fv.transfer_items TO authenticated, service_role;

/*
 * RLS — obrigatória, e o GRANT acima NÃO é a única fonte de permissão.
 *
 * O schema `fv` tem um ALTER DEFAULT PRIVILEGES que dá ALL em tabela nova para
 * anon, authenticated e service_role. Ou seja: tabela criada aqui já nasce
 * com DELETE e TRUNCATE liberados para o `anon` — a chave que vai no bundle do
 * navegador, pública por definição. Sem RLS, qualquer pessoa com a URL do
 * projeto apagaria os romaneios.
 *
 * Todas as outras tabelas do schema já têm RLS ligada; estas duas nasceram sem.
 *
 * Só há política de SELECT. Escrita passa exclusivamente pelas funções
 * SECURITY DEFINER acima — com RLS ligada e nenhuma política de INSERT/UPDATE/
 * DELETE, o PostgREST recusa escrita direta mesmo para quem tem o GRANT.
 */
ALTER TABLE fv.transfers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fv.transfer_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON fv.transfers      FROM anon;
REVOKE ALL ON fv.transfer_items FROM anon;

CREATE POLICY transfers_admin_select ON fv.transfers
  FOR SELECT TO authenticated
  USING (fv.is_admin());

-- Operadora vê o que envolve a loja dela nas duas pontas: o que sai e o que chega.
CREATE POLICY transfers_operadora_select ON fv.transfers
  FOR SELECT TO authenticated
  USING (from_store_id = fv.get_user_store_id() OR to_store_id = fv.get_user_store_id());

CREATE POLICY transfer_items_admin_select ON fv.transfer_items
  FOR SELECT TO authenticated
  USING (fv.is_admin());

CREATE POLICY transfer_items_operadora_select ON fv.transfer_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM fv.transfers t
     WHERE t.id = transfer_items.transfer_id
       AND (t.from_store_id = fv.get_user_store_id() OR t.to_store_id = fv.get_user_store_id())
  ));

GRANT EXECUTE ON FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fv.receber_transferencia(uuid, jsonb, uuid, text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fv.cancelar_transferencia(uuid, uuid, text)             TO authenticated, service_role;
