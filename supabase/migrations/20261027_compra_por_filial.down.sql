-- Reverter app antes. Nao altera compras ou remessas existentes.
BEGIN;
CREATE OR REPLACE FUNCTION fv.salvar_compra_conferida(p jsonb, p_entra_direto boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fv, pg_temp
AS $$
DECLARE
  v_r jsonb;
  v_m jsonb;
BEGIN
  v_r := fv.salvar_compra(p);
  -- Erro, reenvio da mesma compra (já tratado no 1º envio) ou "entra direto".
  IF v_r ? 'erro' OR COALESCE((v_r->>'ja_existia')::boolean, false) OR COALESCE(p_entra_direto, false) THEN
    RETURN v_r;
  END IF;
  v_m := fv.abrir_remessas_do_fornecedor((v_r->>'purchase_id')::uuid, (p->>'user_id')::uuid);
  RETURN v_r || jsonb_build_object('remessas', v_m->'remessas');
END;
$$;
DROP FUNCTION IF EXISTS fv.abrir_remessas_do_fornecedor(uuid,uuid,uuid[]);
ALTER TABLE fv.stores DROP COLUMN IF EXISTS purchase_enters_directly;
NOTIFY pgrst, 'reload schema';
COMMIT;
