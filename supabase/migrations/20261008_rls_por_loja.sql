-- ─────────────────────────────────────────────────────────────────────────────
-- RLS por loja: Campinas e Brasília são DOIS SISTEMAS no banco também (08/10)
--
-- POR QUÊ: o escopo de loja foi fechado no servidor (src/lib/escopo.ts, commit
-- b9064a9), mas as políticas do fv usavam `fv.is_admin()`, que é TRUE para a
-- admin de loja também. Com a sessão dela (JWT `authenticated` + anon key) dava
-- para ler a outra loja direto pelo PostgREST, do console do navegador:
-- vendas, produtos com custo, financeiro, clientes, compras, romaneios. E a
-- política `customers_operator_select` (NOT is_admin()) deixava a OPERADORA
-- ler CPF e endereço de cliente das DUAS lojas.
--
-- REGRA (a mesma de lojaDoEscopo): quem tem `store_id` está preso a ela, admin
-- ou não. Admin global (role admin, store_id NULL) vê as duas lojas; a loja
-- escolhida no login é cookie, o banco não a conhece, então quem filtra a loja
-- da sessão do admin global continua sendo a tela.
--
--   admin global   → tudo (as duas lojas + o que é da rede, store_id NULL)
--   admin de loja  → só linhas da loja dele; o que é da rede (NULL) não
--   operadora      → o que já tinha, sem mudança, exceto clientes (só da loja)
--
-- O QUE NÃO MUDA:
--   * service_role e as RPCs (todas SECURITY DEFINER ou chamadas pelo servidor
--     com service_role, que tem BYPASSRLS). Nenhuma RPC do fv é executável por
--     authenticated (conferido em 08/10). PDV, transferência, remessa,
--     conferência, romaneio e compra passam pelo servidor: não são afetados.
--   * custo fora da API (20261006): toda política de leitura em tabela com
--     custo continua exigindo `fv.is_admin()` no texto, e a trava do fim confere.
--   * fornecedores (`suppliers`) seguem da REDE: qualquer admin lê.
--   * lojas (`stores`): qualquer admin LÊ as duas (nome do destino do romaneio,
--     embeds `from_store`/`to_store` no detalhe da peça); só o global escreve.
--
-- Leitura de loja derivada por join (linha sem store_id própria):
--   sale_items / sale_payments → sales.store_id
--   exchange_items             → exchanges.store_id
--   transfer_items             → transfers (origem OU destino)
--   purchase_items             → products.store_id da peça
--   purchases / purchase_payments → a compra é da loja se tiver peça dela
--                                    (compra mista aparece para as duas; editar
--                                    mista só o global, regra de 08/10)
--   stock_movements            → products.store_id
--   inventory_scans            → inventory_sessions.store_id
--   disparo_destinatarios      → disparos.store_id
--   seller_goals               → users.store_id da vendedora
--
-- Idempotente. Rollback: supabase/rollback/20261008_rls_por_loja_rollback.sql
-- Teste: supabase/tests/20261008_rls_por_loja.test.sql
-- Ordem de deploy: independe do app (o app lê com service_role). Aplicar com
-- a loja fechada; depois `notify pgrst, 'reload schema'` (já vai no fim).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. Helpers ──────────────────────────────────────────────────────────────────
--    SECURITY DEFINER para ler fv.users sem cair no RLS de users (evita
--    recursão e mantém o custo em 1 consulta por requisição: nas políticas eles
--    vão dentro de `(select ...)`, que o planner avalia uma vez só).

create or replace function fv.loja_do_usuario()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select u.store_id from fv.users u where u.id = auth.uid() and u.is_active = true
$$;

create or replace function fv.e_admin_global()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from fv.users u
     where u.id = auth.uid() and u.role = 'admin' and u.is_active = true and u.store_id is null
  )
$$;

