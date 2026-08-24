-- ============================================================================
-- Conferência de estoque (recontagem por bipe) + ledger de movimentação
-- ============================================================================
--
-- DECISÃO DE ARQUITETURA — ler antes de mexer:
--
-- `products.quantity_in_stock` CONTINUA sendo a fonte única do saldo. PDV,
-- compras, transferências e todas as views seguem lendo e escrevendo nela.
--
-- `fv.stock_movements` NÃO é fonte de saldo — é o diário de ajustes. Por isso
-- NÃO existe (e não deve ser criada) nenhuma view somando os deltas: enquanto
-- o PDV escrever direto na coluna, uma view somando o ledger daria um segundo
-- número divergente. É o "ghost stock" que já mordeu o iPrado (saldo visual e
-- saldo do ledger descolados, e o filtro `HAVING SUM > 0` escondendo o erro em
-- vez de mostrar).
--
-- Cada linha do ledger guarda `quantity_before` e `quantity_after`, e não só o
-- delta. Assim cada linha é uma frase completa e auditável sozinha ("era 3,
-- virou 1"), sem depender de somatório. Isso é o que torna seguro o ledger
-- cobrir só os ajustes de conferência por enquanto.
--
-- Se um dia PDV/compras passarem a escrever aqui também, a tabela já tem a
-- forma certa e aí sim o saldo pode migrar para o ledger.
-- ============================================================================


-- ── 1. Ledger de movimentação de estoque ────────────────────────────────────

CREATE TABLE IF NOT EXISTS fv.stock_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES fv.products(id) ON DELETE CASCADE,
  quantity_before  integer NOT NULL,
  delta            integer NOT NULL,
  quantity_after   integer NOT NULL,
  reason           text NOT NULL,
  ref_type         text NOT NULL DEFAULT 'manual',
  ref_id           uuid,
  user_id          uuid NOT NULL REFERENCES fv.users(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stock_movements_delta_confere
    CHECK (quantity_after = quantity_before + delta),
  CONSTRAINT stock_movements_delta_nao_zero
    CHECK (delta <> 0),
  CONSTRAINT stock_movements_nao_negativo
    CHECK (quantity_after >= 0),
  CONSTRAINT stock_movements_ref_type_valido
    CHECK (ref_type IN ('inventory_session', 'manual', 'sale', 'purchase', 'transfer'))
);

COMMENT ON TABLE  fv.stock_movements IS
  'Diário de ajustes de estoque. NÃO é fonte de saldo — quem manda é products.quantity_in_stock. Não criar view somando delta (ver cabeçalho da migration 20260824).';
COMMENT ON COLUMN fv.stock_movements.quantity_before IS
  'Saldo imediatamente antes do ajuste. Existe para a linha ser auditável sozinha, sem somatório.';
COMMENT ON COLUMN fv.stock_movements.quantity_after IS
  'Saldo imediatamente depois. Igual ao quantity_in_stock gravado em products na mesma transação.';
COMMENT ON COLUMN fv.stock_movements.reason IS
  'Motivo do ajuste. Na conferência: furto_perda | venda_nao_lancada | estava_em_outro_lugar | erro_de_cadastro | contagem.';
COMMENT ON COLUMN fv.stock_movements.ref_type IS
  'Origem do ajuste. Hoje só inventory_session e manual são gravados; sale/purchase/transfer ficam reservados.';

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
  ON fv.stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref
  ON fv.stock_movements (ref_type, ref_id);


-- ── 2. Sessão de conferência ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fv.inventory_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid NOT NULL REFERENCES fv.stores(id),
  scope_type        text NOT NULL,
  scope_value       text,
  scope_product_ids uuid[] NOT NULL DEFAULT '{}',
  user_id           uuid NOT NULL REFERENCES fv.users(id),
  status            text NOT NULL DEFAULT 'contando',
  started_at        timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  totals            jsonb,
  notes             text,

  CONSTRAINT inventory_sessions_scope_type_valido
    CHECK (scope_type IN ('categoria', 'loja')),
  CONSTRAINT inventory_sessions_status_valido
    CHECK (status IN ('contando', 'fechada', 'cancelada')),
  CONSTRAINT inventory_sessions_categoria_tem_valor
    CHECK (scope_type <> 'categoria' OR scope_value IS NOT NULL)
);

COMMENT ON TABLE  fv.inventory_sessions IS
  'Uma recontagem de estoque, do escopo ao fechamento. Fechada é imutável.';
COMMENT ON COLUMN fv.inventory_sessions.scope_product_ids IS
  'Snapshot dos produtos em escopo, CONGELADO na abertura. É ele que define o que conta como falta — sem isso, um produto cadastrado no meio da contagem viraria falta falsa.';
COMMENT ON COLUMN fv.inventory_sessions.totals IS
  'Resumo congelado no fechamento: {bate, falta, sobra, nao_cadastrado, ajustes_aplicados}.';

CREATE INDEX IF NOT EXISTS idx_inventory_sessions_store
  ON fv.inventory_sessions (store_id, started_at DESC);
-- Uma conferência aberta por vez, por loja: evita duas contagens concorrentes
-- disputando o mesmo estoque físico.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inventory_session_aberta_por_loja
  ON fv.inventory_sessions (store_id)
  WHERE status = 'contando';


-- ── 3. Bipes da conferência ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fv.inventory_scans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES fv.inventory_sessions(id) ON DELETE CASCADE,
  barcode_number text NOT NULL,
  product_id     uuid REFERENCES fv.products(id) ON DELETE SET NULL,
  scanned_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  fv.inventory_scans IS
  'Um bipe = uma peça contada. Repetição é significativa (2 bipes = 2 peças), por isso NÃO há unique em (session_id, barcode_number).';
