-- Voltar app primeiro. Recusa remover referências novas: exportar/decidir destino antes.
begin;
do $$ begin
  if exists(select 1 from fv.sales where seller_person_id is not null)
    or exists(select 1 from fv.transactions where seller_person_id is not null)
    or exists(select 1 from fv.seller_goals where seller_person_id is not null)
  then raise exception 'Rollback recusado: existem referencias a pessoas. Nao converter automaticamente em contas.'; end if;
end $$;
drop trigger sales_check_seller on fv.sales;
drop function fv.check_sale_seller();
do $$ declare src text; begin
  src := pg_get_functiondef('fv.salvar_venda(jsonb)'::regprocedure);
  src := replace(src, 'user_id, seller_id, seller_person_id, sale_date, subtotal,', 'user_id, seller_id, sale_date, subtotal,');
  src := replace(src, 'v_nova.user_id, v_nova.seller_id, v_nova.seller_person_id, v_nova.sale_date,', 'v_nova.user_id, v_nova.seller_id, v_nova.sale_date,');
  execute src;
  src := pg_get_functiondef('fv.editar_venda(jsonb)'::regprocedure);
  execute replace(src, 'seller_id          = v_nova.seller_id, seller_person_id = v_nova.seller_person_id,', 'seller_id          = v_nova.seller_id,');
end $$;
drop policy seller_goals_person_scope on fv.seller_goals;
drop policy seller_goals_person_admin on fv.seller_goals;
alter table fv.seller_goals drop constraint seller_goals_identity;
alter table fv.seller_goals drop column seller_person_id;
alter table fv.seller_goals alter column user_id set not null;
alter table fv.transactions drop column seller_person_id;
alter table fv.sales drop column seller_person_id;
drop table fv.sellers;
drop function fv.seller_store_immutable();
notify pgrst, 'reload schema';
commit;
