-- Desfaz 20261012c_cron_recorrentes.sql: tira o agendamento.
select cron.unschedule(jobid) from cron.job where jobname = 'fv-recorrentes-mensais';
