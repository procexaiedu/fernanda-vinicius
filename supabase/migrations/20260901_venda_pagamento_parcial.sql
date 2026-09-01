-- ============================================================================
-- Venda com pagamento parcial: a data prometida
-- ============================================================================
--
-- Pedido no treinamento de 31/08. O caso que motivou: venda de R$645, a cliente
-- pagou R$300 no Pix e levou a peça, prometendo o resto em 10 dias.
--
-- NÃO existe coluna de "valor pago" nem status "inadimplente", de propósito.
-- Quem sabe quanto foi pago é `fv.sale_payments` — somar de lá é a única
-- resposta que não pode divergir. Uma coluna espelho em `sales` seria um
-- segundo número contando a mesma coisa, e um dia os dois discordariam.
--
-- O que o banco não tinha como saber é a data combinada de boca no balcão. Só
-- isso entra aqui.
-- ============================================================================

ALTER TABLE fv.sales
  ADD COLUMN IF NOT EXISTS previsao_pagamento date;

COMMENT ON COLUMN fv.sales.previsao_pagamento IS
  'Data em que a cliente prometeu quitar o que faltou. Só para venda com saldo em aberto — o saldo em si sai de sale_payments, nunca daqui.';

-- Índice parcial: a lista de cobrança só olha quem tem data marcada.
CREATE INDEX IF NOT EXISTS idx_sales_previsao_pagamento
  ON fv.sales (previsao_pagamento)
  WHERE previsao_pagamento IS NOT NULL;
