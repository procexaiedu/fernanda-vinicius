-- Reversão de estrutura, não desfaz correções aprovadas nem apaga auditoria.
BEGIN;
DROP FUNCTION IF EXISTS fv.corrigir_preco_romaneio(uuid,uuid,numeric,jsonb,uuid,uuid);
-- Preservar romaneio_price_changes para consulta/auditoria. A migration de ida
-- pode ser reaplicada sem apagar o histórico de correções.
COMMIT;
