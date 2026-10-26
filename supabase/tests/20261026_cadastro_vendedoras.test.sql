\set ON_ERROR_STOP on
-- Rodar APÓS bootstrap + RPC real + migration, somente no container descartável.
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is distinct from true then raise exception 'FAIL: %',msg; end if; raise notice 'PASS: %',msg; end $$;
select pg_temp.ok((select count(*)=0 from fv.sellers),'nenhuma conta convertida em pessoa');
select pg_temp.ok((select seller_person_id is null and seller_id='20000000-0000-0000-0000-000000000001' from fv.sales where id='40000000-0000-0000-0000-000000000001'),'venda legada intacta');
insert into fv.sellers(id,full_name,store_id,is_active) values
 ('60000000-0000-0000-0000-000000000001','Pessoa teste A','10000000-0000-0000-0000-000000000001',true),
 ('60000000-0000-0000-0000-000000000002','Pessoa teste B','10000000-0000-0000-0000-000000000002',true),
 ('60000000-0000-0000-0000-000000000003','Pessoa inativa','10000000-0000-0000-0000-000000000001',false);
do $$ begin
 begin insert into fv.sellers(full_name,store_id) values('  pessoa   TESTE A  ','10000000-0000-0000-0000-000000000001'); raise exception 'duplicidade aceita'; exception when unique_violation then raise notice 'PASS: duplicidade normalizada rejeitada'; end;
 insert into fv.sellers(full_name,store_id) values('Pessoa teste A','10000000-0000-0000-0000-000000000002');
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',false);
select pg_temp.ok((select count(*)=1 from fv.sellers),'operadora le somente ativa da propria loja');
do $$ begin
 begin insert into fv.sellers(full_name,store_id) values('Intrusa','10000000-0000-0000-0000-000000000001'); raise exception 'operadora criou'; exception when insufficient_privilege then raise notice 'PASS: RLS bloqueia cadastro pela operadora'; end;
 update fv.sellers set full_name='Invadida'; if found then raise exception 'operadora editou'; end if;
 begin delete from fv.sellers; raise exception 'delete liberado'; exception when insufficient_privilege then raise notice 'PASS: exclusao proibida'; end;
 begin perform fv.salvar_venda('{}'); raise exception 'RPC publica'; exception when insufficient_privilege then raise notice 'PASS: RPC bloqueada authenticated'; end;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);
select pg_temp.ok((select count(*)=2 from fv.sellers),'admin loja ve ativas e inativas somente locais');
do $$ begin
 begin insert into fv.sellers(full_name,store_id) values('Outra loja','10000000-0000-0000-0000-000000000002'); raise exception 'admin atravessou loja'; exception when insufficient_privilege then raise notice 'PASS: admin nao cadastra em outra loja'; end;
 update fv.sellers set full_name='Pessoa teste A' where id='60000000-0000-0000-0000-000000000001';
 if not found then raise exception 'admin nao edita local'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',false);
select pg_temp.ok((select count(*)=0 from fv.sellers),'conta inativa sem leitura');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false);
select pg_temp.ok((select count(*)=4 from fv.sellers),'admin global ve cadastros das duas lojas');
set role anon;
do $$ begin
 begin perform count(*) from fv.sellers; raise exception 'anon leu'; exception when insufficient_privilege then raise notice 'PASS: anon sem acesso'; end;
end $$;
reset role;
-- Pacote executado pelas RPCs REAIS da migration 20261001, sem mock de estoque/pagamento.
create function pg_temp.pacote(pessoa uuid) returns jsonb language sql as $$ select jsonb_build_object(
 'client_request_id','70000000-0000-0000-0000-000000000001',
 'sale',jsonb_build_object('store_id','10000000-0000-0000-0000-000000000001','user_id','20000000-0000-0000-0000-000000000003','seller_person_id',pessoa,'sale_date','2026-10-26','subtotal',100,'total',100,'total_cost',20,'status','completed'),
 'items',jsonb_build_array(jsonb_build_object('product_id','30000000-0000-0000-0000-000000000001','quantity',1,'unit_price',100,'unit_cost',20,'subtotal',100)),
 'payments',jsonb_build_array(jsonb_build_object('payment_method','cash','amount',100,'installments',1)),
 'transactions',jsonb_build_array(jsonb_build_object('store_id','10000000-0000-0000-0000-000000000001','user_id','20000000-0000-0000-0000-000000000003','type','income','amount',100,'reference_type','sale','status','completed'))
) $$;
do $$ declare p uuid; begin
 foreach p in array array[null::uuid,'60000000-0000-0000-0000-000000000002'::uuid,'60000000-0000-0000-0000-000000000003'::uuid] loop
  begin perform fv.salvar_venda(pg_temp.pacote(p)); raise exception 'BAD_ACCEPT'; exception when others then if sqlerrm='BAD_ACCEPT' then raise; end if; raise notice 'PASS: RPC rejeitou vazia/inativa/outra loja: %',sqlerrm; end;
 end loop;
