-- Reverte a API, preservando nomes já corrigidos e todos os snapshots históricos.
DROP FUNCTION IF EXISTS fv.corrigir_nome_produto(uuid,uuid,text,text,uuid,uuid,uuid,uuid);
NOTIFY pgrst, 'reload schema';
