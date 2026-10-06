-- ─────────────────────────────────────────────────────────────────────────────
-- Custo e código fora do alcance de quem não é admin, por QUALQUER via (06/10)
--
-- POR QUÊ: até aqui o custo só era escondido nas TELAS (o servidor zera
-- unit_cost/product_code para a operadora). Mas a sessão da operadora é um JWT
-- `authenticated`, e o PostgREST do fv aceita esse JWT direto. Leitura de
-- produção em 06/10 mostrou que, chamando a API com a sessão dela, dava para ler:
--
--   1. As 16 views do fv (v_products_stock, compra_rateio_loja, despesas_por_loja,
--      v_monthly_pnl, v_consignment_status...). Views de dono `postgres` SEM
--      security_invoker rodam com o dono e IGNORAM o RLS: a operadora lia custo
--      e código de TODAS as lojas, e o financeiro inteiro.
--   2. Pelas políticas "operator"/"operadora": products (cost_price, code),
--      transfer_items (unit_cost, product_code), transfers (totals.custo_total),
--      sales (total_cost), sale_items (unit_cost), exchange_items (unit_cost) da
--      loja dela.
--   3. TRUNCATE, TRIGGER e REFERENCES para authenticated em todas as tabelas (e
--      no default de tabela nova). TRUNCATE não passa por RLS.
--
-- POR QUE ASSIM (e não REVOKE de coluna): as telas de ADMIN leem custo com a
-- sessão da usuária (Estoque, Produtos, detalhe de fornecedor/cliente/funcionária
-- fazem select em products/purchases/sales com o client do navegador). Revogar
-- a coluna de `authenticated` quebraria a admin também, porque o papel no banco
-- é o mesmo. O que separa admin de operadora é o RLS (fv.is_admin()). E a
-- OPERADORA não lê nenhuma tabela de negócio com a sessão dela: conferido no
-- código em 06/10, ela só lê fv.users e fv.stores (perfil); PDV, vendas,
-- consertos e conferência de transferência passam pelo servidor (service_role,
-- que ignora RLS e não é afetado por nada aqui). Então tirar as políticas de
-- leitura dela nessas tabelas não muda tela nenhuma.
--
-- Idempotente: pode rodar de novo sem efeito.
-- Ordem de deploy: pode ir ANTES ou DEPOIS do app (nenhum código depende dela).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. Views: respeitam o RLS de quem consulta, e saem da API do navegador. ─────
--    Nenhuma é lida com a sessão da usuária (só pelo servidor). service_role,
--    postgres e supabase_admin têm BYPASSRLS, então funções e server actions
--    continuam vendo tudo como antes.
do $$
declare
  v record;
begin
  for v in
    select c.oid::regclass as nome
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'fv' and c.relkind = 'v'
  loop
    execute format('alter view %s set (security_invoker = true)', v.nome);
    execute format('revoke all on %s from public, anon, authenticated', v.nome);
    execute format('grant select on %s to service_role', v.nome);
  end loop;
end $$;

-- 2. Políticas que davam à operadora linhas com custo ou código. ──────────────
--    As de admin (fv.is_admin()) ficam. sales_operator_insert fica (inserir não
--    devolve linha; o PDV grava pelo servidor de qualquer forma).
drop policy if exists products_operator_select        on fv.products;
drop policy if exists transfer_items_operadora_select on fv.transfer_items;
drop policy if exists transfers_operadora_select      on fv.transfers;
drop policy if exists sales_operator_select           on fv.sales;
drop policy if exists sale_items_operator             on fv.sale_items;
drop policy if exists exchange_items_operator         on fv.exchange_items;

-- 3. Privilégios que o navegador não precisa. ─────────────────────────────────
revoke truncate, trigger, references on all tables in schema fv from public, anon, authenticated;
alter default privileges for role postgres in schema fv
  revoke truncate, trigger, references on tables from authenticated;

-- 4. Trava: se alguma coisa acima não pegou, nada é gravado. ──────────────────
do $$
declare
  n integer;
begin
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'fv' and c.relkind = 'v'
     and (has_table_privilege('authenticated', c.oid, 'SELECT')
          or not coalesce('security_invoker=true' = any(c.reloptions), false));
  if n > 0 then
    raise exception 'custo_fora_da_api: % view(s) do fv ainda abertas para authenticated', n;
  end if;

  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'fv' and c.relkind = 'r'
     and (has_table_privilege('authenticated', c.oid, 'TRUNCATE')
          or has_table_privilege('authenticated', c.oid, 'TRIGGER')
          or has_table_privilege('authenticated', c.oid, 'REFERENCES'));
  if n > 0 then
    raise exception 'custo_fora_da_api: % tabela(s) do fv com TRUNCATE/TRIGGER/REFERENCES para authenticated', n;
  end if;

  select count(*) into n
    from pg_policies
   where schemaname = 'fv'
     and tablename in ('products', 'transfer_items', 'transfers', 'sales', 'sale_items', 'exchange_items')
     and cmd in ('SELECT', 'ALL')
     and qual not like '%is_admin()%';
  if n > 0 then
    raise exception 'custo_fora_da_api: % política(s) de leitura não-admin em tabela com custo', n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
