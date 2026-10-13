-- Motivos da limpeza da lista de disparo (13/10/2026): número de lugar/empresa,
-- de emergência/serviço e cliente sem primeiro nome utilizável no {{1}}.
-- Origem nova `limpeza` = scripts/disparo-carga-exclusoes.mjs --limpeza.
-- Só fv.disparo_exclusoes; fv.customers não é tocada.
--
-- Volta: 20261013b_disparo_exclusoes_limpeza.down.sql

alter table fv.disparo_exclusoes drop constraint if exists disparo_exclusoes_motivo_check;
alter table fv.disparo_exclusoes add constraint disparo_exclusoes_motivo_check
  check (motivo in ('invalido', 'bloqueio', 'opt_out', 'manual', 'lugar', 'emergencia', 'sem_nome_utilizavel'));

alter table fv.disparo_exclusoes drop constraint if exists disparo_exclusoes_origem_check;
alter table fv.disparo_exclusoes add constraint disparo_exclusoes_origem_check
  check (origem in ('webhook', 'resposta', 'manual', 'historico', 'limpeza'));

notify pgrst, 'reload schema';
