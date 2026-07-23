-- Bandeira do cartão nos pagamentos de venda (crédito e débito), opcional.
-- Necessário para conciliação com a Cielo. NULLABLE: pagamentos antigos e
-- métodos sem cartão (dinheiro/pix) ficam com card_brand = NULL.

ALTER TABLE fv.sale_payments
  ADD COLUMN IF NOT EXISTS card_brand text;

COMMENT ON COLUMN fv.sale_payments.card_brand IS
  'Bandeira do cartão (visa, mastercard, elo, amex, hipercard, ...) quando o método é crédito ou débito. NULL para dinheiro/pix ou pagamentos antigos.';
