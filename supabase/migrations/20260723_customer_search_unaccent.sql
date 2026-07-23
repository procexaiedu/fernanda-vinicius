-- Busca de clientes server-side, sem acento (unaccent) e por telefone/CPF.
-- Permite não carregar toda a base de clientes no front (carrega menos).
create extension if not exists unaccent;

create or replace function fv.search_customers(term text, lim int default 20)
returns table (id uuid, name text, phone text, cpf text, birthday date)
language sql
stable
security definer
set search_path = fv, public, extensions
as $$
  select c.id, c.name, c.phone, c.cpf, c.birthday
  from fv.customers c
  where
    unaccent(c.name) ilike '%' || unaccent(coalesce(term, '')) || '%'
    or (
      regexp_replace(coalesce(term, ''), '\D', '', 'g') <> ''
      and (
        regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || regexp_replace(term, '\D', '', 'g') || '%'
        or regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') like '%' || regexp_replace(term, '\D', '', 'g') || '%'
      )
    )
  order by c.name
  limit lim;
$$;
