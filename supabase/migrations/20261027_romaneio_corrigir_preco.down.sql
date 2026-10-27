-- Reversão de estrutura, não desfaz correções aprovadas nem apaga auditoria.
BEGIN;
DROP FUNCTION IF EXISTS fv.corrigir_preco_romaneio(uuid,uuid,numeric,jsonb,uuid,uuid);
-- Preservar romaneio_price_changes para consulta/auditoria. Reaplicar somente
-- o CREATE FUNCTION/GRANT ao retomar, ou remover tabela vazia antes da migration.
COMMIT;
