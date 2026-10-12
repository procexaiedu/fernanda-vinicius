-- Desfaz 20261012b_recorrente_gera_na_hora.sql. Aplicar DEPOIS de voltar o app
-- (o app novo chama esta função ao criar/reativar recorrente).
-- As contas já lançadas por ela ficam (são contas normais, com recurring_expense_id).
begin;
drop function if exists fv.gerar_ocorrencia_recorrente(uuid);
commit;
notify pgrst, 'reload schema';
