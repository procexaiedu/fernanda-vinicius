-- Aplicar antes do app. Não converte users nem atribui vendas antigas a pessoas.
begin;
create table fv.sellers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  store_id uuid not null references fv.stores(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sellers_name_store_unique on fv.sellers
  (store_id, lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')));
alter table fv.sellers enable row level security;
revoke all on fv.sellers from public, anon, authenticated;
grant select, insert, update on fv.sellers to authenticated;
grant all on fv.sellers to service_role;
create policy sellers_read on fv.sellers for select to authenticated using (
  fv.pode_ver_loja(store_id) and exists (
    select 1 from fv.users u where u.id = auth.uid() and u.is_active
      and (u.role = 'admin' or (u.store_id = sellers.store_id and sellers.is_active))
  )
);
create policy sellers_insert on fv.sellers for insert to authenticated with check (
  fv.pode_ver_loja(store_id) and exists (select 1 from fv.users u where u.id = auth.uid() and u.is_active and u.role = 'admin')
);
create policy sellers_update on fv.sellers for update to authenticated using (
  fv.pode_ver_loja(store_id) and exists (select 1 from fv.users u where u.id = auth.uid() and u.is_active and u.role = 'admin')
) with check (
  fv.pode_ver_loja(store_id) and exists (select 1 from fv.users u where u.id = auth.uid() and u.is_active and u.role = 'admin')
);
create function fv.seller_store_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.store_id is distinct from old.store_id then raise exception 'A loja da vendedora nao pode mudar'; end if;
  new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');
  new.updated_at := now();
  return new;
end $$;
create trigger sellers_store_immutable before update on fv.sellers for each row execute function fv.seller_store_immutable();

alter table fv.sales add column seller_person_id uuid references fv.sellers(id);
alter table fv.sales add constraint sales_single_seller check (seller_person_id is null or seller_id is null);
create index sales_person_idx on fv.sales(seller_person_id) where seller_person_id is not null;
alter table fv.transactions add column seller_person_id uuid references fv.sellers(id);
-- Metas individuais antigas continuam ligadas à conta legada. Nenhum backfill.
alter table fv.seller_goals alter column user_id drop not null;
alter table fv.seller_goals add column seller_person_id uuid references fv.sellers(id);
alter table fv.seller_goals add constraint seller_goals_identity check ((user_id is null) <> (seller_person_id is null));
create unique index seller_goals_person_default on fv.seller_goals(seller_person_id) where month is null and seller_person_id is not null;
create unique index seller_goals_person_month on fv.seller_goals(seller_person_id, month) where month is not null and seller_person_id is not null;
-- Política restritiva adicional evita que policies antigas de metas ampliem acesso.
create policy seller_goals_person_scope on fv.seller_goals as restrictive for all to authenticated using (
  seller_person_id is null or exists (select 1 from fv.sellers s where s.id = seller_person_id and fv.pode_ver_loja(s.store_id))
) with check (
  seller_person_id is null or exists (select 1 from fv.sellers s where s.id = seller_person_id and fv.pode_ver_loja(s.store_id))
);
create policy seller_goals_person_admin on fv.seller_goals for all to authenticated using (
  seller_person_id is not null and exists (select 1 from fv.users u where u.id = auth.uid() and u.is_active and u.role = 'admin')
  and exists (select 1 from fv.sellers s where s.id = seller_person_id and fv.pode_ver_loja(s.store_id))
) with check (
  seller_person_id is not null and exists (select 1 from fv.users u where u.id = auth.uid() and u.is_active and u.role = 'admin')
  and exists (select 1 from fv.sellers s where s.id = seller_person_id and fv.pode_ver_loja(s.store_id))
);

-- A edição pode conservar pessoa inativa ou vínculo legado. Nova atribuição exige pessoa ativa da loja.
create function fv.check_sale_seller() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.seller_person_id is not distinct from old.seller_person_id
      and new.seller_id is not distinct from old.seller_id and new.store_id = old.store_id then return new; end if;
  end if;
  if new.seller_person_id is null or new.seller_id is not null then raise exception 'Escolha uma vendedora cadastrada'; end if;
  perform 1 from fv.sellers s where s.id = new.seller_person_id and s.store_id = new.store_id and s.is_active for share;
  if not found then raise exception 'Vendedora invalida, inativa ou de outra loja'; end if;
  return new;
end $$;
create trigger sales_check_seller before insert or update on fv.sales for each row execute function fv.check_sale_seller();

-- Preserva o corpo atual das RPCs (incluindo crédito de troca e idempotência).
-- Aborta se a assinatura/trecho esperado mudou, em vez de instalar algo parcial.
do $$ declare src text; atualizado text; begin
  src := pg_get_functiondef('fv.salvar_venda(jsonb)'::regprocedure);
  atualizado := replace(src, 'user_id, seller_id, sale_date, subtotal,', 'user_id, seller_id, seller_person_id, sale_date, subtotal,');
  atualizado := replace(atualizado, 'v_nova.user_id, v_nova.seller_id, v_nova.sale_date,', 'v_nova.user_id, v_nova.seller_id, v_nova.seller_person_id, v_nova.sale_date,');
  atualizado := replace(atualizado, 'OR v_existente.customer_id IS DISTINCT FROM v_nova.customer_id', 'OR v_existente.seller_person_id IS DISTINCT FROM v_nova.seller_person_id OR v_existente.seller_id IS DISTINCT FROM v_nova.seller_id OR v_existente.customer_id IS DISTINCT FROM v_nova.customer_id');
  if atualizado = src or position('seller_person_id, sale_date' in atualizado) = 0 then raise exception 'RPC salvar_venda divergente'; end if;
  execute atualizado;
  src := pg_get_functiondef('fv.editar_venda(jsonb)'::regprocedure);
  atualizado := replace(src, 'seller_id          = v_nova.seller_id,', 'seller_id          = v_nova.seller_id, seller_person_id = v_nova.seller_person_id,');
  if atualizado = src then raise exception 'RPC editar_venda divergente'; end if;
  execute atualizado;
end $$;
revoke all on function fv.check_sale_seller(), fv.seller_store_immutable() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
