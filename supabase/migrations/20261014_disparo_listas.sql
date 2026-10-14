-- Listas salvas de destinatários de disparo (14/10/2026).
--
-- Uma lista é um grupo de clientes da loja guardado com nome (ex.: "Responderam
-- positivo — 16/09"). Na tela Novo disparo, escolher a lista marca de uma vez
-- as clientes dela que não estão na lista de exclusão. A lista NÃO fura a
-- exclusão: quem envia continua passando por `fv.disparo_excluido` nas RPCs.
--
-- Mesmo padrão de fv.disparo_exclusoes: RLS ligada e sem policy, então só o
-- servidor (service_role) lê e escreve; a tela passa pelas actions, que só
-- aceitam admin e cortam pela loja da sessão. `fv.customers` não é tocada.
--
-- Volta: 20261014_disparo_listas.down.sql

create table if not exists fv.disparo_listas (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references fv.stores(id),
  nome       text not null check (length(trim(nome)) > 0),
  descricao  text,
  criado_em  timestamptz not null default now(),
  criado_por uuid,
  ativa      boolean not null default true
);

-- Nome único por loja entre as ativas: é o que a carga usa para ser idempotente.
create unique index if not exists disparo_listas_nome_uk
  on fv.disparo_listas (store_id, nome) where ativa;

create table if not exists fv.disparo_lista_itens (
  lista_id    uuid not null references fv.disparo_listas(id) on delete cascade,
  customer_id uuid not null references fv.customers(id) on delete cascade,
  primary key (lista_id, customer_id)
);

-- Item tem que ser cliente da MESMA loja da lista (lojas isoladas).
create or replace function fv.disparo_lista_item_mesma_loja()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from fv.disparo_listas l join fv.customers c on c.origin_store_id = l.store_id
    where l.id = new.lista_id and c.id = new.customer_id
  ) then
    raise exception 'Cliente % não é da loja da lista %', new.customer_id, new.lista_id;
  end if;
  return new;
end $$;

drop trigger if exists disparo_lista_item_mesma_loja on fv.disparo_lista_itens;
create trigger disparo_lista_item_mesma_loja
  before insert or update on fv.disparo_lista_itens
  for each row execute function fv.disparo_lista_item_mesma_loja();

alter table fv.disparo_listas enable row level security;
alter table fv.disparo_lista_itens enable row level security;
grant all on fv.disparo_listas, fv.disparo_lista_itens to service_role;

notify pgrst, 'reload schema';
