-- Teste de fv.gerar_ocorrencia_recorrente (20261012b_recorrente_gera_na_hora.sql).
-- Dados fictícios; termina em ROLLBACK.
BEGIN;

INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000000c9', 'Loja C9', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000000b9', 'Loja B9', 'B', 'DF');
INSERT INTO fv.recurring_expenses (id, store_id, description, amount, category, recurrence, day_of_month, is_active) VALUES
  ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000000c9', 'Aluguel C9', 100, 'aluguel', 'monthly', 1,  true),
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000000b9', 'Luz B9',      50, 'luz',     'monthly', 31, true),
  ('00000000-0000-0000-0000-0000000009b2', '00000000-0000-0000-0000-0000000000b9', 'Inativa B9',  10, 'luz',     'monthly', 5,  false);

DO $$
DECLARE n integer; t record;
BEGIN
  -- Cadastrada hoje: lança na hora, pendente, na loja dela, vencendo no dia (já passado = vencida).
  n := fv.gerar_ocorrencia_recorrente('00000000-0000-0000-0000-0000000009c1');
  ASSERT n = 1, format('esperava 1, veio %s', n);
  SELECT * INTO t FROM fv.transactions WHERE recurring_expense_id = '00000000-0000-0000-0000-0000000009c1';
  ASSERT t.status = 'pending' AND t.store_id = '00000000-0000-0000-0000-0000000000c9', 'status/loja errados';
  ASSERT t.due_date = date_trunc('month', current_date)::date, 'vencimento do dia 1';

  -- Dia 31 vira 28 (mesma regra do cron).
  n := fv.gerar_ocorrencia_recorrente('00000000-0000-0000-0000-0000000009b1');
  ASSERT (SELECT extract(day from due_date) FROM fv.transactions
           WHERE recurring_expense_id = '00000000-0000-0000-0000-0000000009b1') = 28, 'dia 31 -> 28';

  -- De novo, e depois o "cron" (todas as lojas) e o "Gerar agora" da loja: não duplica.
  n := fv.gerar_ocorrencia_recorrente('00000000-0000-0000-0000-0000000009c1');
  ASSERT n = 0, format('repetição gerou %s', n);
  PERFORM fv.generate_monthly_recurring_expenses();
  n := fv.gerar_recorrentes_da_loja('00000000-0000-0000-0000-0000000000b9', false);
  ASSERT n = 0, format('Gerar agora duplicou %s', n);
  ASSERT (SELECT count(*) FROM fv.transactions WHERE recurring_expense_id IN
          ('00000000-0000-0000-0000-0000000009c1','00000000-0000-0000-0000-0000000009b1')) = 2, 'duplicou com o cron';

  -- Inativa e id inexistente: nada.
  ASSERT fv.gerar_ocorrencia_recorrente('00000000-0000-0000-0000-0000000009b2') = 0, 'inativa gerou';
  ASSERT fv.gerar_ocorrencia_recorrente('00000000-0000-0000-0000-00000000dead') = 0, 'inexistente gerou';

  -- Só service_role executa.
  ASSERT NOT has_function_privilege('authenticated', 'fv.gerar_ocorrencia_recorrente(uuid)', 'execute'), 'authenticated executa';
  ASSERT NOT has_function_privilege('anon', 'fv.gerar_ocorrencia_recorrente(uuid)', 'execute'), 'anon executa';

  RAISE NOTICE 'OK: gerar_ocorrencia_recorrente';
END $$;

ROLLBACK;