-- Ativo e (admin global OU a loja dele é p_loja). Loja NULL = da rede = só global.
create or replace function fv.pode_ver_loja(p_loja uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select fv.e_admin_global()
      or (p_loja is not null and p_loja = fv.loja_do_usuario())
$$;

create or replace function fv.loja_da_venda(p_sale_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select s.store_id from fv.sales s where s.id = p_sale_id $$;

create or replace function fv.loja_da_troca(p_exchange_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select e.store_id from fv.exchanges e where e.id = p_exchange_id $$;

create or replace function fv.loja_do_produto(p_product_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select p.store_id from fv.products p where p.id = p_product_id $$;

create or replace function fv.loja_do_disparo(p_disparo_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select d.store_id from fv.disparos d where d.id = p_disparo_id $$;

create or replace function fv.loja_da_conferencia(p_session_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select s.store_id from fv.inventory_sessions s where s.id = p_session_id $$;

create or replace function fv.loja_da_pessoa(p_user_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select u.store_id from fv.users u where u.id = p_user_id $$;

-- Romaneio: visível se a origem OU o destino for a loja de quem pergunta.
create or replace function fv.ve_transferencia(p_transfer_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from fv.transfers t
     where t.id = p_transfer_id
       and (fv.pode_ver_loja(t.from_store_id) or fv.pode_ver_loja(t.to_store_id))
  )
$$;

-- Compra: a loja vê se a compra é dela (store_id) ou tem peça dela (mista).
create or replace function fv.ve_compra(p_purchase_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select fv.e_admin_global()
      or exists (select 1 from fv.purchases c
                  where c.id = p_purchase_id and c.store_id is not null
                    and c.store_id = fv.loja_do_usuario())
      or exists (select 1 from fv.purchase_items i
                   join fv.products p on p.id = i.product_id
                  where i.purchase_id = p_purchase_id
                    and p.store_id = fv.loja_do_usuario())
$$;

-- Compra que a loja pode MUDAR: global, ou só peças dela (mista = só global).
create or replace function fv.edita_compra(p_purchase_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select fv.e_admin_global()
      or (
        fv.loja_do_usuario() is not null
        and not exists (select 1 from fv.purchase_items i
                          join fv.products p on p.id = i.product_id
                         where i.purchase_id = p_purchase_id
                           and p.store_id is distinct from fv.loja_do_usuario())
        and (
          exists (select 1 from fv.purchases c
                   where c.id = p_purchase_id and c.store_id = fv.loja_do_usuario())
          or exists (select 1 from fv.purchase_items i where i.purchase_id = p_purchase_id)
        )
      )
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'fv.loja_do_usuario()', 'fv.e_admin_global()', 'fv.pode_ver_loja(uuid)',
    'fv.loja_da_venda(uuid)', 'fv.loja_da_troca(uuid)', 'fv.loja_do_produto(uuid)',
    'fv.loja_do_disparo(uuid)', 'fv.loja_da_conferencia(uuid)', 'fv.loja_da_pessoa(uuid)',
    'fv.ve_transferencia(uuid)', 'fv.ve_compra(uuid)', 'fv.edita_compra(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- 2. Políticas ────────────────────────────────────────────────────────────────
--    Padrão das de admin:  (select fv.is_admin()) and <loja visível>
--    `is_admin()` fica no texto de propósito: é o que a trava de custo
--    (20261006) procura, e o que tira a operadora das tabelas com custo.

-- cash_closings
drop policy if exists cash_closings_admin_all  on fv.cash_closings;
drop policy if exists cash_closings_admin_loja on fv.cash_closings;
create policy cash_closings_admin_loja on fv.cash_closings for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

-- consignments
drop policy if exists consignments_admin_all  on fv.consignments;
drop policy if exists consignments_admin_loja on fv.consignments;
create policy consignments_admin_loja on fv.consignments for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

-- customers (cliente é da loja desde 04/09)
drop policy if exists customers_admin_all       on fv.customers;
drop policy if exists customers_admin_loja      on fv.customers;
drop policy if exists customers_operator_select on fv.customers;
create policy customers_admin_loja on fv.customers for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(origin_store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(origin_store_id));
create policy customers_operator_select on fv.customers for select to authenticated
  using ((not (select fv.is_admin())) and origin_store_id = (select fv.loja_do_usuario()));
-- (loja_do_usuario exige usuária ativa; get_user_store_id não exigia, e a
--  versão antiga, NOT is_admin(), deixava até usuária inativa ler as duas lojas.)
-- customers_operator_insert / _update já exigem origin_store_id = loja dela: ficam.

-- disparos / disparo_destinatarios
drop policy if exists disparos_admin_all  on fv.disparos;
drop policy if exists disparos_admin_loja on fv.disparos;
create policy disparos_admin_loja on fv.disparos for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

drop policy if exists disp_dest_admin_all  on fv.disparo_destinatarios;
drop policy if exists disp_dest_admin_loja on fv.disparo_destinatarios;
create policy disp_dest_admin_loja on fv.disparo_destinatarios for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_do_disparo(disparo_id)))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_do_disparo(disparo_id)));

-- exchanges / exchange_items
drop policy if exists exchanges_admin_all  on fv.exchanges;
drop policy if exists exchanges_admin_loja on fv.exchanges;
create policy exchanges_admin_loja on fv.exchanges for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

drop policy if exists exchange_items_admin_all  on fv.exchange_items;
drop policy if exists exchange_items_admin_loja on fv.exchange_items;
create policy exchange_items_admin_loja on fv.exchange_items for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_troca(exchange_id)))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_troca(exchange_id)));

-- fiscal_emitentes
drop policy if exists fiscal_emitentes_admin      on fv.fiscal_emitentes;
drop policy if exists fiscal_emitentes_admin_loja on fv.fiscal_emitentes;
create policy fiscal_emitentes_admin_loja on fv.fiscal_emitentes for select to authenticated
  using ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

-- inventory_sessions / inventory_scans (era: role = 'admin' OU loja dela)
drop policy if exists inventory_sessions_leitura on fv.inventory_sessions;
create policy inventory_sessions_leitura on fv.inventory_sessions for select to authenticated
  using (fv.pode_ver_loja(store_id));

drop policy if exists inventory_scans_leitura on fv.inventory_scans;
create policy inventory_scans_leitura on fv.inventory_scans for select to authenticated
  using (fv.pode_ver_loja(fv.loja_da_conferencia(session_id)));

-- products
drop policy if exists products_admin_all  on fv.products;
drop policy if exists products_admin_loja on fv.products;
create policy products_admin_loja on fv.products for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

-- purchases / purchase_items / purchase_payments
drop policy if exists purchases_admin_all     on fv.purchases;
drop policy if exists purchases_admin_select  on fv.purchases;
drop policy if exists purchases_admin_insert  on fv.purchases;
drop policy if exists purchases_admin_update  on fv.purchases;
drop policy if exists purchases_admin_delete  on fv.purchases;
create policy purchases_admin_select on fv.purchases for select to authenticated
  using ((select fv.is_admin()) and fv.ve_compra(id));
create policy purchases_admin_insert on fv.purchases for insert to authenticated
  with check ((select fv.is_admin()) and ((select fv.e_admin_global())
              or (store_id is not null and store_id = (select fv.loja_do_usuario()))));
create policy purchases_admin_update on fv.purchases for update to authenticated
  using      ((select fv.is_admin()) and fv.edita_compra(id))
  with check ((select fv.is_admin()) and fv.edita_compra(id)
              and ((select fv.e_admin_global()) or store_id is null
                   or store_id = (select fv.loja_do_usuario())));
create policy purchases_admin_delete on fv.purchases for delete to authenticated
  using ((select fv.is_admin()) and fv.edita_compra(id));

drop policy if exists purchase_items_admin_all  on fv.purchase_items;
drop policy if exists purchase_items_admin_loja on fv.purchase_items;
create policy purchase_items_admin_loja on fv.purchase_items for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_do_produto(product_id)))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_do_produto(product_id)));

