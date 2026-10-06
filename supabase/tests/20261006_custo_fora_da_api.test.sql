-- Teste da migration 20261006_custo_fora_da_api.sql com DADOS FICTÍCIOS e os três
-- papéis do sistema: admin global (store_id nulo), admin de loja e operadora.
-- Rodar num banco de TESTE com o schema fv (pg_dump -s), nunca em produção:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261006_custo_fora_da_api.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261006_custo_fora_da_api.test.sql
-- A sessão é simulada como o PostgREST faz: SET ROLE authenticated + claims do JWT.
-- Termina em ROLLBACK; qualquer ASSERT que falhe aborta com erro.

BEGIN;

INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Loja C', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000000b1', 'Loja B', 'B', 'DF');
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-00000000aaaa'),
  ('00000000-0000-0000-0000-00000000cccc'),
  ('00000000-0000-0000-0000-00000000bbbb');
INSERT INTO fv.users (id, full_name, role, store_id) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', 'Admin global', 'admin',    NULL),
  ('00000000-0000-0000-0000-00000000cccc', 'Admin de B',   'admin',    '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000bbbb', 'Operadora B',  'operator', '00000000-0000-0000-0000-0000000000b1');

INSERT INTO fv.suppliers (id, name, initials, phones) VALUES
  ('00000000-0000-0000-0000-0000000005f1', 'Fornecedor F', 'FEF', '[]');
INSERT INTO fv.products (supplier_id, id, code, name, category, material, store_id, cost_price, sale_price, quantity_in_stock, barcode_number, is_active, ownership_type, purchase_month, purchase_year)
VALUES ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-0000000000a1', 'FEF09110', 'Colar', 'colar', 'ouro',
        '00000000-0000-0000-0000-0000000000b1', 110, 330, 2, 'T-1', true, 'own', 9, 2026);

INSERT INTO fv.sales (id, store_id, user_id, subtotal, total, total_cost) VALUES
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-00000000bbbb', 330, 330, 110);
INSERT INTO fv.sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal) VALUES
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000a1', 1, 330, 110, 330);

INSERT INTO fv.transfers (id, from_store_id, to_store_id, sent_by, status, kind, totals) VALUES
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000aaaa', 'enviada', 'transferencia',
   '{"pecas":1,"itens":1,"custo_total":110,"venda_total":330}');
INSERT INTO fv.transfer_items (transfer_id, product_id, product_code, product_name, barcode_number, quantity_sent, unit_cost) VALUES
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000000a1', 'FEF09110', 'Colar', 'T-1', 1, 110);

-- Como o PostgREST: papel authenticated + sub do JWT.
CREATE FUNCTION pg_temp.como(uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Lê uma relação; NULL = sem permissão (42501), senão o nº de linhas visíveis.
CREATE FUNCTION pg_temp.linhas(rel text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM %s', rel) INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION pg_temp.como(uuid), pg_temp.linhas(text) TO authenticated;

-- ── 1. Operadora: nenhuma linha com custo ou código, por nenhuma via ─────────
SELECT pg_temp.como('00000000-0000-0000-0000-00000000bbbb');
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  rel text;
BEGIN
  ASSERT NOT fv.is_admin(), 'a operadora não é admin';

  FOREACH rel IN ARRAY ARRAY['fv.products', 'fv.transfer_items', 'fv.transfers', 'fv.sales',
                             'fv.sale_items', 'fv.exchange_items', 'fv.purchases', 'fv.purchase_items']
  LOOP
    ASSERT coalesce(pg_temp.linhas(rel), 0) = 0, 'operadora leu ' || rel;
  END LOOP;

  -- As 16 views: sem SELECT nenhum (antes liam custo de todas as lojas ignorando o RLS).
  FOR rel IN SELECT c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'fv' AND c.relkind = 'v'
  LOOP
    ASSERT pg_temp.linhas(rel) IS NULL, 'operadora ainda lê a view ' || rel;
  END LOOP;

  -- O que o app lê com a sessão dela continua: o próprio perfil e a própria loja.
  ASSERT pg_temp.linhas('fv.users') = 1, 'operadora perdeu o próprio perfil';
  ASSERT pg_temp.linhas('fv.stores') = 1, 'operadora perdeu a própria loja';

  -- TRUNCATE não passa por RLS: não pode existir.
  BEGIN
    EXECUTE 'TRUNCATE fv.sale_items';
    RAISE EXCEPTION 'operadora conseguiu TRUNCATE';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- ── 2. Admin de loja (role admin, store_id B): telas de admin continuam ─────
SELECT pg_temp.como('00000000-0000-0000-0000-00000000cccc');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT fv.is_admin(), 'admin de loja é admin';
  -- Estoque/Produtos (select * em products com a sessão): custo e código.
  ASSERT (SELECT cost_price FROM fv.products WHERE code = 'FEF09110') = 110, 'admin de loja perdeu custo do produto';
  -- Detalhe de cliente/funcionária: sales.total_cost e sale_items.unit_cost.
  ASSERT (SELECT total_cost FROM fv.sales LIMIT 1) = 110, 'admin de loja perdeu custo da venda';
  ASSERT (SELECT unit_cost FROM fv.sale_items LIMIT 1) = 110, 'admin de loja perdeu custo do item';
  -- Ficha da peça: histórico de transferência.
  ASSERT pg_temp.linhas('fv.transfer_items') = 1, 'admin de loja perdeu transfer_items';
END $$;
RESET ROLE;

-- ── 3. Admin global ──────────────────────────────────────────────────────────
SELECT pg_temp.como('00000000-0000-0000-0000-00000000aaaa');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT fv.is_admin(), 'admin global é admin';
  ASSERT (SELECT cost_price FROM fv.products LIMIT 1) = 110, 'admin perdeu custo do produto';
  ASSERT (SELECT (totals->>'custo_total')::numeric FROM fv.transfers LIMIT 1) = 110, 'admin perdeu totals';
  ASSERT pg_temp.linhas('fv.sales') = 1 AND pg_temp.linhas('fv.stores') = 2, 'admin perdeu leituras';
END $$;
RESET ROLE;

-- ── 4. Servidor (service_role, como as server actions): views e tudo mais ────
SET LOCAL ROLE service_role;
DO $$
DECLARE
  rel text;
BEGIN
  FOR rel IN SELECT c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'fv' AND c.relkind = 'v'
  LOOP
    ASSERT pg_temp.linhas(rel) IS NOT NULL, 'service_role perdeu a view ' || rel;
  END LOOP;
  ASSERT (SELECT cost_price FROM fv.v_products_stock LIMIT 1) = 110, 'v_products_stock sem custo para o servidor';
  ASSERT pg_temp.linhas('fv.transfer_items') = 1, 'service_role perdeu transfer_items';
END $$;
RESET ROLE;

ROLLBACK;
