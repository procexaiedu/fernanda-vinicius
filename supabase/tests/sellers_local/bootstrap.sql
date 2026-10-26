-- Base mínima REPRESENTATIVA para PostgreSQL descartável, sem dados/DDL de produção.
-- Permite executar as RPCs reais do repositório, não substitui ensaio no schema completo.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create schema fv;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, fv to anon, authenticated, service_role;
create table fv.stores(id uuid primary key, name text, is_active boolean default true);
create table fv.users(id uuid primary key, full_name text, role text, store_id uuid references fv.stores, is_active boolean default true);
create function fv.pode_ver_loja(p_loja uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from fv.users where id=auth.uid() and is_active and ((role='admin' and store_id is null) or store_id=p_loja)) $$;
create table fv.sales(id uuid primary key default gen_random_uuid(), store_id uuid references fv.stores, customer_id uuid,
 user_id uuid references fv.users, seller_id uuid references fv.users, sale_date timestamptz, subtotal numeric,
 discount_type text, discount_pct numeric, discount_amount numeric, manual_discount numeric,
 total numeric, total_cost numeric, previsao_pagamento date, destinatario_cpf text, payment_summary text,
 status text, notes text, client_request_id uuid unique, updated_at timestamptz default now());
create table fv.seller_goals(id uuid primary key default gen_random_uuid(), user_id uuid not null references fv.users, month date, target_amount numeric, commission_pct numeric);
alter table fv.seller_goals enable row level security;
create table fv.products(id uuid primary key, quantity_in_stock integer, is_service boolean default false, last_sale_date timestamptz, is_active boolean default true, updated_at timestamptz);
create table fv.sale_items(id uuid primary key default gen_random_uuid(), sale_id uuid references fv.sales, product_id uuid references fv.products, quantity integer, unit_price numeric, unit_cost numeric, subtotal numeric);
create table fv.sale_payments(id uuid primary key default gen_random_uuid(), sale_id uuid references fv.sales, payment_method text, amount numeric, installments integer, card_brand text);
create table fv.transactions(id uuid primary key default gen_random_uuid(), store_id uuid references fv.stores, type text, amount numeric, category text, description text,
 reference_type text, reference_id uuid, user_id uuid references fv.users, payment_method text, transaction_date timestamptz, status text, paid_at timestamptz);
create table fv.consertos(id uuid primary key default gen_random_uuid(), store_id uuid, customer_id uuid, peca text, recebido_em date, status text, entregue_em date, sale_item_id uuid references fv.sale_items on delete set null, user_id uuid, updated_at timestamptz);
create table fv.exchanges(id uuid primary key default gen_random_uuid(), sale_id uuid references fv.sales, original_sale_id uuid, store_id uuid, customer_id uuid, user_id uuid, exchange_date date, reason text, price_difference numeric, payment_method text);
create table fv.exchange_items(id uuid primary key default gen_random_uuid(), exchange_id uuid references fv.exchanges, direction text, product_id uuid, quantity integer, unit_price numeric, unit_cost numeric);
create table fv.stock_movements(id uuid primary key default gen_random_uuid(), product_id uuid, quantity_before integer, delta integer, quantity_after integer, reason text, ref_type text, ref_id uuid, user_id uuid, notes text);
grant select on fv.users, fv.stores to authenticated;
grant all on all tables in schema fv to service_role;
grant select, insert, update, delete on fv.seller_goals to authenticated;
insert into fv.stores values('10000000-0000-0000-0000-000000000001','Loja A',true),('10000000-0000-0000-0000-000000000002','Loja B',true);
insert into fv.users values
 ('20000000-0000-0000-0000-000000000001','Admin teste','admin',null,true),
 ('20000000-0000-0000-0000-000000000002','Admin A','admin','10000000-0000-0000-0000-000000000001',true),
 ('20000000-0000-0000-0000-000000000003','PDV teste','operator','10000000-0000-0000-0000-000000000001',true),
 ('20000000-0000-0000-0000-000000000004','Conta inativa','admin',null,false);
insert into fv.products(id,quantity_in_stock) values('30000000-0000-0000-0000-000000000001',10);
insert into fv.sales(id,store_id,user_id,seller_id,total,status) values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',75,'completed');
insert into fv.transactions(id,store_id,user_id,amount,status,reference_type) values('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',30,'completed','seller_commission');