drop policy if exists purchase_payments_admin_all    on fv.purchase_payments;
drop policy if exists purchase_payments_admin_select on fv.purchase_payments;
drop policy if exists purchase_payments_admin_write  on fv.purchase_payments;
drop policy if exists purchase_payments_admin_update on fv.purchase_payments;
drop policy if exists purchase_payments_admin_delete on fv.purchase_payments;
create policy purchase_payments_admin_select on fv.purchase_payments for select to authenticated
  using ((select fv.is_admin()) and fv.ve_compra(purchase_id));
create policy purchase_payments_admin_write on fv.purchase_payments for insert to authenticated
  with check ((select fv.is_admin()) and fv.edita_compra(purchase_id));
create policy purchase_payments_admin_update on fv.purchase_payments for update to authenticated
  using      ((select fv.is_admin()) and fv.edita_compra(purchase_id))
  with check ((select fv.is_admin()) and fv.edita_compra(purchase_id));
create policy purchase_payments_admin_delete on fv.purchase_payments for delete to authenticated
  using ((select fv.is_admin()) and fv.edita_compra(purchase_id));

-- recurring_expenses / transactions (store_id NULL = rede = só o global)
drop policy if exists recurring_expenses_admin_all  on fv.recurring_expenses;
drop policy if exists recurring_expenses_admin_loja on fv.recurring_expenses;
create policy recurring_expenses_admin_loja on fv.recurring_expenses for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

