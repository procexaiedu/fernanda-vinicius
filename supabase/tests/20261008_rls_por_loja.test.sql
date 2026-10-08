-- Teste da migration 20261008_rls_por_loja.sql com DADOS FICTÍCIOS.
-- Perfis: admin global (store_id NULL), admin de loja (B e C), operadora (B e C)
-- e uma admin de loja INATIVA. Rodar num banco de TESTE com o schema fv:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261008_rls_por_loja.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261008_rls_por_loja.test.sql
-- (ou: bash supabase/tests/rls_local/rodar_testes.sh, ver o README da pasta)
-- A sessão é simulada como o PostgREST faz: SET ROLE authenticated + claims do
-- JWT. Termina em ROLLBACK; qualquer ASSERT que falhe aborta com erro.

BEGIN;

-- ── Dados ────────────────────────────────────────────────────────────────────
-- Lojas: C (Campinas), B (Brasília) e X (uma terceira, para provar que o
-- romaneio C→X não aparece para B: com só duas lojas todo romaneio é das duas).
INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Loja C', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000000b1', 'Loja B', 'B', 'DF'),
  ('00000000-0000-0000-0000-0000000000e1', 'Loja X', 'X', 'SP');

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a0'), ('00000000-0000-0000-0000-0000000000ab'),
  ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-0000000000ac'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000001b');
INSERT INTO fv.users (id, full_name, role, store_id, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000a0', 'Global',       'admin',    NULL, true),
  ('00000000-0000-0000-0000-0000000000ab', 'Admin B',      'admin',    '00000000-0000-0000-0000-0000000000b1', true),
  ('00000000-0000-0000-0000-00000000000b', 'Operadora B',  'operator', '00000000-0000-0000-0000-0000000000b1', true),
  ('00000000-0000-0000-0000-0000000000ac', 'Admin C',      'admin',    '00000000-0000-0000-0000-0000000000c1', true),
  ('00000000-0000-0000-0000-00000000000c', 'Operadora C',  'operator', '00000000-0000-0000-0000-0000000000c1', true),
  ('00000000-0000-0000-0000-00000000001b', 'Ex-admin B',   'admin',    '00000000-0000-0000-0000-0000000000b1', false);

INSERT INTO fv.suppliers (id, name, initials, phones) VALUES
  ('00000000-0000-0000-0000-0000000005f1', 'Fornecedor F', 'FEF', '[]');

-- Uma peça por loja (P_C, P_B, P_X).
INSERT INTO fv.products (id, supplier_id, code, name, category, material, store_id, cost_price, sale_price,
                         quantity_in_stock, barcode_number, is_active, ownership_type, purchase_month, purchase_year)
VALUES
  ('00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-0000000005f1', 'FEF0C', 'Anel C', 'anel', 'ouro',
   '00000000-0000-0000-0000-0000000000c1', 100, 300, 5, 'RLS-C', true, 'own', 10, 2026),
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000005f1', 'FEF0B', 'Anel B', 'anel', 'ouro',
   '00000000-0000-0000-0000-0000000000b1', 100, 300, 5, 'RLS-B', true, 'own', 10, 2026),
  ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000005f1', 'FEF0X', 'Anel X', 'anel', 'ouro',
   '00000000-0000-0000-0000-0000000000e1', 100, 300, 5, 'RLS-X', true, 'own', 10, 2026);

-- Vendas, itens e pagamentos (V_C, V_B).
INSERT INTO fv.sales (id, store_id, user_id, subtotal, total, total_cost) VALUES
  ('00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000c', 300, 300, 100),
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 300, 300, 100);
INSERT INTO fv.sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal) VALUES
  ('00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-0000000001c1', 1, 300, 100, 300),
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000001b1', 1, 300, 100, 300);
INSERT INTO fv.sale_payments (sale_id, payment_method, amount) VALUES
  ('00000000-0000-0000-0000-0000000002c1', 'pix', 300),
  ('00000000-0000-0000-0000-0000000002b1', 'pix', 300);

