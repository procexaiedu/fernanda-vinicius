-- Número de etiqueta digitado à mão (reintegração) acima do contador avança o
-- contador. Assim uma compra futura nunca gera o mesmo número.
create or replace function fv.avancar_contador_etiqueta() returns trigger
language plpgsql security definer set search_path = fv, pg_temp as $$
declare
  numero bigint;
begin
  if new.barcode_number ~ '^[0-9]{1,15}$' then
    numero := new.barcode_number::bigint;
    if numero > (select last_value from fv.products_barcode_seq) then
      perform setval('fv.products_barcode_seq', numero);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_avancar_contador_etiqueta on fv.products;
create trigger trg_avancar_contador_etiqueta
before insert or update of barcode_number on fv.products
for each row execute function fv.avancar_contador_etiqueta();
