-- Caixa por TURNO: a vendedora pode fechar o caixa mais de uma vez no mesmo dia.
-- Cada fechamento é um snapshot de conferência de uma janela de tempo, e a visão
-- do PDV zera a partir do último fechamento.

-- 1) Permitir vários fechamentos por loja/dia
alter table fv.cash_closings
  drop constraint if exists cash_closings_store_id_closing_date_key;

-- 2) Início da janela fechada (nulo = desde o começo do dia)
alter table fv.cash_closings
  add column if not exists period_start timestamptz;

comment on column fv.cash_closings.period_start is
  'Início da janela consolidada neste fechamento (created_at do fechamento anterior do dia). NULL = desde o início do dia.';

-- 3) Consulta típica: último fechamento da loja no dia
create index if not exists idx_cash_closings_store_date_created
  on fv.cash_closings (store_id, closing_date, created_at desc);
