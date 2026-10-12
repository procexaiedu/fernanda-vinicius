-- ─────────────────────────────────────────────────────────────────────────────
-- Recria o cron das despesas recorrentes (12/10)
--
-- POR QUÊ: conferido em produção em 12/10/2026 (cron.job, só leitura): NÃO há
-- job do FV. O agendamento ficou no Supabase Cloud e não veio na migração para
-- o self-hosted (24/08). Desde então as recorrentes só nascem pelo "Gerar agora".
--
-- O QUE: todo dia 1º às 03:00 de Brasília (06:00 UTC; o pg_cron roda em GMT)
-- chama fv.generate_monthly_recurring_expenses(), que lança as recorrentes de
-- TODAS as lojas e da rede. Idempotente: tira o job se existir e agenda de novo.
-- A função já não duplica (pula a recorrente que tem lançamento no mês).
--
-- NÃO APLICADA: aplicar no deploy. Rollback:
-- supabase/rollback/20261012c_cron_recorrentes.down.sql
-- ─────────────────────────────────────────────────────────────────────────────

select cron.unschedule(jobid) from cron.job where jobname = 'fv-recorrentes-mensais';

select cron.schedule(
  'fv-recorrentes-mensais',
  '0 6 1 * *',
  $$select fv.generate_monthly_recurring_expenses()$$
);
