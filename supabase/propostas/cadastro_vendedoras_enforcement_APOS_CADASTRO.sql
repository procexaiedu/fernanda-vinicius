-- OPCIONAL, NÃO aplicar junto da primeira migration.
-- Apenas após trocar TODAS as instâncias antigas, cadastrar as pessoas reais
-- pela administração e validar PDV. Não converte nem modifica histórico.
begin;
create or replace function fv.check_sale_seller() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.seller_person_id is not distinct from old.seller_person_id
      and new.seller_id is not distinct from old.seller_id and new.store_id = old.store_id then return new; end if;
  end if;
  if new.seller_person_id is null or new.seller_id is not null then raise exception 'Escolha uma vendedora cadastrada'; end if;
  perform 1 from fv.sellers s where s.id = new.seller_person_id and s.store_id = new.store_id and s.is_active for share;
  if not found then raise exception 'Vendedora invalida, inativa ou de outra loja'; end if;
  return new;
end $$;
revoke all on function fv.check_sale_seller() from public, anon, authenticated;
commit;
