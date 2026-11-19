-- ─────────────────────────────────────────────────────────────────────────────
-- Classificação fiscal por CATEGORIA + MATERIAL (19/11/2026, pedido do Felipe)
--
-- O material já é obrigatório no cadastro da peça (lista fv.materials). Com isto,
-- categoria + material decidem a NCM sem mudar a tela: "casaco" + "tecido" sai
-- como casaco de tecido; "acessório de cabelo" + "acetato" sai como artigo de
-- plástico, e não como bijuteria.
--
-- Ordem da view fiscal_do_produto: peça (products.codigo_ncm...) → regra da
-- loja para categoria+material (fiscal_materiais) → categoria da loja
-- (fiscal_categorias). Quando a regra de material casa, NCM e CEST vêm SÓ dela
-- (o CEST da categoria é de bijuteria e não vale para casaco). CFOP, CSOSN,
-- unidade e origem vazios na regra caem na categoria.
--
-- Comparação de material e categoria sem diferença de maiúscula/espaço.
-- Sem regra cadastrada, nada muda (Brasília continua só por categoria).
-- Volta: 20261119_fiscal_por_material.down.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create table if not exists fv.fiscal_materiais (
  store_id    uuid not null references fv.stores(id) on delete cascade,
  categoria   text not null,
  material    text not null,
  codigo_ncm  text not null check (codigo_ncm ~ '^\d{8}$'),
  cest        text check (cest is null or cest ~ '^\d{7}$'),
  cfop        text,
  unidade     text,
  icms_origem text,
  csosn       text,
  observacao  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists fiscal_materiais_chave
  on fv.fiscal_materiais (store_id, lower(btrim(categoria)), lower(btrim(material)));

comment on table fv.fiscal_materiais is
  'Classificação fiscal por categoria+material, por loja. Vence a de fiscal_categorias; perde para a da peça.';

alter table fv.fiscal_materiais enable row level security;
drop policy if exists fiscal_materiais_loja on fv.fiscal_materiais;
create policy fiscal_materiais_loja on fv.fiscal_materiais
  using (fv.pode_ver_loja(store_id) or store_id = (select fv.loja_do_usuario()));

grant select, insert, update on fv.fiscal_materiais to authenticated, service_role;

create or replace view fv.fiscal_do_produto as
 select p.id as product_id,
    p.category,
    coalesce(p.codigo_ncm, m.codigo_ncm, c.codigo_ncm) as codigo_ncm,
    coalesce(p.cest, case when m.codigo_ncm is not null then m.cest else c.cest end) as cest,
    coalesce(p.cfop, m.cfop, c.cfop) as cfop,
    coalesce(p.unidade, m.unidade, c.unidade, 'UN'::text) as unidade,
    coalesce(p.icms_origem, m.icms_origem, c.icms_origem, '0'::text) as icms_origem,
    coalesce(p.csosn, m.csosn, c.csosn) as csosn,
    coalesce(p.codigo_ncm, m.codigo_ncm, c.codigo_ncm) is null
      or coalesce(p.cfop, m.cfop, c.cfop) is null
      or coalesce(p.csosn, m.csosn, c.csosn) is null as incompleto
   from fv.products p
     left join fv.fiscal_categorias c on c.categoria = p.category and c.store_id = p.store_id
     left join fv.fiscal_materiais m on m.store_id = p.store_id
       and lower(btrim(m.categoria)) = lower(btrim(p.category))
       and lower(btrim(m.material)) = lower(btrim(p.material));

commit;

notify pgrst, 'reload schema';
