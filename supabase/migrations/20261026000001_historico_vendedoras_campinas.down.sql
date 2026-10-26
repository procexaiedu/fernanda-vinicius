-- Dono, 26/10/2026, task 515e83ed. Reverte apenas a atribuição deste snapshot.
-- psql -X -1 -v ON_ERROR_STOP=1 -f <este arquivo>
-- ATENÇÃO: exige dono de fv.sales/superusuário. Recusa qualquer edição posterior.
-- Snapshot fica retido, sem perda. Não executar sem revisão/aprovação do dono.
set local lock_timeout = '3s';
lock table fv.sales, fv.sellers, fv.transactions, fv.seller_goals in share row exclusive mode;
do $$ declare n integer; begin
  if (select count(*) from fv_historico.campinas_20261026000001) <> 131 then
    raise exception 'GUARDA: snapshot ausente/incompleto';
  end if;
  if exists(select 1 from fv_historico.campinas_20261026000001 b where
    b.antes->>'id' is distinct from b.sale_id::text
    or b.antes->>'store_id' is distinct from '7d992017-5eda-4f26-8855-2663bbef843b'
    or b.antes->>'status' is distinct from 'completed'
    or b.antes->>'seller_person_id' is not null
    or b.antes->>'seller_id' is null
    or b.antes->>'seller_id' not in ('456a2633-a6bd-4c85-aadd-ee379696bc18','f5a59aab-8409-4a52-a6f4-e5dff887f7b5')
    or b.depois is distinct from (b.antes || jsonb_build_object('seller_id',null,'seller_person_id',
      case b.antes->>'seller_id' when '456a2633-a6bd-4c85-aadd-ee379696bc18' then '3d27830e-5cc3-45b5-b877-40397d222257' else '43b48878-a1e4-46a7-9011-350afe0ee6ad' end)))
    or (select count(*) from fv_historico.campinas_20261026000001 where antes->>'seller_id'='456a2633-a6bd-4c85-aadd-ee379696bc18') <> 105
    or (select sum((antes->>'total')::numeric) from fv_historico.campinas_20261026000001 where antes->>'seller_id'='456a2633-a6bd-4c85-aadd-ee379696bc18') is distinct from 52526.62::numeric
    or (select sum((antes->>'total')::numeric) from fv_historico.campinas_20261026000001 where antes->>'seller_id'='f5a59aab-8409-4a52-a6f4-e5dff887f7b5') is distinct from 14044::numeric then
    raise exception 'GUARDA: conteudo do snapshot divergente';
  end if;
  if not exists(select 1 from fv_historico.campinas_20261026000001 b left join fv.sales s on s.id=b.sale_id
    where to_jsonb(s) is distinct from b.antes) then
    raise notice 'Ja revertida'; return;
  end if;
  if exists(select 1 from fv_historico.campinas_20261026000001 b left join fv.sales s on s.id=b.sale_id
    where to_jsonb(s) is distinct from b.depois) then
    raise exception 'GUARDA: venda alterada depois da correcao';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='fv.sales'::regclass and tgname='sales_check_seller' and tgenabled='O') then
    raise exception 'GUARDA: trigger divergente';
  end if;
  -- Autorização do orquestrador, 26/10: apenas DOWN administrativo.
  -- O lock bloqueia concorrência. ALTER TABLE exige privilégio de dono.
  -- Exceção/erro aborta a transação e restaura também o estado do trigger.
  alter table fv.sales disable trigger sales_check_seller;
  update fv.sales s set seller_id=(b.antes->>'seller_id')::uuid,seller_person_id=null
    from fv_historico.campinas_20261026000001 b where s.id=b.sale_id and to_jsonb(s)=b.depois;
  get diagnostics n = row_count;
  alter table fv.sales enable trigger sales_check_seller;
  if n <> 131 or exists(select 1 from fv_historico.campinas_20261026000001 b left join fv.sales s on s.id=b.sale_id
    where to_jsonb(s) is distinct from b.antes) then
    raise exception 'GUARDA: reversao divergente';
  end if;
  raise notice 'REVERTIDA: 131 vendas integralmente iguais ao snapshot anterior';
end $$;
notify pgrst, 'reload schema';
