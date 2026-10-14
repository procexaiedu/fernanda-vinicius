-- Teste de 20261014_disparo_listas.sql com dados fictícios. Termina em ROLLBACK.
BEGIN;

INSERT INTO fv.stores (id, name, city, state) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Loja C', 'C', 'SP'),
  ('00000000-0000-0000-0000-0000000000b1', 'Loja B', 'B', 'DF');
INSERT INTO fv.customers (id, name, phone, origin_store_id) VALUES
  ('00000000-0000-0000-0000-00000000c0b1', 'Cliente B', '(61) 99999-0001', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000c0c1', 'Cliente C', '(19) 99999-0001', '00000000-0000-0000-0000-0000000000c1');
INSERT INTO fv.disparo_listas (id, store_id, nome) VALUES
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000000b1', 'Positivas');

-- Cliente da loja certa entra.
INSERT INTO fv.disparo_lista_itens VALUES ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-00000000c0b1');

-- Cliente de outra loja é barrada.
DO $$ BEGIN
  BEGIN
    INSERT INTO fv.disparo_lista_itens VALUES ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-00000000c0c1');
    RAISE EXCEPTION 'FALHOU: aceitou cliente de outra loja';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
  END;
END $$;

-- Nome repetido na mesma loja (ativa) é barrado; em outra loja pode.
DO $$ BEGIN
  BEGIN
    INSERT INTO fv.disparo_listas (store_id, nome) VALUES ('00000000-0000-0000-0000-0000000000b1', 'Positivas');
    RAISE EXCEPTION 'FALHOU: nome duplicado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
INSERT INTO fv.disparo_listas (store_id, nome) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Positivas');

-- Sem policy: o navegador (authenticated/anon) não lê nada.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM fv.disparo_listas) = 0, 'authenticated leu listas';
  ASSERT (SELECT count(*) FROM fv.disparo_lista_itens) = 0, 'authenticated leu itens';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

SELECT 'ok: disparo_listas' AS resultado;
ROLLBACK;
