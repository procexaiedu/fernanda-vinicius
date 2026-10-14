-- ─────────────────────────────────────────────────────────────────────────────
-- Configurações POR LOJA — 16/10/2026
--
-- POR QUÊ: regra do dev (14/10): na FV nada é global; Campinas e Brasília não
-- compartilham configuração (Eleandra é dona de Brasília, Fernanda das duas).
-- Três tabelas ainda valiam para a rede:
--   * fv.settings               (Configurações > Negócio: desconto Pix e
--                                aniversário, parcelas, prazo de troca, markup,
--                                inatividade, peça parada, reserva de compra)
--   * fv.category_label_mapping (Configurações > Impressão: categoria → etiqueta;
--                                a admin de loja mudava a de Campinas também)
--   * fv.fiscal_categorias      (NCM/CFOP/CSOSN por categoria, para a NFC-e)
-- Fornecedores e materiais continuam da rede (decisão do dev).
--
-- O QUE FAZ: store_id obrigatório nas três; os valores de hoje são copiados
-- para cada loja (as duas começam iguais e daí em diante se separam). A meta da
-- loja (settings 'meta_loja:<id>') já era de uma loja só: vai para a loja dela.
-- RLS por loja (fv.pode_ver_loja). A view fiscal_do_produto passa a casar a
-- categoria da peça com a da LOJA da peça.
--
-- ORDEM DE DEPLOY: aplicar ANTES do push (o código novo filtra por store_id e
-- grava com onConflict store_id,...), com a loja fechada.
-- Volta: 20261016_configs_por_loja.down.sql
-- Teste: supabase/tests/20261016_configs_por_loja.test.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. settings ─────────────────────────────────────────────────────────────────
alter table fv.settings add column if not exists store_id uuid references fv.stores(id) on delete cascade;

-- Meta da loja: a loja está no nome da chave.
update fv.settings s
   set store_id = st.id
  from fv.stores st
 where s.store_id is null and s.key = 'meta_loja:' || st.id::text;

-- Meta de loja que não existe mais: não tem dona, sai.
delete from fv.settings where store_id is null and key like 'meta_loja:%';

-- O resto (regras do negócio) vira uma cópia por loja. A chave única antiga
-- (key) barraria a cópia: sai antes.
alter table fv.settings drop constraint if exists settings_key_key;
insert into fv.settings (store_id, key, value, description, created_at, updated_at)
select st.id, s.key, s.value, s.description, s.created_at, now()
  from fv.settings s cross join fv.stores st
 where s.store_id is null;
delete from fv.settings where store_id is null;

alter table fv.settings alter column store_id set not null;
alter table fv.settings add constraint settings_loja_key unique (store_id, key);

drop policy if exists settings_admin_select    on fv.settings;
drop policy if exists settings_global_write    on fv.settings;
drop policy if exists settings_operator_select on fv.settings;
drop policy if exists settings_admin_loja      on fv.settings;
drop policy if exists settings_operadora_loja  on fv.settings;
create policy settings_admin_loja on fv.settings for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));
-- A vendedora lê (o PDV precisa do desconto), só da loja dela.
create policy settings_operadora_loja on fv.settings for select to authenticated
  using ((not (select fv.is_admin())) and store_id = (select fv.loja_do_usuario()));

-- 2. category_label_mapping ───────────────────────────────────────────────────
alter table fv.category_label_mapping add column if not exists store_id uuid references fv.stores(id) on delete cascade;

-- A PK antiga (category) barraria a cópia: sai antes.
alter table fv.category_label_mapping drop constraint if exists category_label_mapping_pkey;
insert into fv.category_label_mapping (store_id, category, label_format, is_active, created_at, updated_at)
select st.id, m.category, m.label_format, m.is_active, m.created_at, now()
  from fv.category_label_mapping m cross join fv.stores st
 where m.store_id is null;
delete from fv.category_label_mapping where store_id is null;
alter table fv.category_label_mapping alter column store_id set not null;
alter table fv.category_label_mapping add constraint category_label_mapping_pkey primary key (store_id, category);

drop policy if exists category_label_mapping_admin_write on fv.category_label_mapping;
drop policy if exists category_label_mapping_select_all  on fv.category_label_mapping;
drop policy if exists category_label_mapping_loja_select on fv.category_label_mapping;
drop policy if exists category_label_mapping_admin_loja  on fv.category_label_mapping;
create policy category_label_mapping_loja_select on fv.category_label_mapping for select to authenticated
  using (fv.pode_ver_loja(store_id) or store_id = (select fv.loja_do_usuario()));
create policy category_label_mapping_admin_loja on fv.category_label_mapping for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

-- 3. fiscal_categorias ────────────────────────────────────────────────────────
alter table fv.fiscal_categorias add column if not exists store_id uuid references fv.stores(id) on delete cascade;

alter table fv.fiscal_categorias drop constraint if exists fiscal_categorias_pkey;
insert into fv.fiscal_categorias (store_id, categoria, codigo_ncm, cest, cfop, unidade, icms_origem, csosn, observacao, created_at, updated_at)
select st.id, c.categoria, c.codigo_ncm, c.cest, c.cfop, c.unidade, c.icms_origem, c.csosn, c.observacao, c.created_at, now()
  from fv.fiscal_categorias c cross join fv.stores st
 where c.store_id is null;
delete from fv.fiscal_categorias where store_id is null;
alter table fv.fiscal_categorias alter column store_id set not null;
alter table fv.fiscal_categorias add constraint fiscal_categorias_pkey primary key (store_id, categoria);

drop policy if exists fiscal_categorias_leitura on fv.fiscal_categorias;
drop policy if exists fiscal_categorias_loja    on fv.fiscal_categorias;
create policy fiscal_categorias_loja on fv.fiscal_categorias for select to authenticated
  using (fv.pode_ver_loja(store_id) or store_id = (select fv.loja_do_usuario()));
-- Escrita pela API com sessão: o grant de INSERT/UPDATE para authenticated
-- existia (20260901) sem política de escrita; continua sem (RLS nega). Quem
-- grava é o servidor (service_role).

-- A view: categoria da peça casada com a da loja da peça.
create or replace view fv.fiscal_do_produto as
 select p.id as product_id,
    p.category,
    coalesce(p.codigo_ncm, c.codigo_ncm) as codigo_ncm,
    coalesce(p.cest, c.cest) as cest,
    coalesce(p.cfop, c.cfop) as cfop,
    coalesce(p.unidade, c.unidade, 'UN'::text) as unidade,
    coalesce(p.icms_origem, c.icms_origem, '0'::text) as icms_origem,
    coalesce(p.csosn, c.csosn) as csosn,
    coalesce(p.codigo_ncm, c.codigo_ncm) is null or coalesce(p.cfop, c.cfop) is null or coalesce(p.csosn, c.csosn) is null as incompleto
   from fv.products p
     left join fv.fiscal_categorias c on c.categoria = p.category and c.store_id = p.store_id;

commit;

notify pgrst, 'reload schema';
