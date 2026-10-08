-- Dados mínimos para os testes que rodam "contra dados reais" e procuram lojas e
-- peças existentes (20261001_venda_transacional, 20261001_transferencia_conferencia).
-- SÓ no banco local `fv_seed` (cópia do schema). Os outros testes contam linhas e
-- precisam do banco VAZIO, por isso os dois bancos (ver rodar_testes.sh).
INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-00000000f001', 'Seed A', 'A', 'SP'),
  ('00000000-0000-0000-0000-00000000f002', 'Seed B', 'B', 'DF');
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000f0a1');
INSERT INTO fv.users (id, full_name, role, store_id) VALUES
  ('00000000-0000-0000-0000-00000000f0a1', 'Seed', 'admin', NULL);
INSERT INTO fv.suppliers (id, name, initials, phones) VALUES
  ('00000000-0000-0000-0000-00000000f051', 'Seed', 'SEE', '[]');
INSERT INTO fv.products (supplier_id, code, name, category, material, store_id, cost_price, sale_price,
                         quantity_in_stock, barcode_number, is_active, ownership_type, purchase_month, purchase_year)
SELECT '00000000-0000-0000-0000-00000000f051', 'SEE' || g, 'Seed ' || g, 'anel', 'ouro',
       CASE WHEN g <= 4 THEN '00000000-0000-0000-0000-00000000f001'::uuid ELSE '00000000-0000-0000-0000-00000000f002'::uuid END,
       10, 30, 10, 'SEED-' || g, true, 'own', 10, 2026
  FROM generate_series(1, 6) g;
