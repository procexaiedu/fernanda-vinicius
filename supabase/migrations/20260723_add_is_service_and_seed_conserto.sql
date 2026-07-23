-- Item de serviço (conserto): produto que NÃO controla estoque.
-- A vendedora adiciona "Conserto" na venda e digita o valor; o estoque é
-- ignorado (pode ficar positivo ou negativo, é irrelevante).

ALTER TABLE fv.products
  ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fv.products.is_service IS
  'true = item de serviço (ex: Conserto). Não controla estoque: a venda não baixa nem repõe quantity_in_stock.';

-- Semeia um item "Conserto" por loja ativa (sem fornecedor — supplier_id é nullable).
-- Preço de custo/venda começam em 0 e são editados na hora da venda.
INSERT INTO fv.products
  (code, name, category, material, store_id, cost_price, sale_price,
   quantity_in_stock, ownership_type, purchase_month, purchase_year, is_service, is_active)
SELECT
  'CONSERTO', 'Conserto', 'conserto', 'servico', s.id, 0, 0,
  0, 'own', extract(month from now())::smallint, extract(year from now())::smallint, true, true
FROM fv.stores s
WHERE s.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM fv.products p WHERE p.store_id = s.id AND p.is_service = true
  );
