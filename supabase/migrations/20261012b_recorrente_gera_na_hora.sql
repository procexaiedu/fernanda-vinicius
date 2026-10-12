-- ─────────────────────────────────────────────────────────────────────────────
-- Recorrente cadastrada/reativada já vira conta a pagar do mês (12/10)
--
-- POR QUÊ: a conta do mês só nascia no dia 1º (cron) ou no "Gerar agora". A
-- Eleandra cadastrava a recorrente no meio do mês e não via a pendência.
--
-- O QUE: fv.gerar_ocorrencia_recorrente(p_id) lança a conta do mês corrente
-- DAQUELA recorrente (mensal e ativa), pendente, vencendo no dia dela. Se o dia
-- já passou, nasce vencida (regra decidida em 12/10). Mesma trava das outras
-- funções (FOR UPDATE + "já existe transação dela no mês"): rodar o cron ou o
-- "Gerar agora" depois não duplica. Devolve 1 se lançou, 0 se não.
--
-- Só service_role executa (o app chama pelo servidor, depois de checar a loja).
-- Rollback: supabase/rollback/20261012b_recorrente_gera_na_hora.down.sql
-- Ordem: aplicar ANTES do push do app.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create or replace function fv.gerar_ocorrencia_recorrente(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   fv.recurring_expenses%rowtype;
  tgt date := date_trunc('month', current_date);
begin
  select * into r from fv.recurring_expenses
   where id = p_id and is_active = true and recurrence = 'monthly'
   for update;
  if not found then
    return 0;
  end if;

  if exists (
    select 1 from fv.transactions
     where recurring_expense_id = r.id and date_trunc('month', transaction_date) = tgt
  ) then
    return 0;
  end if;

  insert into fv.transactions (
    store_id, type, amount, category, description,
    reference_type, recurring_expense_id, transaction_date, due_date, status, cost_type
  ) values (
    r.store_id, 'expense', r.amount, r.category, r.description,
    'manual', r.id, tgt,
    make_date(extract(year from tgt)::int, extract(month from tgt)::int,
              least(coalesce(r.day_of_month, 10), 28)),
    'pending', r.cost_type
  );
  return 1;
end;
$$;

revoke all on function fv.gerar_ocorrencia_recorrente(uuid) from public, anon, authenticated;
grant execute on function fv.gerar_ocorrencia_recorrente(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
