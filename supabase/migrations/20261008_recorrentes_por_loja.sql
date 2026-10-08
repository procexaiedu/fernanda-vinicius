-- ─────────────────────────────────────────────────────────────────────────────
-- Contas recorrentes geradas POR LOJA (08/10)
--
-- POR QUÊ: o botão "Gerar recorrentes do mês" (gerarRecorrentesManual) chamava
-- fv.generate_monthly_recurring_expenses(), que gera as recorrentes de TODAS as
-- lojas. A admin de Brasília apertava o botão e lançava as contas de Campinas.
--
-- O QUE: fv.gerar_recorrentes_da_loja(p_store_id, p_incluir_rede) gera só as
-- recorrentes daquela loja e, se p_incluir_rede, também as da rede
-- (store_id NULL), que só o admin global enxerga. Devolve quantas lançou.
-- A função antiga fica como está (quem quiser gerar tudo, de uma vez).
--
-- Mesma regra de "já lançada no mês": existe transação com o
-- recurring_expense_id no mês corrente. Sem p_store_id = erro (para todas as
-- lojas, use a função antiga de propósito, não por esquecimento).
--
-- Só service_role executa (o app chama pelo servidor).
-- Rollback: supabase/rollback/20261008_recorrentes_por_loja_rollback.sql
-- Ordem: aplicar ANTES do push do app (o app novo chama esta função).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create or replace function fv.gerar_recorrentes_da_loja(p_store_id uuid, p_incluir_rede boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   fv.recurring_expenses%rowtype;
  tgt date := date_trunc('month', current_date);
  due date;
  n   integer := 0;
begin
  if p_store_id is null then
    raise exception 'gerar_recorrentes_da_loja: informe a loja';
  end if;

  for r in
    select * from fv.recurring_expenses
     where is_active = true and recurrence = 'monthly'
       and (store_id = p_store_id or (p_incluir_rede and store_id is null))
     for update
  loop
    if not exists (
      select 1 from fv.transactions
       where recurring_expense_id = r.id and date_trunc('month', transaction_date) = tgt
    ) then
      due := make_date(extract(year from tgt)::int, extract(month from tgt)::int,
                       least(coalesce(r.day_of_month, 10), 28));
      insert into fv.transactions (
        store_id, type, amount, category, description,
        reference_type, recurring_expense_id, transaction_date, due_date, status, cost_type
      ) values (
        r.store_id, 'expense', r.amount, r.category, r.description,
        'manual', r.id, tgt, due, 'pending', r.cost_type
      );
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

revoke all on function fv.gerar_recorrentes_da_loja(uuid, boolean) from public, anon, authenticated;
grant execute on function fv.gerar_recorrentes_da_loja(uuid, boolean) to service_role;

commit;

notify pgrst, 'reload schema';
