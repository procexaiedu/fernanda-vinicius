-- Adiciona vínculo de fornecedor em purchase_payments.
-- Contexto: na tela de compra os pagamentos são organizados por fornecedor
-- (cada fornecedor com seu subtotal/pagamentos), mas esse vínculo não era
-- persistido. Sem ele, a edição de compra não consegue mostrar de qual
-- fornecedor é cada pagamento nem recalcular o valor por fornecedor.
--
-- Coluna NULLABLE: compras antigas ficam com supplier_id = NULL até serem
-- reeditadas/resalvas. Novos pagamentos passam a gravar o fornecedor.

ALTER TABLE fv.purchase_payments
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES fv.suppliers(id);

COMMENT ON COLUMN fv.purchase_payments.supplier_id IS
  'Fornecedor ao qual este pagamento se refere. NULL em compras anteriores à introdução da coluna.';

-- Índice para consultas/agrupamentos por fornecedor dentro de uma compra.
CREATE INDEX IF NOT EXISTS idx_purchase_payments_supplier
  ON fv.purchase_payments (supplier_id);
