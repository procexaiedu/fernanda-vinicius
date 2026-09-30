-- ─────────────────────────────────────────────────────────────────────────────
-- Fecha o acesso do papel `anon` (e do navegador em geral) ao schema fv (01/10)
--
-- POR QUÊ: a chave anon é pública — vai no bundle do navegador. O schema fv
-- está exposto no PostgREST, e o dump de 30/09 mostrou:
--
--   1. ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES/FUNCTIONS/SEQUENCES TO anon:
--      toda tabela e função nova nascia aberta para anon.
--   2. fv.consertos e fv.consignment_acertos SEM RLS: com a chave anon dava para
--      ler, alterar e apagar consertos de clientes e acertos de consignação.
--   3. Funções SECURITY DEFINER executáveis por anon e authenticated — ex.:
--      baixar_estoque, enviar_transferencia, close_inventory_session (mexem em
--      estoque de qualquer loja, recebendo p_user_id como parâmetro) e
--      get_user_emails (lista o e-mail de todas as usuárias).
--
-- O app NÃO usa anon para nada no fv (o login é pela API de Auth) e chama TODAS
-- as RPCs e as duas tabelas acima pelo client admin (service_role, que ignora
-- RLS) nas server actions — conferido no código em 01/10. Por isso nada disto
-- muda o comportamento do sistema; só fecha a porta de quem chamar o PostgREST
-- direto.
--
-- Mantido de propósito para `authenticated`: SELECT/INSERT/UPDATE/DELETE nas
-- tabelas (continuam protegidas pelas políticas RLS) e EXECUTE nas funções de
-- apoio das políticas (get_user_role, get_user_store_id, is_admin) — sem elas
-- as políticas quebram para as leituras feitas com a sessão da usuária.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 2. As duas tabelas sem RLS. Sem política nenhuma: só service_role acessa.
alter table fv.consertos           enable row level security;
alter table fv.consignment_acertos enable row level security;

-- Tudo que já existe: anon fora do schema.
revoke all on all tables    in schema fv from anon;
revoke all on all sequences in schema fv from anon;
revoke all on all functions in schema fv from anon;

-- 3. RPCs de escrita/administração: só o servidor (service_role).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'fv'
       and p.prokind = 'f'
       and p.proname not in ('get_user_role', 'get_user_store_id', 'is_admin')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $$;

-- 1. O que nascer daqui para frente não herda mais acesso anon, nem EXECUTE
--    para authenticated (função nova é chamada pelo servidor; se alguma um dia
--    precisar ser chamada com a sessão da usuária, o GRANT vai explícito).
alter default privileges for role postgres in schema fv revoke all on tables    from anon;
alter default privileges for role postgres in schema fv revoke all on sequences from anon;
alter default privileges for role postgres in schema fv revoke all on functions from anon;
alter default privileges for role postgres in schema fv revoke execute on functions from authenticated;

commit;

notify pgrst, 'reload schema';
