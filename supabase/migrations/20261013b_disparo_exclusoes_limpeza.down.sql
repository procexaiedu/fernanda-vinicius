-- Volta de 20261013b. As exclusões com os motivos/origem novos são APAGADAS
-- (sem elas o check antigo não volta). Isso só mexe na lista de disparo: essas
-- pessoas voltam a poder receber. Rode de novo a 20261013b para restaurar.

delete from fv.disparo_exclusoes
 where motivo in ('lugar', 'emergencia', 'sem_nome_utilizavel', 'fixo_sem_whatsapp', 'estrangeiro') or origem = 'limpeza';

alter table fv.disparo_exclusoes drop constraint if exists disparo_exclusoes_motivo_check;
alter table fv.disparo_exclusoes add constraint disparo_exclusoes_motivo_check
  check (motivo in ('invalido', 'bloqueio', 'opt_out', 'manual'));

alter table fv.disparo_exclusoes drop constraint if exists disparo_exclusoes_origem_check;
alter table fv.disparo_exclusoes add constraint disparo_exclusoes_origem_check
  check (origem in ('webhook', 'resposta', 'manual', 'historico'));

notify pgrst, 'reload schema';
