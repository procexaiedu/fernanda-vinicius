-- Guarda o desconto manual (R$) informado na venda, separado do desconto total.
-- Necessário para editar a venda reconstruindo exatamente os campos (o
-- discount_amount é o total reconciliado com arredondamento e não permite
-- separar quanto foi manual x percentual).
ALTER TABLE fv.sales
  ADD COLUMN IF NOT EXISTS manual_discount numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN fv.sales.manual_discount IS
  'Desconto manual em R$ informado na venda (separado dos descontos percentuais). Usado para reconstruir o formulário na edição.';
