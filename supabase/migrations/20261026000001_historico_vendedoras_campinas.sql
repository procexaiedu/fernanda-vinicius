-- Dono, 26/10/2026, task 515e83ed: reunir histórico explicitamente atribuído
-- a Rosi/Fernanda com as pessoas de Campinas. NÃO APLICADA em produção.
-- Aplicação pelo dono: psql -X -1 -v ON_ERROR_STOP=1 -f <este arquivo>
-- Snapshot contém dados pessoais: fica só no banco protegido, nunca no Git.
set local lock_timeout = '3s';
lock table fv.sales, fv.sellers, fv.transactions, fv.seller_goals in share row exclusive mode;
create schema if not exists fv_historico;
revoke all on schema fv_historico from public, anon, authenticated;
grant usage on schema fv_historico to service_role;
create table if not exists fv_historico.campinas_20261026000001 (
  sale_id uuid primary key,
  antes jsonb not null,
  depois jsonb not null,
  capturado_em timestamptz not null default now()
);
alter table fv_historico.campinas_20261026000001 enable row level security;
revoke all on fv_historico.campinas_20261026000001 from public, anon, authenticated;
grant select, insert on fv_historico.campinas_20261026000001 to service_role;
comment on table fv_historico.campinas_20261026000001 is 'Só o servidor lê e grava. Snapshot integral para reversão; não exportar para o repositório.';
do $$
declare
  loja constant uuid := '7d992017-5eda-4f26-8855-2663bbef843b';
  n integer;
begin
  if (select count(*) from fv.sales where store_id=loja) <> 132
    or (select sum(total) from fv.sales where store_id=loja) is distinct from 66734.62::numeric then
    raise exception 'GUARDA: base Campinas mudou';
  end if;
  if (select count(*) from fv.sellers where store_id=loja and is_active and
    ((id='3d27830e-5cc3-45b5-b877-40397d222257' and full_name='Rosi') or
     (id='43b48878-a1e4-46a7-9011-350afe0ee6ad' and full_name='Fernanda'))) <> 2 then
    raise exception 'GUARDA: pessoas/loja/atividade divergentes';
  end if;
  if exists(select 1 from fv.transactions where store_id=loja and reference_type='seller_commission')
    or exists(select 1 from fv.seller_goals where user_id in ('456a2633-a6bd-4c85-aadd-ee379696bc18','f5a59aab-8409-4a52-a6f4-e5dff887f7b5')
      or seller_person_id in ('3d27830e-5cc3-45b5-b877-40397d222257','43b48878-a1e4-46a7-9011-350afe0ee6ad')) then
    raise exception 'GUARDA: surgiram comissoes/metas, revisar sem regenerar';
  end if;
  select count(*) into n from fv_historico.campinas_20261026000001;
  if n <> 0 then
    if n <> 131 then raise exception 'GUARDA: snapshot incompleto'; end if;
    if not exists(select 1 from fv_historico.campinas_20261026000001 b
      left join fv.sales s on s.id=b.sale_id where to_jsonb(s) is distinct from b.depois) then
      raise notice 'Ja aplicada: 131 linhas identicas ao snapshot posterior';
      return;
    end if;
    if exists(select 1 from fv_historico.campinas_20261026000001 b
      left join fv.sales s on s.id=b.sale_id where to_jsonb(s) is distinct from b.antes) then
      raise exception 'GUARDA: estado misto ou venda alterada apos snapshot';
    end if;
  end if;
  if (select count(*) from fv.sales where store_id=loja) <> 132
    or (select sum(total) from fv.sales where store_id=loja) is distinct from 66734.62::numeric then
    raise exception 'GUARDA: base Campinas mudou';
  end if;
  if (select count(*) from fv.sales where store_id=loja and seller_id='456a2633-a6bd-4c85-aadd-ee379696bc18' and seller_person_id is null and status='completed') <> 105
    or (select sum(total) from fv.sales where store_id=loja and seller_id='456a2633-a6bd-4c85-aadd-ee379696bc18') is distinct from 52526.62::numeric
    or (select count(*) from fv.sales where store_id=loja and seller_id='f5a59aab-8409-4a52-a6f4-e5dff887f7b5' and seller_person_id is null and status='completed') <> 26
    or (select sum(total) from fv.sales where store_id=loja and seller_id='f5a59aab-8409-4a52-a6f4-e5dff887f7b5') is distinct from 14044::numeric then
    raise exception 'GUARDA: contagens/valores/status divergentes';
  end if;
  -- Conferência anterior agregada; não imprime dados pessoais.
  raise notice 'ANTES: Rosi 105/52526.62; Fernanda 26/14044.00';
  insert into fv_historico.campinas_20261026000001(sale_id,antes,depois)
  select id,to_jsonb(s),to_jsonb(s) || jsonb_build_object('seller_id',null,'seller_person_id',
    case seller_id when '456a2633-a6bd-4c85-aadd-ee379696bc18'::uuid then '3d27830e-5cc3-45b5-b877-40397d222257' else '43b48878-a1e4-46a7-9011-350afe0ee6ad' end)
  from fv.sales s where store_id=loja and seller_person_id is null
    and seller_id in ('456a2633-a6bd-4c85-aadd-ee379696bc18','f5a59aab-8409-4a52-a6f4-e5dff887f7b5')
  on conflict (sale_id) do nothing;
  update fv.sales s set seller_id=null,seller_person_id=(b.depois->>'seller_person_id')::uuid
  from fv_historico.campinas_20261026000001 b where s.id=b.sale_id and to_jsonb(s)=b.antes;
  get diagnostics n = row_count;
  if n <> 131 or exists(select 1 from fv_historico.campinas_20261026000001 b
    left join fv.sales s on s.id=b.sale_id where to_jsonb(s) is distinct from b.depois) then
    raise exception 'GUARDA: resultado divergente, inclusive campos preservados';
  end if;
  raise notice 'DEPOIS: 131 vendas, 66570.62; demais colunas identicas';
end $$;
notify pgrst, 'reload schema';
