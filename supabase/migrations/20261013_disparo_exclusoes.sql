-- Lista de exclusão de disparo (13/10/2026).
--
-- Quem está aqui NÃO recebe campanha. A exclusão mora só na área de Disparos:
-- `fv.customers` não é tocada (o cadastro da cliente fica intacto na aba
-- Clientes). Por loja, porque as lojas são isoladas; para virar global, basta
-- tirar o `e.store_id = p_store_id` de `fv.disparo_excluido` (é o único lugar).
--
-- Aplicada no banco, não só na tela: `criar_disparo` e `set_disparo_recipients`
-- não inserem excluída, e `claim_disparo_batch` derruba como falha quem foi
-- excluída depois do rascunho. Mandar o id pelo navegador não fura.
--
-- Volta: 20261013_disparo_exclusoes.down.sql

create table if not exists fv.disparo_exclusoes (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references fv.stores(id),
  telefone_e164   text not null check (telefone_e164 ~ '^\+55\d{10,11}$'),
  customer_id     uuid references fv.customers(id) on delete set null,
  motivo          text not null check (motivo in ('invalido', 'bloqueio', 'opt_out', 'manual')),
  origem          text not null check (origem in ('webhook', 'resposta', 'manual', 'historico')),
  detalhe         text,
  criado_em       timestamptz not null default now(),
  criado_por      uuid,
  removido_em     timestamptz,
  removido_por    uuid,
  removido_motivo text
);

-- Uma exclusão ATIVA por telefone e loja. Retirar é soft (removido_em), então
-- o histórico fica, e a pessoa pode ser excluída de novo depois.
create unique index if not exists disparo_exclusoes_ativa_uk
  on fv.disparo_exclusoes (store_id, telefone_e164) where removido_em is null;

alter table fv.disparo_exclusoes enable row level security;
-- Sem policy: só o servidor (service_role) lê e escreve. A tela passa pelas actions.
grant all on fv.disparo_exclusoes to service_role;

-- Mesma regra de src/lib/ycloud.ts#normalizePhoneBR. A base tem formato misto
-- ("(61) 98111-8248", "+556181227155"); sem normalizar, a exclusão não casaria.
create or replace function fv.telefone_e164_br(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^55\d{10,11}$' then '+' || d
    when length(d) in (10, 11) then '+55' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function fv.disparo_excluido(p_store_id uuid, p_telefone text)
returns boolean language sql stable as $$
  select exists (
    select 1 from fv.disparo_exclusoes e
    where e.removido_em is null
      and e.store_id = p_store_id
      and e.telefone_e164 = fv.telefone_e164_br(p_telefone)
  )
$$;

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
    AND NOT fv.disparo_excluido(p_store_id, c.phone)
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
    AND NOT fv.disparo_excluido(v_store, c.phone)
    AND (p_customer_ids IS NULL OR c.id = ANY(p_customer_ids));

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE fv.disparos SET total_destinatarios = v_cnt WHERE id = p_disparo_id;
  RETURN v_cnt;
END;
$function$;

-- Excluída depois do rascunho (ou rascunho antigo): vira falha com motivo antes
-- de o lote ser reservado, então nunca chega ao envio.
create or replace function fv.claim_disparo_batch(p_disparo_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, nome text, telefone text, param2 text, param3 text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_store uuid;
BEGIN
  SELECT d.store_id INTO v_store FROM fv.disparos d WHERE d.id = p_disparo_id;

  UPDATE fv.disparo_destinatarios dd
  SET status = 'falhou', erro = 'excluída do disparo (lista de exclusão)', updated_at = now()
  WHERE dd.disparo_id = p_disparo_id AND dd.status = 'pendente'
    AND fv.disparo_excluido(v_store, dd.telefone);

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

notify pgrst, 'reload schema';
