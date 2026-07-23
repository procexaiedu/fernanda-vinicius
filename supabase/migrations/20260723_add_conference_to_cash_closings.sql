-- Conferência da gaveta no fechamento de caixa: dinheiro contado e diferença.
ALTER TABLE fv.cash_closings
  ADD COLUMN IF NOT EXISTS counted_cash    numeric(12,2);
ALTER TABLE fv.cash_closings
  ADD COLUMN IF NOT EXISTS cash_difference numeric(12,2);

COMMENT ON COLUMN fv.cash_closings.counted_cash IS
  'Dinheiro contado na gaveta no fechamento (conferência).';
COMMENT ON COLUMN fv.cash_closings.cash_difference IS
  'Diferença = contado − esperado em dinheiro.';
