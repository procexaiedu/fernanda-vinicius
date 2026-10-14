-- ============================================================================
-- Conserto: quando a peça voltou pronta e se a cliente já foi avisada.
--
-- Pedido da Eleandra (13/10): ver o tempo médio de conserto e não esquecer de
-- ligar para a cliente quando a peça volta do ourives.
--
-- `pronto_em` é a data em que a peça voltou pronta. Até hoje só o "entregue"
-- tinha data, então "quanto tempo o ourives leva" não tinha como ser medido.
-- Consertos antigos ficam com NULL: não inventamos uma data que ninguém anotou.
--
-- `cliente_avisada_em` é o "Avisei a cliente". Nulo com status 'pronto' é a
-- peça esperando uma ligação.
-- ============================================================================

ALTER TABLE fv.consertos ADD COLUMN IF NOT EXISTS pronto_em date;
ALTER TABLE fv.consertos ADD COLUMN IF NOT EXISTS cliente_avisada_em timestamptz;

COMMENT ON COLUMN fv.consertos.pronto_em IS
  'Dia em que a peça voltou pronta do ourives. Base do tempo médio recebido → pronto.';
COMMENT ON COLUMN fv.consertos.cliente_avisada_em IS
  'Quando a loja avisou a cliente que a peça está pronta. Nulo + status pronto = falta ligar.';