COMMENT ON COLUMN fv.inventory_scans.product_id IS
  'NULL quando a etiqueta lida não corresponde a nenhum produto — resolvido na reconciliação, não na contagem.';

CREATE INDEX IF NOT EXISTS idx_inventory_scans_session
  ON fv.inventory_scans (session_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_scans_produto
  ON fv.inventory_scans (session_id, product_id);


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
--
-- O app roda tudo por server action com service role (bypassa RLS). Isto aqui
-- é defesa em profundidade, seguindo a estratégia documentada em
-- docs/schema_database.md §8: admin total; operadora limitada à sua loja.

ALTER TABLE fv.stock_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fv.inventory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fv.inventory_scans    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_movements_leitura ON fv.stock_movements;
CREATE POLICY stock_movements_leitura ON fv.stock_movements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fv.users u
      WHERE u.id = auth.uid()
        AND (u.role = 'admin' OR u.store_id = (
              SELECT p.store_id FROM fv.products p WHERE p.id = stock_movements.product_id
            ))
    )
  );

DROP POLICY IF EXISTS inventory_sessions_leitura ON fv.inventory_sessions;
CREATE POLICY inventory_sessions_leitura ON fv.inventory_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fv.users u
      WHERE u.id = auth.uid()
        AND (u.role = 'admin' OR u.store_id = inventory_sessions.store_id)
    )
  );

DROP POLICY IF EXISTS inventory_scans_leitura ON fv.inventory_scans;
CREATE POLICY inventory_scans_leitura ON fv.inventory_scans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fv.inventory_sessions s
      JOIN fv.users u ON u.id = auth.uid()
      WHERE s.id = inventory_scans.session_id
        AND (u.role = 'admin' OR u.store_id = s.store_id)
    )
  );


-- ── 5. Abrir sessão ─────────────────────────────────────────────────────────
--
-- RPC (e não INSERT do app) porque o snapshot do escopo tem que ser tirado na
-- mesma transação da criação da sessão.

CREATE OR REPLACE FUNCTION fv.open_inventory_session(
  p_store_id    uuid,
  p_scope_type  text,
  p_scope_value text,
  p_user_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fv, public
AS $$
DECLARE
  v_ids        uuid[];
  v_session_id uuid;
BEGIN
  IF p_scope_type NOT IN ('categoria', 'loja') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escopo inválido.');
  END IF;

  IF EXISTS (SELECT 1 FROM fv.inventory_sessions
              WHERE store_id = p_store_id AND status = 'contando') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Já existe uma conferência em andamento nesta loja. Termine ou cancele antes de abrir outra.');
  END IF;

  -- Congela o escopo. Só peças ativas: produto inativo não está na gaveta.
  SELECT coalesce(array_agg(p.id), '{}')
    INTO v_ids
    FROM fv.products p
   WHERE p.store_id = p_store_id
     AND p.is_active = true
     AND (p_scope_type = 'loja' OR p.category = p_scope_value);

  IF array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nenhuma peça ativa neste escopo.');
  END IF;

  INSERT INTO fv.inventory_sessions (store_id, scope_type, scope_value, scope_product_ids, user_id)
  VALUES (p_store_id, p_scope_type,
          CASE WHEN p_scope_type = 'loja' THEN NULL ELSE p_scope_value END,
          v_ids, p_user_id)
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'em_escopo', array_length(v_ids, 1)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION fv.open_inventory_session IS
  'Abre uma conferência congelando o conjunto de produtos em escopo. Recusa se já houver conferência aberta na loja.';


-- ── 6. Fechar sessão e aplicar os ajustes ───────────────────────────────────
--
-- Atômico por necessidade: o UPDATE do saldo e o INSERT no ledger têm que ir
-- juntos. Se só o saldo fosse, perderíamos o registro do porquê — que é a
-- única razão do ledger existir. Mesmo padrão de fv.transfer_stock.
--
-- p_adjustments: [{ product_id, new_quantity, reason, notes? }, ...]
-- Produtos ausentes da lista ficam como estão (o "deixar como está" da tela).

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
  v_status     text;
  v_adj        jsonb;
  v_product_id uuid;
  v_new_qty    integer;
  v_old_qty    integer;
  v_reason     text;
  v_aplicados  integer := 0;
BEGIN
  SELECT status INTO v_status
    FROM fv.inventory_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Conferência não encontrada.');
  END IF;
  IF v_status <> 'contando' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta conferência já foi fechada.');
  END IF;

  FOR v_adj IN SELECT value FROM jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb))
  LOOP
    v_product_id := (v_adj->>'product_id')::uuid;
    v_new_qty    := (v_adj->>'new_quantity')::integer;
    v_reason     := coalesce(nullif(v_adj->>'reason', ''), 'contagem');

    IF v_product_id IS NULL OR v_new_qty IS NULL THEN CONTINUE; END IF;
    IF v_new_qty < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Quantidade negativa não é permitida.');
    END IF;

    SELECT quantity_in_stock INTO v_old_qty
      FROM fv.products WHERE id = v_product_id FOR UPDATE;

    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_old_qty = v_new_qty THEN CONTINUE; END IF;

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
                     || jsonb_build_object('ajustes_aplicados', v_aplicados)
   WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true, 'ajustes_aplicados', v_aplicados);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION fv.close_inventory_session IS
  'Aplica os ajustes da conferência e fecha a sessão numa transação só: saldo em products e linha no ledger sempre juntos.';


-- ── 7. Grants ───────────────────────────────────────────────────────────────

GRANT SELECT ON fv.stock_movements, fv.inventory_sessions, fv.inventory_scans
  TO authenticated;

GRANT EXECUTE ON FUNCTION fv.open_inventory_session(uuid, text, text, uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION fv.close_inventory_session(uuid, jsonb, jsonb, uuid)      TO authenticated;