drop policy if exists transactions_admin_all  on fv.transactions;
drop policy if exists transactions_admin_loja on fv.transactions;
create policy transactions_admin_loja on fv.transactions for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

-- sales / sale_items / sale_payments
drop policy if exists sales_admin_all  on fv.sales;
drop policy if exists sales_admin_loja on fv.sales;
create policy sales_admin_loja on fv.sales for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

drop policy if exists sale_items_admin_all  on fv.sale_items;
drop policy if exists sale_items_admin_loja on fv.sale_items;
create policy sale_items_admin_loja on fv.sale_items for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_venda(sale_id)))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_venda(sale_id)));

drop policy if exists sale_payments_admin_all  on fv.sale_payments;
drop policy if exists sale_payments_admin_loja on fv.sale_payments;
create policy sale_payments_admin_loja on fv.sale_payments for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_venda(sale_id)))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_venda(sale_id)));

-- seller_goals (meta é da vendedora; a loja é a dela)
drop policy if exists seller_goals_admin_all  on fv.seller_goals;
drop policy if exists seller_goals_admin_loja on fv.seller_goals;
create policy seller_goals_admin_loja on fv.seller_goals for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_pessoa(user_id)))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(fv.loja_da_pessoa(user_id)));

-- settings (configuração da REDE: admin lê, só o global grava)
drop policy if exists settings_admin_all    on fv.settings;
drop policy if exists settings_admin_select on fv.settings;
drop policy if exists settings_global_write on fv.settings;
create policy settings_admin_select on fv.settings for select to authenticated
  using ((select fv.is_admin()));
create policy settings_global_write on fv.settings for all to authenticated
  using ((select fv.is_admin()) and (select fv.e_admin_global()))
  with check ((select fv.is_admin()) and (select fv.e_admin_global()));

-- stock_movements (era: role = 'admin' OU loja da peça)
drop policy if exists stock_movements_leitura on fv.stock_movements;
create policy stock_movements_leitura on fv.stock_movements for select to authenticated
  using (fv.pode_ver_loja(fv.loja_do_produto(product_id)));

-- stock_transfers (modelo antigo, mantido por histórico)
drop policy if exists stock_transfers_admin_all  on fv.stock_transfers;
drop policy if exists stock_transfers_admin_loja on fv.stock_transfers;
create policy stock_transfers_admin_loja on fv.stock_transfers for all to authenticated
  using      ((select fv.is_admin()) and (fv.pode_ver_loja(from_store_id) or fv.pode_ver_loja(to_store_id)))
  with check ((select fv.is_admin()) and (fv.pode_ver_loja(from_store_id) or fv.pode_ver_loja(to_store_id)));

