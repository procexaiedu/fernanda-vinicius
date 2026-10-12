-- ============================================================================
-- DESFAZER: 20261012_compra_entra_na_conferencia.sql
-- ============================================================================
--
-- ⚠️  PERDA DE DADOS: os DROP COLUMN abaixo apagam, sem volta,
--       · fv.transfers.falta_decisao, falta_valor, falta_decidida_at,
--         falta_decidida_by, falta_detalhe  (decisão de desconto das faltas)
--       · fv.purchases.desconto_falta        (quanto foi abatido das parcelas)
--     O que o desconto já mudou em parcelas, despesas, créditos a receber e
--     lotes consignados NÃO é revertido (fica como está; só o registro some).
--     Exporte essas colunas antes, se precisar delas:
--       COPY (SELECT id, falta_decisao, falta_valor, falta_decidida_at, falta_decidida_by, falta_detalhe
--               FROM fv.transfers WHERE falta_decisao IS NOT NULL) TO STDOUT CSV HEADER;
--       COPY (SELECT id, desconto_falta FROM fv.purchases WHERE desconto_falta <> 0) TO STDOUT CSV HEADER;
--
-- ⚠️  RECUSA se existir remessa com origem nula (lote do fornecedor nascido
--     da compra desde 12/10): `from_store_id` não pode voltar a NOT NULL com
--     elas. Confira/encerre essas remessas antes (ou trate-as à mão).
--
-- ORDEM: voltar o CÓDIGO primeiro (o código de 12/10 chama as funções que
-- este arquivo apaga), depois rodar este arquivo como `postgres`, depois
-- SIGUSR1 no supabase_rest. Idempotente.
-- ============================================================================

BEGIN;

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM fv.transfers WHERE from_store_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Desfazer recusado: % remessa(s) com origem nula (lote do fornecedor da compra). Encerre-as antes; nada foi alterado.', v_n;
  END IF;
END $$;

DROP FUNCTION IF EXISTS fv.decidir_falta_do_lote(uuid, uuid, boolean, boolean);
DROP FUNCTION IF EXISTS fv.excluir_compra_conferida(uuid, uuid);
DROP FUNCTION IF EXISTS fv.salvar_compra_conferida(jsonb, boolean);
DROP FUNCTION IF EXISTS fv.abrir_remessas_do_fornecedor(uuid, uuid);

ALTER TABLE fv.transfers DROP CONSTRAINT IF EXISTS transfers_falta_decisao_check;
ALTER TABLE fv.transfers DROP CONSTRAINT IF EXISTS transfers_origem_so_no_lote;
ALTER TABLE fv.transfers ALTER COLUMN from_store_id SET NOT NULL;
COMMENT ON COLUMN fv.transfers.from_store_id IS NULL;

ALTER TABLE fv.transfers
  DROP COLUMN IF EXISTS falta_decisao,
  DROP COLUMN IF EXISTS falta_valor,
  DROP COLUMN IF EXISTS falta_decidida_at,
  DROP COLUMN IF EXISTS falta_decidida_by,
  DROP COLUMN IF EXISTS falta_detalhe;

ALTER TABLE fv.purchases DROP COLUMN IF EXISTS desconto_falta;

NOTIFY pgrst, 'reload schema';

COMMIT;