end $$;
set role service_role;
select fv.salvar_venda(pg_temp.pacote('60000000-0000-0000-0000-000000000001'));
select fv.salvar_venda(pg_temp.pacote('60000000-0000-0000-0000-000000000001'));
reset role;
select pg_temp.ok((select count(*)=1 from fv.sales where seller_person_id is not null),'reenvio idempotente sem venda duplicada');
select pg_temp.ok((select quantity_in_stock=9 from fv.products limit 1),'estoque baixou uma vez');
select pg_temp.ok((select sum(amount)=100 from fv.sale_payments),'pagamento gravado uma vez');
select pg_temp.ok((select seller_id is null and user_id='20000000-0000-0000-0000-000000000003' from fv.sales where seller_person_id is not null),'pessoa separada da autoria');
select pg_temp.ok(fv.salvar_venda(pg_temp.pacote('60000000-0000-0000-0000-000000000002'))->>'erro'='id_reusado','mesmo request com outra pessoa nao reatribui venda');
insert into fv.transactions(store_id, seller_person_id, reference_type, transaction_date, status, amount)
 values('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','seller_commission','2026-10-31','completed',3);
do $$ begin
 begin insert into fv.transactions(store_id, seller_person_id, reference_type, transaction_date, status, amount)
 values('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','seller_commission','2026-10-31','pending',4);
 raise exception 'comissao duplicada'; exception when unique_violation then raise notice 'PASS: indice rejeita comissao duplicada da pessoa'; end;
end $$;
update fv.sellers set is_active=false where id='60000000-0000-0000-0000-000000000001';
select fv.editar_venda(pg_temp.pacote('60000000-0000-0000-0000-000000000001') || jsonb_build_object('sale_id',(select id from fv.sales where seller_person_id is not null)));
select pg_temp.ok((select quantity_in_stock=9 from fv.products limit 1),'edicao inativa conserva estoque');
select pg_temp.ok((select sum(amount)=100 from fv.sale_payments),'edicao conserva pagamentos');
update fv.sales set notes='edicao legada' where id='40000000-0000-0000-0000-000000000001';
select pg_temp.ok((select amount=30 and status='completed' and seller_person_id is null from fv.transactions where id='50000000-0000-0000-0000-000000000001'),'comissao paga legada inalterada');
select pg_temp.ok((select user_id='20000000-0000-0000-0000-000000000003' from fv.sales where seller_person_id is not null),'edicao preserva autoria');
do $$ begin
 begin update fv.sales set seller_person_id=null,seller_id='20000000-0000-0000-0000-000000000003' where seller_person_id is not null;
 raise exception 'instancia antiga apagou pessoa'; exception when others then if sqlerrm='instancia antiga apagou pessoa' then raise; end if; raise notice 'PASS: instancia antiga nao substitui pessoa por login'; end;
end $$;
-- Compatibilidade de deploy: somente a chamada antiga ainda pode lançar uma conta.
begin;
select pg_temp.ok((fv.salvar_venda(pg_temp.pacote(null) || jsonb_build_object(
 'client_request_id','80000000-0000-0000-0000-000000000001',
 'sale',(pg_temp.pacote(null)->'sale') || jsonb_build_object('seller_id','20000000-0000-0000-0000-000000000003')
))->>'sale_id') is not null,'RPC antiga continua operando na fase aditiva');
rollback;