-- Clientes, trocas.
INSERT INTO fv.customers (id, name, phone, origin_store_id) VALUES
  ('00000000-0000-0000-0000-0000000003c1', 'Cliente C', '1100000000', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000003b1', 'Cliente B', '6100000000', '00000000-0000-0000-0000-0000000000b1');
INSERT INTO fv.exchanges (id, store_id, customer_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000003c1', '00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-00000000000b');
INSERT INTO fv.exchange_items (exchange_id, direction, product_id, quantity, unit_price) VALUES
  ('00000000-0000-0000-0000-0000000004c1', 'returned', '00000000-0000-0000-0000-0000000001c1', 1, 300),
  ('00000000-0000-0000-0000-0000000004b1', 'returned', '00000000-0000-0000-0000-0000000001b1', 1, 300);

-- Financeiro: uma conta de cada loja e uma da REDE (store_id NULL).
INSERT INTO fv.transactions (id, store_id, type, amount, category, description, transaction_date) VALUES
  ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000000c1', 'expense', 50, 'aluguel', 'Aluguel C', CURRENT_DATE),
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-0000000000b1', 'expense', 50, 'aluguel', 'Aluguel B', CURRENT_DATE),
  ('00000000-0000-0000-0000-000000000600', NULL,                                   'expense', 50, 'contador', 'Rede',     CURRENT_DATE);
INSERT INTO fv.recurring_expenses (id, store_id, description, amount, category) VALUES
  ('00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000000c1', 'Luz C', 10, 'luz'),
  ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000000b1', 'Luz B', 10, 'luz'),
  ('00000000-0000-0000-0000-000000000800', NULL,                                   'Rede',  10, 'contador');

INSERT INTO fv.cash_closings (store_id, user_id, closing_date, total_sales, sales_count) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000c', CURRENT_DATE, 300, 1),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', CURRENT_DATE, 300, 1);
INSERT INTO fv.consignments (supplier_id, store_id, user_id, received_date, return_deadline, total_pieces, total_cost_value) VALUES
  ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a0', CURRENT_DATE, CURRENT_DATE + 30, 1, 100),
  ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a0', CURRENT_DATE, CURRENT_DATE + 30, 1, 100);
INSERT INTO fv.disparos (id, titulo, store_id, template_name) VALUES
  ('00000000-0000-0000-0000-0000000009c1', 'Disparo C', '00000000-0000-0000-0000-0000000000c1', 't'),
  ('00000000-0000-0000-0000-0000000009b1', 'Disparo B', '00000000-0000-0000-0000-0000000000b1', 't');
INSERT INTO fv.disparo_destinatarios (disparo_id, nome, telefone) VALUES
  ('00000000-0000-0000-0000-0000000009c1', 'Cliente C', '1100000000'),
  ('00000000-0000-0000-0000-0000000009b1', 'Cliente B', '6100000000');
INSERT INTO fv.fiscal_emitentes (store_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO fv.seller_goals (user_id) VALUES
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000b');

-- Conferência de estoque.
INSERT INTO fv.inventory_sessions (id, store_id, scope_type, user_id) VALUES
  ('00000000-0000-0000-0000-00000000a0c1', '00000000-0000-0000-0000-0000000000c1', 'loja', '00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-00000000a0b1', '00000000-0000-0000-0000-0000000000b1', 'loja', '00000000-0000-0000-0000-00000000000b');
INSERT INTO fv.inventory_scans (session_id, barcode_number, product_id) VALUES
  ('00000000-0000-0000-0000-00000000a0c1', 'RLS-C', '00000000-0000-0000-0000-0000000001c1'),
  ('00000000-0000-0000-0000-00000000a0b1', 'RLS-B', '00000000-0000-0000-0000-0000000001b1');
INSERT INTO fv.stock_movements (product_id, quantity_before, delta, quantity_after, reason, user_id) VALUES
  ('00000000-0000-0000-0000-0000000001c1', 5, -1, 4, 'teste', '00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-0000000001b1', 5, -1, 4, 'teste', '00000000-0000-0000-0000-00000000000b');

-- Romaneios: C→B (das duas), C→X (B não vê).
INSERT INTO fv.transfers (id, from_store_id, to_store_id, sent_by) VALUES
  ('00000000-0000-0000-0000-00000000b0cb', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a0'),
  ('00000000-0000-0000-0000-00000000b0ce', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0');
INSERT INTO fv.transfer_items (transfer_id, product_id, product_code, product_name, barcode_number, quantity_sent) VALUES
  ('00000000-0000-0000-0000-00000000b0cb', '00000000-0000-0000-0000-0000000001c1', 'FEF0C', 'Anel C', 'RLS-C', 1),
  ('00000000-0000-0000-0000-00000000b0ce', '00000000-0000-0000-0000-0000000001c1', 'FEF0C', 'Anel C', 'RLS-C', 1);
INSERT INTO fv.stock_transfers (product_id, from_store_id, to_store_id, quantity, user_id) VALUES
  ('00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, '00000000-0000-0000-0000-0000000000a0');

-- Compras (store_id NULL, como em produção): só C, só B, e MISTA (C + B).
INSERT INTO fv.purchases (id, user_id, purchase_date, total_cost, total_items) VALUES
  ('00000000-0000-0000-0000-00000000c0c1', '00000000-0000-0000-0000-0000000000a0', CURRENT_DATE, 100, 1),
  ('00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-0000000000a0', CURRENT_DATE, 100, 1),
  ('00000000-0000-0000-0000-00000000c0cb', '00000000-0000-0000-0000-0000000000a0', CURRENT_DATE, 200, 2);
INSERT INTO fv.purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES
  ('00000000-0000-0000-0000-00000000c0c1', '00000000-0000-0000-0000-0000000001c1', 1, 100, 100),
  ('00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-0000000001b1', 1, 100, 100),
  ('00000000-0000-0000-0000-00000000c0cb', '00000000-0000-0000-0000-0000000001c1', 1, 100, 100),
  ('00000000-0000-0000-0000-00000000c0cb', '00000000-0000-0000-0000-0000000001b1', 1, 100, 100);
INSERT INTO fv.purchase_payments (purchase_id, payment_method, amount) VALUES
  ('00000000-0000-0000-0000-00000000c0c1', 'pix', 100),
  ('00000000-0000-0000-0000-00000000c0b1', 'pix', 100),
  ('00000000-0000-0000-0000-00000000c0cb', 'pix', 200);

-- ── Ferramentas ──────────────────────────────────────────────────────────────
-- Como o PostgREST: papel authenticated + sub do JWT.
CREATE FUNCTION pg_temp.como(uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Nº de linhas visíveis de uma consulta; NULL = sem permissão (42501).
CREATE FUNCTION pg_temp.n(consulta text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM (%s) q', consulta) INTO r;
  RETURN r;
EXCEPTION WHEN insufficient_privilege THEN RETURN NULL;
END $$;

-- Executa um comando de escrita; devolve as linhas afetadas, ou -1 se o RLS
-- recusou (INSERT/WITH CHECK levanta 42501; UPDATE/DELETE fora do alcance
-- simplesmente não acham a linha e devolvem 0). Desfaz a escrita (savepoint).
CREATE FUNCTION pg_temp.w(comando text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r integer;
BEGIN
  BEGIN
    EXECUTE comando;
    GET DIAGNOSTICS r = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = r::text;   -- desfaz
  EXCEPTION
    WHEN insufficient_privilege THEN RETURN -1;
    WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM::integer;
  END;
END $$;

-- Confere e dá nome ao que falhou.
CREATE FUNCTION pg_temp.ok(perfil text, caso text, obtido integer, esperado integer) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU [%] %: obtido %, esperado %', perfil, caso, obtido, esperado;
  END IF;
  RAISE NOTICE 'ok [%] %', perfil, caso;
END $$;

GRANT EXECUTE ON FUNCTION pg_temp.como(uuid), pg_temp.n(text), pg_temp.w(text),
  pg_temp.ok(text, text, integer, integer) TO authenticated;

-- Atalhos de id (texto, para montar as consultas).
CREATE TEMP TABLE ids AS SELECT
  '''00000000-0000-0000-0000-0000000000c1''' AS c,
  '''00000000-0000-0000-0000-0000000000b1''' AS b;
GRANT SELECT ON ids TO authenticated;

-- ── 1. ADMIN DE LOJA (B): só a loja dela ─────────────────────────────────────
SELECT pg_temp.como('00000000-0000-0000-0000-0000000000ab');
SET LOCAL ROLE authenticated;
DO $$
DECLARE p text := 'admin de loja B'; c text; b text; t text;
BEGIN
  SELECT ids.c, ids.b INTO c, b FROM ids;

  -- SELECT, tabela a tabela: a outra loja some, a dela aparece.
  FOREACH t IN ARRAY ARRAY['sales', 'products', 'transactions', 'cash_closings', 'consignments',
                           'disparos', 'exchanges', 'recurring_expenses', 'fiscal_emitentes', 'inventory_sessions'] LOOP
    PERFORM pg_temp.ok(p, t || ' da outra loja', pg_temp.n(format('SELECT 1 FROM fv.%I WHERE store_id = %s', t, c)), 0);
    PERFORM pg_temp.ok(p, t || ' da própria',    pg_temp.n(format('SELECT 1 FROM fv.%I WHERE store_id = %s', t, b)), 1);
  END LOOP;
  PERFORM pg_temp.ok(p, 'customers da outra loja', pg_temp.n('SELECT 1 FROM fv.customers WHERE origin_store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'customers da própria',    pg_temp.n('SELECT 1 FROM fv.customers WHERE origin_store_id = ' || b), 1);
  PERFORM pg_temp.ok(p, 'transactions da rede (NULL)', pg_temp.n('SELECT 1 FROM fv.transactions WHERE store_id IS NULL'), 0);
  PERFORM pg_temp.ok(p, 'recorrentes da rede (NULL)',  pg_temp.n('SELECT 1 FROM fv.recurring_expenses WHERE store_id IS NULL'), 0);

  -- Loja derivada por join.
  PERFORM pg_temp.ok(p, 'sale_items (só os da B)',    pg_temp.n('SELECT 1 FROM fv.sale_items'), 1);
  PERFORM pg_temp.ok(p, 'sale_payments (só os da B)', pg_temp.n('SELECT 1 FROM fv.sale_payments'), 1);
  PERFORM pg_temp.ok(p, 'exchange_items',             pg_temp.n('SELECT 1 FROM fv.exchange_items'), 1);
  PERFORM pg_temp.ok(p, 'disparo_destinatarios',      pg_temp.n('SELECT 1 FROM fv.disparo_destinatarios'), 1);
  PERFORM pg_temp.ok(p, 'inventory_scans',            pg_temp.n('SELECT 1 FROM fv.inventory_scans'), 1);
  PERFORM pg_temp.ok(p, 'stock_movements',            pg_temp.n('SELECT 1 FROM fv.stock_movements'), 1);
  PERFORM pg_temp.ok(p, 'seller_goals',               pg_temp.n('SELECT 1 FROM fv.seller_goals'), 1);
  PERFORM pg_temp.ok(p, 'users (B ativas + inativa)',  pg_temp.n('SELECT 1 FROM fv.users WHERE store_id = ' || b), 3);
  PERFORM pg_temp.ok(p, 'users: lê a admin global (remetente)', pg_temp.n('SELECT 1 FROM fv.users WHERE store_id IS NULL'), 1);
  PERFORM pg_temp.ok(p, 'UPDATE admin global', pg_temp.w('UPDATE fv.users SET full_name = ''x'' WHERE store_id IS NULL'), 0);
  PERFORM pg_temp.ok(p, 'users da outra loja',        pg_temp.n('SELECT 1 FROM fv.users WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'romaneios: C→B sim, C→X não', pg_temp.n('SELECT 1 FROM fv.transfers'), 1);
  PERFORM pg_temp.ok(p, 'itens de romaneio',          pg_temp.n('SELECT 1 FROM fv.transfer_items'), 1);
  PERFORM pg_temp.ok(p, 'stock_transfers C→X',        pg_temp.n('SELECT 1 FROM fv.stock_transfers'), 0);
  -- Compras: só-C some; só-B e MISTA aparecem; itens só os das peças dela.
  PERFORM pg_temp.ok(p, 'compras (só-B + mista)',     pg_temp.n('SELECT 1 FROM fv.purchases'), 2);
  PERFORM pg_temp.ok(p, 'itens de compra (peça B)',   pg_temp.n('SELECT 1 FROM fv.purchase_items'), 2);
  PERFORM pg_temp.ok(p, 'pagamentos de compra',       pg_temp.n('SELECT 1 FROM fv.purchase_payments'), 2);
  -- Rede: lojas e fornecedores, leitura.
  PERFORM pg_temp.ok(p, 'stores (lê as lojas)',       pg_temp.n('SELECT 1 FROM fv.stores WHERE city IN (''C'', ''B'', ''X'')'), 3);
  PERFORM pg_temp.ok(p, 'suppliers (rede)',           pg_temp.n('SELECT 1 FROM fv.suppliers WHERE name = ''Fornecedor F'''), 1);

  -- ESCRITA na outra loja: nada passa.
  PERFORM pg_temp.ok(p, 'INSERT venda em C', pg_temp.w(format(
    'INSERT INTO fv.sales (store_id, user_id, subtotal, total, total_cost) VALUES (%s, auth.uid(), 1, 1, 0)', c)), -1);
  PERFORM pg_temp.ok(p, 'INSERT despesa em C', pg_temp.w(format(
    'INSERT INTO fv.transactions (store_id, type, amount, category, description, transaction_date) VALUES (%s, ''expense'', 1, ''x'', ''x'', CURRENT_DATE)', c)), -1);
  PERFORM pg_temp.ok(p, 'INSERT despesa da rede', pg_temp.w(
    'INSERT INTO fv.transactions (store_id, type, amount, category, description, transaction_date) VALUES (NULL, ''expense'', 1, ''x'', ''x'', CURRENT_DATE)'), -1);
  PERFORM pg_temp.ok(p, 'UPDATE preço de peça de C', pg_temp.w('UPDATE fv.products SET sale_price = 1 WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'UPDATE mover peça B para C', pg_temp.w('UPDATE fv.products SET store_id = ' || c || ' WHERE store_id = ' || b), -1);
  PERFORM pg_temp.ok(p, 'DELETE despesa de C', pg_temp.w('DELETE FROM fv.transactions WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'DELETE venda de C', pg_temp.w('DELETE FROM fv.sales WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'UPDATE cliente de C', pg_temp.w('UPDATE fv.customers SET name = ''x'' WHERE origin_store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'UPDATE usuária de C', pg_temp.w('UPDATE fv.users SET full_name = ''x'' WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'UPDATE compra MISTA', pg_temp.w(
    'UPDATE fv.purchases SET notes = ''x'' WHERE id = ''00000000-0000-0000-0000-00000000c0cb'''), 0);
  PERFORM pg_temp.ok(p, 'DELETE compra só-C', pg_temp.w(
    'DELETE FROM fv.purchase_payments WHERE purchase_id = ''00000000-0000-0000-0000-00000000c0c1'''), 0);
  PERFORM pg_temp.ok(p, 'INSERT pagamento em compra MISTA', pg_temp.w(
    'INSERT INTO fv.purchase_payments (purchase_id, payment_method, amount) VALUES (''00000000-0000-0000-0000-00000000c0cb'', ''pix'', 1)'), -1);
  PERFORM pg_temp.ok(p, 'UPDATE settings (rede)', pg_temp.w('UPDATE fv.settings SET description = ''x'''), 0);
  PERFORM pg_temp.ok(p, 'INSERT loja', pg_temp.w(
    'INSERT INTO fv.stores (name, city, state) VALUES (''Nova'', ''N'', ''SP'')'), -1);
  PERFORM pg_temp.ok(p, 'UPDATE loja C', pg_temp.w('UPDATE fv.stores SET name = ''x'' WHERE id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'UPDATE usuária B virar global', pg_temp.w(
    'UPDATE fv.users SET store_id = NULL WHERE id = ''00000000-0000-0000-0000-00000000000b'''), -1);

  -- ESCRITA na própria: passa.
  PERFORM pg_temp.ok(p, 'INSERT despesa em B', pg_temp.w(format(
    'INSERT INTO fv.transactions (store_id, type, amount, category, description, transaction_date) VALUES (%s, ''expense'', 1, ''x'', ''x'', CURRENT_DATE)', b)), 1);
  PERFORM pg_temp.ok(p, 'UPDATE preço de peça de B', pg_temp.w('UPDATE fv.products SET sale_price = 2 WHERE store_id = ' || b), 1);
  PERFORM pg_temp.ok(p, 'DELETE despesa de B', pg_temp.w('DELETE FROM fv.transactions WHERE store_id = ' || b), 1);
  PERFORM pg_temp.ok(p, 'UPDATE cliente de B', pg_temp.w('UPDATE fv.customers SET name = ''y'' WHERE origin_store_id = ' || b), 1);
  PERFORM pg_temp.ok(p, 'UPDATE compra só-B', pg_temp.w(
    'UPDATE fv.purchases SET notes = ''x'' WHERE id = ''00000000-0000-0000-0000-00000000c0b1'''), 1);
  PERFORM pg_temp.ok(p, 'UPDATE usuária de B', pg_temp.w('UPDATE fv.users SET full_name = ''z'' WHERE id = ''00000000-0000-0000-0000-00000000000b'''), 1);
END $$;
RESET ROLE;

-- ── 2. ADMIN DE LOJA (C): o espelho ──────────────────────────────────────────
SELECT pg_temp.como('00000000-0000-0000-0000-0000000000ac');
SET LOCAL ROLE authenticated;
DO $$
DECLARE p text := 'admin de loja C'; c text; b text;
BEGIN
  SELECT ids.c, ids.b INTO c, b FROM ids;
  PERFORM pg_temp.ok(p, 'sales de B',     pg_temp.n('SELECT 1 FROM fv.sales WHERE store_id = ' || b), 0);
  PERFORM pg_temp.ok(p, 'sales de C',     pg_temp.n('SELECT 1 FROM fv.sales WHERE store_id = ' || c), 1);
  PERFORM pg_temp.ok(p, 'romaneios C→B e C→X', pg_temp.n('SELECT 1 FROM fv.transfers'), 2);
  PERFORM pg_temp.ok(p, 'compras (só-C + mista)', pg_temp.n('SELECT 1 FROM fv.purchases'), 2);
  PERFORM pg_temp.ok(p, 'UPDATE produto de B', pg_temp.w('UPDATE fv.products SET sale_price = 1 WHERE store_id = ' || b), 0);
END $$;
RESET ROLE;

-- ── 3. OPERADORA (B) ─────────────────────────────────────────────────────────
SELECT pg_temp.como('00000000-0000-0000-0000-00000000000b');
SET LOCAL ROLE authenticated;
DO $$
DECLARE p text := 'operadora B'; c text; b text;
BEGIN
  SELECT ids.c, ids.b INTO c, b FROM ids;
  -- Clientes: era NOT is_admin() → lia as duas lojas. Agora só a dela.
  PERFORM pg_temp.ok(p, 'clientes de C', pg_temp.n('SELECT 1 FROM fv.customers WHERE origin_store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'clientes de B', pg_temp.n('SELECT 1 FROM fv.customers WHERE origin_store_id = ' || b), 1);
  -- Custo segue fora (20261006): nenhuma linha de venda/peça/romaneio.
  PERFORM pg_temp.ok(p, 'sales',          pg_temp.n('SELECT 1 FROM fv.sales'), 0);
  PERFORM pg_temp.ok(p, 'products',       pg_temp.n('SELECT 1 FROM fv.products'), 0);
  PERFORM pg_temp.ok(p, 'sale_items',     pg_temp.n('SELECT 1 FROM fv.sale_items'), 0);
  PERFORM pg_temp.ok(p, 'transfers',      pg_temp.n('SELECT 1 FROM fv.transfers'), 0);
  PERFORM pg_temp.ok(p, 'purchases',      pg_temp.n('SELECT 1 FROM fv.purchases'), 0);
  PERFORM pg_temp.ok(p, 'transactions',   pg_temp.n('SELECT 1 FROM fv.transactions'), 0);
  -- O que ela já via da loja dela continua.
  PERFORM pg_temp.ok(p, 'caixa de C',     pg_temp.n('SELECT 1 FROM fv.cash_closings WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'caixa de B',     pg_temp.n('SELECT 1 FROM fv.cash_closings WHERE store_id = ' || b), 1);
  PERFORM pg_temp.ok(p, 'conferência de C', pg_temp.n('SELECT 1 FROM fv.inventory_sessions WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'conferência de B', pg_temp.n('SELECT 1 FROM fv.inventory_sessions WHERE store_id = ' || b), 1);
  PERFORM pg_temp.ok(p, 'bipes de B',     pg_temp.n('SELECT 1 FROM fv.inventory_scans'), 1);
  -- sale_payments_operator olha fv.sales, que ela não lê desde 20261006: já era
  -- 0 antes desta migration (o PDV lê pelo servidor). Fica registrado.
  PERFORM pg_temp.ok(p, 'pagamentos de venda (já era 0)', pg_temp.n('SELECT 1 FROM fv.sale_payments'), 0);
  PERFORM pg_temp.ok(p, 'disparos de B',  pg_temp.n('SELECT 1 FROM fv.disparos'), 1);
  PERFORM pg_temp.ok(p, 'stores (só a dela)', pg_temp.n('SELECT 1 FROM fv.stores'), 1);
  PERFORM pg_temp.ok(p, 'users (só ela)', pg_temp.n('SELECT 1 FROM fv.users'), 1);
  PERFORM pg_temp.ok(p, 'meta (só a dela)', pg_temp.n('SELECT 1 FROM fv.seller_goals'), 1);
  -- Escrita.
  PERFORM pg_temp.ok(p, 'INSERT venda em C', pg_temp.w(format(
    'INSERT INTO fv.sales (store_id, user_id, subtotal, total, total_cost) VALUES (%s, auth.uid(), 1, 1, 0)', c)), -1);
  PERFORM pg_temp.ok(p, 'INSERT venda em B', pg_temp.w(format(
    'INSERT INTO fv.sales (store_id, user_id, subtotal, total, total_cost) VALUES (%s, auth.uid(), 1, 1, 0)', b)), 1);
  PERFORM pg_temp.ok(p, 'INSERT cliente em C', pg_temp.w(format(
    'INSERT INTO fv.customers (name, phone, origin_store_id) VALUES (''x'', ''1'', %s)', c)), -1);
  PERFORM pg_temp.ok(p, 'INSERT cliente em B', pg_temp.w(format(
    'INSERT INTO fv.customers (name, phone, origin_store_id) VALUES (''x'', ''2'', %s)', b)), 1);
  PERFORM pg_temp.ok(p, 'UPDATE caixa de C', pg_temp.w('UPDATE fv.cash_closings SET notes = ''x'' WHERE store_id = ' || c), 0);
  PERFORM pg_temp.ok(p, 'UPDATE caixa de B', pg_temp.w('UPDATE fv.cash_closings SET notes = ''x'' WHERE store_id = ' || b), 1);
  PERFORM pg_temp.ok(p, 'DELETE produto', pg_temp.w('DELETE FROM fv.products'), 0);
END $$;
RESET ROLE;

-- ── 4. ADMIN GLOBAL: as duas lojas e a rede ──────────────────────────────────
SELECT pg_temp.como('00000000-0000-0000-0000-0000000000a0');
SET LOCAL ROLE authenticated;
DO $$
DECLARE p text := 'admin global'; c text; b text;
BEGIN
  SELECT ids.c, ids.b INTO c, b FROM ids;
  PERFORM pg_temp.ok(p, 'sales',              pg_temp.n('SELECT 1 FROM fv.sales'), 2);
  PERFORM pg_temp.ok(p, 'products',           pg_temp.n('SELECT 1 FROM fv.products WHERE barcode_number LIKE ''RLS-%'''), 3);
  PERFORM pg_temp.ok(p, 'customers',          pg_temp.n('SELECT 1 FROM fv.customers'), 2);
  PERFORM pg_temp.ok(p, 'transactions (+rede)', pg_temp.n('SELECT 1 FROM fv.transactions'), 3);
  PERFORM pg_temp.ok(p, 'recorrentes (+rede)', pg_temp.n('SELECT 1 FROM fv.recurring_expenses'), 3);
  PERFORM pg_temp.ok(p, 'purchases',          pg_temp.n('SELECT 1 FROM fv.purchases'), 3);
  PERFORM pg_temp.ok(p, 'purchase_items',     pg_temp.n('SELECT 1 FROM fv.purchase_items'), 4);
  PERFORM pg_temp.ok(p, 'transfers',          pg_temp.n('SELECT 1 FROM fv.transfers'), 2);
  PERFORM pg_temp.ok(p, 'transfer_items',     pg_temp.n('SELECT 1 FROM fv.transfer_items'), 2);
  PERFORM pg_temp.ok(p, 'users',              pg_temp.n('SELECT 1 FROM fv.users WHERE full_name <> ''Seed'''), 6);
  PERFORM pg_temp.ok(p, 'stock_movements',    pg_temp.n('SELECT 1 FROM fv.stock_movements'), 2);
  PERFORM pg_temp.ok(p, 'inventory_scans',    pg_temp.n('SELECT 1 FROM fv.inventory_scans'), 2);
  PERFORM pg_temp.ok(p, 'UPDATE produto de C',  pg_temp.w('UPDATE fv.products SET sale_price = 1 WHERE store_id = ' || c), 1);
  PERFORM pg_temp.ok(p, 'UPDATE compra MISTA',  pg_temp.w(
    'UPDATE fv.purchases SET notes = ''x'' WHERE id = ''00000000-0000-0000-0000-00000000c0cb'''), 1);
  PERFORM pg_temp.ok(p, 'INSERT despesa da rede', pg_temp.w(
    'INSERT INTO fv.transactions (store_id, type, amount, category, description, transaction_date) VALUES (NULL, ''expense'', 1, ''x'', ''x'', CURRENT_DATE)'), 1);
  PERFORM pg_temp.ok(p, 'UPDATE loja C', pg_temp.w('UPDATE fv.stores SET phone = ''1'' WHERE id = ' || c), 1);
END $$;
RESET ROLE;

-- ── 5. ADMIN INATIVA: nada ───────────────────────────────────────────────────
SELECT pg_temp.como('00000000-0000-0000-0000-00000000001b');
SET LOCAL ROLE authenticated;
DO $$
DECLARE p text := 'admin inativa';
BEGIN
  PERFORM pg_temp.ok(p, 'sales',     pg_temp.n('SELECT 1 FROM fv.sales'), 0);
  PERFORM pg_temp.ok(p, 'customers', pg_temp.n('SELECT 1 FROM fv.customers'), 0);
  PERFORM pg_temp.ok(p, 'products',  pg_temp.n('SELECT 1 FROM fv.products'), 0);
END $$;
RESET ROLE;

-- ── 6. Servidor (service_role) e RPCs: nada mudou ────────────────────────────
-- O app lê e grava com service_role (BYPASSRLS). PDV, transferência, remessa,
-- conferência e compra passam por RPCs que authenticated nem executa.
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM pg_temp.ok('service_role', 'sales',     (SELECT count(*)::int FROM fv.sales), 2);
  PERFORM pg_temp.ok('service_role', 'purchases', (SELECT count(*)::int FROM fv.purchases), 3);
  PERFORM pg_temp.ok('service_role', 'transfers', (SELECT count(*)::int FROM fv.transfers), 2);
END $$;
RESET ROLE;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p
   WHERE p.pronamespace = 'fv'::regnamespace
     AND p.proname IN ('salvar_venda', 'editar_venda', 'excluir_venda', 'enviar_transferencia',
                       'receber_transferencia', 'cancelar_transferencia', 'salvar_compra',
                       'salvar_compra_com_remessa', 'editar_compra', 'excluir_compra',
                       'open_inventory_session', 'close_inventory_session', 'baixar_estoque',
                       'abrir_remessa_de_compra', 'registrar_acerto')
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'));
  PERFORM pg_temp.ok('rpcs', 'só service_role executa as RPCs de fluxo', n, 0);
END $$;

ROLLBACK;
