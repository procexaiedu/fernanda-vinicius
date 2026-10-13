-- Volta de 20261013_disparo_exclusoes.sql: RPCs como estavam + some a tabela.

create or replace function fv.criar_disparo(p_titulo text, p_store_id uuid, p_template_name text, p_template_language text DEFAULT 'pt_BR'::text, p_param2 text DEFAULT NULL::text, p_param3 text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_image_url text DEFAULT NULL::text, p_customer_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(disparo_id uuid, total integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id  uuid;
  v_cnt int;
BEGIN
  INSERT INTO fv.disparos (titulo, store_id, template_name, template_language,
                           param2_default, param3_default, image_url, status, created_by)
  VALUES (p_titulo, p_store_id, p_template_name, p_template_language,
          p_param2, p_param3, p_image_url, 'rascunho', COALESCE(p_created_by, auth.uid()))
  RETURNING id INTO v_id;

  INSERT INTO fv.disparo_destinatarios (disparo_id, customer_id, nome, telefone, param2, param3)
  SELECT v_id, c.id, c.name, c.phone, p_param2, COALESCE(p_param3, '.')
  FROM fv.customers c
  WHERE c.origin_store_id = p_store_id
    AND COALESCE(c.whatsapp_opt_out, false) = false
    AND c.phone IS NOT NULL
    AND length(regexp_replace(c.phone, '\D', '', 'g')) IN (10, 11, 12, 13)
    AND (p_customer_ids IS NULL OR c.id = ANY(p_customer_ids));

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE fv.disparos SET total_destinatarios = v_cnt WHERE id = v_id;
  RETURN QUERY SELECT v_id, v_cnt;
END;
$function$;

create or replace function fv.set_disparo_recipients(p_disparo_id uuid, p_param2 text, p_param3 text, p_customer_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_store uuid;
  v_cnt   int;
BEGIN
  SELECT store_id INTO v_store FROM fv.disparos WHERE id = p_disparo_id AND status = 'rascunho';
  IF v_store IS NULL THEN RETURN -1; END IF;

  DELETE FROM fv.disparo_destinatarios WHERE disparo_id = p_disparo_id;

  INSERT INTO fv.disparo_destinatarios (disparo_id, customer_id, nome, telefone, param2, param3)
  SELECT p_disparo_id, c.id, c.name, c.phone, p_param2, COALESCE(p_param3, '.')
  FROM fv.customers c
  WHERE c.origin_store_id = v_store
    AND COALESCE(c.whatsapp_opt_out, false) = false
    AND c.phone IS NOT NULL
    AND length(regexp_replace(c.phone, '\D', '', 'g')) IN (10, 11, 12, 13)
    AND (p_customer_ids IS NULL OR c.id = ANY(p_customer_ids));

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE fv.disparos SET total_destinatarios = v_cnt WHERE id = p_disparo_id;
  RETURN v_cnt;
END;
$function$;

create or replace function fv.claim_disparo_batch(p_disparo_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, nome text, telefone text, param2 text, param3 text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT dd.id FROM fv.disparo_destinatarios dd
    WHERE dd.disparo_id = p_disparo_id AND dd.status = 'pendente'
    ORDER BY dd.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE fv.disparo_destinatarios dd
  SET status = 'enviando', updated_at = now()
  FROM picked WHERE dd.id = picked.id
  RETURNING dd.id, dd.nome, dd.telefone, dd.param2, dd.param3;
END;
$function$;

drop function if exists fv.disparo_excluido(uuid, text);
drop function if exists fv.telefone_e164_br(text);
drop table if exists fv.disparo_exclusoes;

notify pgrst, 'reload schema';
