-- Teste de fv.gerar_recorrentes_da_loja (20261008_recorrentes_por_loja.sql).
-- Dados fictícios; termina em ROLLBACK.
BEGIN;

INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Loja C', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000000b1', 'Loja B', 'B', 'DF');
INSERT INTO fv.recurring_expenses (id, store_id, description, amount, category, recurrence, is_active) VALUES
  ('00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000000c1', 'Luz C',  10, 'luz', 'monthly', true),
  ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000000b1', 'Luz B',  10, 'luz', 'monthly', true),
  ('00000000-0000-0000-0000-0000000008b2', '00000000-0000-0000-0000-0000000000b1', 'Inativa', 10, 'luz', 'monthly', false),
  ('00000000-0000-0000-0000-000000000800', NULL,                                   'Rede',   10, 'contador', 'monthly', true);

DO $$
DECLARE n integer;
BEGIN
  -- Admin de B: só a de B (a inativa e a de C ficam de fora; a da rede também).
  n := fv.gerar_recorrentes_da_loja('00000000-0000-0000-0000-0000000000b1', false);
  ASSERT n = 1, format('B sem rede: esperava 1, veio %s', n);
  ASSERT (SELECT count(*) FROM fv.transactions WHERE store_id = '00000000-0000-0000-0000-0000000000c1') = 0,
    'gerou conta de C a partir de B';
  ASSERT (SELECT count(*) FROM fv.transactions WHERE store_id IS NULL) = 0, 'gerou conta da rede para admin de loja';

  -- De novo no mesmo mês: nada (idempotente).
  n := fv.gerar_recorrentes_da_loja('00000000-0000-0000-0000-0000000000b1', false);
  ASSERT n = 0, format('repetição gerou %s', n);

  -- Admin global em C: a de C + a da rede.
  n := fv.gerar_recorrentes_da_loja('00000000-0000-0000-0000-0000000000c1', true);
  ASSERT n = 2, format('C com rede: esperava 2, veio %s', n);
  ASSERT (SELECT count(*) FROM fv.transactions) = 3, 'total de contas geradas';

  -- Sem loja: erro, não "todas".
  BEGIN
    PERFORM fv.gerar_recorrentes_da_loja(NULL, true);
    RAISE EXCEPTION 'sem loja deveria falhar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'sem loja deveria falhar' THEN RAISE; END IF;
  END;

  -- Só o servidor executa.
  ASSERT NOT has_function_privilege('authenticated', 'fv.gerar_recorrentes_da_loja(uuid, boolean)', 'EXECUTE'),
    'authenticated executa gerar_recorrentes_da_loja';
  ASSERT NOT has_function_privilege('anon', 'fv.gerar_recorrentes_da_loja(uuid, boolean)', 'EXECUTE'),
    'anon executa gerar_recorrentes_da_loja';
  ASSERT has_function_privilege('service_role', 'fv.gerar_recorrentes_da_loja(uuid, boolean)', 'EXECUTE'),
    'service_role sem execute';

  RAISE NOTICE 'recorrentes por loja: OK';
END $$;

ROLLBACK;
