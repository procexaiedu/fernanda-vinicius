-- Volta de 20261119_fiscal_por_material.sql: view só por categoria e sem a tabela.
begin;

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

drop table if exists fv.fiscal_materiais;

commit;

notify pgrst, 'reload schema';