-- stores (lê: qualquer admin, as duas; grava: só o global)
drop policy if exists stores_admin_all    on fv.stores;
drop policy if exists stores_admin_select on fv.stores;
drop policy if exists stores_global_write on fv.stores;
create policy stores_admin_select on fv.stores for select to authenticated
  using ((select fv.is_admin()));
create policy stores_global_write on fv.stores for all to authenticated
  using ((select fv.is_admin()) and (select fv.e_admin_global()))
  with check ((select fv.is_admin()) and (select fv.e_admin_global()));

-- transfers / transfer_items (origem OU destino)
drop policy if exists transfers_admin_select on fv.transfers;
create policy transfers_admin_select on fv.transfers for select to authenticated
  using ((select fv.is_admin()) and (fv.pode_ver_loja(from_store_id) or fv.pode_ver_loja(to_store_id)));

drop policy if exists transfer_items_admin_select on fv.transfer_items;
create policy transfer_items_admin_select on fv.transfer_items for select to authenticated
  using ((select fv.is_admin()) and fv.ve_transferencia(transfer_id));

-- users (global: todos; admin de loja: as da loja dele; todo mundo: a si mesmo)
drop policy if exists users_admin_all    on fv.users;
drop policy if exists users_admin_global on fv.users;
drop policy if exists users_admin_loja   on fv.users;
create policy users_admin_global on fv.users for all to authenticated
  using ((select fv.is_admin()) and (select fv.e_admin_global()))
  with check ((select fv.is_admin()) and (select fv.e_admin_global()));
create policy users_admin_loja on fv.users for all to authenticated
  using      ((select fv.is_admin()) and store_id is not null and store_id = (select fv.loja_do_usuario()))
  with check ((select fv.is_admin()) and store_id is not null and store_id = (select fv.loja_do_usuario()));
-- O admin de loja LÊ o cadastro das admins globais (a dona): é quem envia a
-- maioria dos romaneios, e a ficha da peça mostra o remetente por embed
-- (users!sent_by). Sem isto o nome viraria "—". Só leitura.
drop policy if exists users_admin_le_globais on fv.users;
create policy users_admin_le_globais on fv.users for select to authenticated
  using ((select fv.is_admin()) and store_id is null and role = 'admin');
-- users_operator_self (id = auth.uid()) fica: é o que o login lê.

-- 3. Trava: nenhuma política de admin sobrou sem corte de loja. ───────────────
--    Exceções conscientes: suppliers (rede), as LEITURAS de settings/stores e
--    a leitura do cadastro das admins globais.
do $$
declare
  n integer;
  lista text;
begin
  select count(*), string_agg(tablename || '.' || policyname, ', ')
    into n, lista
    from pg_policies
   where schemaname = 'fv'
     and qual ~ 'is_admin\(\)'
     and qual !~ '(pode_ver_loja|e_admin_global|ve_compra|edita_compra|ve_transferencia|loja_do_usuario)'
     and qual !~ '^\(*NOT '   -- políticas da operadora: "não é admin e ..."
     and (tablename, policyname) not in (
       ('suppliers', 'suppliers_admin_write'), ('suppliers', 'suppliers_select'),
       ('settings', 'settings_admin_select'), ('stores', 'stores_admin_select'),
       ('users', 'users_admin_le_globais'));
  if n > 0 then
    raise exception 'rls_por_loja: % política(s) de admin sem corte de loja: %', n, lista;
  end if;

  -- Custo fora da API (20261006) continua valendo.
  select count(*) into n
    from pg_policies
   where schemaname = 'fv'
     and tablename in ('products', 'transfer_items', 'transfers', 'sales', 'sale_items', 'exchange_items')
     and cmd in ('SELECT', 'ALL')
     and qual not like '%is_admin()%';
  if n > 0 then
    raise exception 'rls_por_loja: % política(s) de leitura não-admin em tabela com custo', n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
