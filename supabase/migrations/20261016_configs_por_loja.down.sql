-- Volta de 20261016_configs_por_loja.sql: as três tabelas voltam a ser da rede.
-- Fica a cópia da PRIMEIRA loja por ordem de nome (Brasília); a outra se perde.
-- A meta da loja continua por chave ('meta_loja:<id>'), então todas ficam.
begin;

-- fiscal_categorias
drop policy if exists fiscal_categorias_loja on fv.fiscal_categorias;
alter table fv.fiscal_categorias drop constraint if exists fiscal_categorias_pkey;
delete from fv.fiscal_categorias where store_id <> (select id from fv.stores order by name limit 1);
create or replace view fv.fiscal_do_produto as
 select p.id as product_id, p.category,
    coalesce(p.codigo_ncm, c.codigo_ncm) as codigo_ncm, coalesce(p.cest, c.cest) as cest,
    coalesce(p.cfop, c.cfop) as cfop, coalesce(p.unidade, c.unidade, 'UN'::text) as unidade,
    coalesce(p.icms_origem, c.icms_origem, '0'::text) as icms_origem, coalesce(p.csosn, c.csosn) as csosn,
    coalesce(p.codigo_ncm, c.codigo_ncm) is null or coalesce(p.cfop, c.cfop) is null or coalesce(p.csosn, c.csosn) is null as incompleto
   from fv.products p
     left join fv.fiscal_categorias c on c.categoria = p.category;
alter table fv.fiscal_categorias drop column store_id;
alter table fv.fiscal_categorias add constraint fiscal_categorias_pkey primary key (categoria);
create policy fiscal_categorias_leitura on fv.fiscal_categorias for select to authenticated using (true);

-- category_label_mapping
drop policy if exists category_label_mapping_loja_select on fv.category_label_mapping;
drop policy if exists category_label_mapping_admin_loja  on fv.category_label_mapping;
alter table fv.category_label_mapping drop constraint if exists category_label_mapping_pkey;
delete from fv.category_label_mapping where store_id <> (select id from fv.stores order by name limit 1);
alter table fv.category_label_mapping drop column store_id;
alter table fv.category_label_mapping add constraint category_label_mapping_pkey primary key (category);
create policy category_label_mapping_select_all on fv.category_label_mapping for select to authenticated using (true);
create policy category_label_mapping_admin_write on fv.category_label_mapping for all to authenticated
  using ((auth.jwt() ->> 'user_role') = 'admin') with check ((auth.jwt() ->> 'user_role') = 'admin');

-- settings
drop policy if exists settings_admin_loja     on fv.settings;
drop policy if exists settings_operadora_loja on fv.settings;
alter table fv.settings drop constraint if exists settings_loja_key;
delete from fv.settings
 where key not like 'meta_loja:%' and store_id <> (select id from fv.stores order by name limit 1);
alter table fv.settings drop column store_id;
alter table fv.settings add constraint settings_key_key unique (key);
create policy settings_admin_select on fv.settings for select to authenticated using ((select fv.is_admin()));
create policy settings_global_write on fv.settings for all to authenticated
  using ((select fv.is_admin()) and (select fv.e_admin_global()))
  with check ((select fv.is_admin()) and (select fv.e_admin_global()));
create policy settings_operator_select on fv.settings for select using (not fv.is_admin());

commit;
notify pgrst, 'reload schema';
