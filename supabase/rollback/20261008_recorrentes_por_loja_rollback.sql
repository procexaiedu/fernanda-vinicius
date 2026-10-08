-- ROLLBACK de 20261008_recorrentes_por_loja.sql.
-- ATENÇÃO: o app desta versão chama fv.gerar_recorrentes_da_loja. Volte o app
-- (deploy do commit anterior) ANTES de remover a função, senão o botão
-- "Gerar recorrentes" passa a dar erro.
begin;
drop function if exists fv.gerar_recorrentes_da_loja(uuid, boolean);
commit;
notify pgrst, 'reload schema';
