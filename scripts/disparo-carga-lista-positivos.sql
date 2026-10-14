-- Carga da lista salva "Responderam positivo — 16/09" (Brasília), 14/10/2026.
-- Fonte: fevinicius-respostas-positivas.csv (respostas POSITIVA de 16/09), só telefones.
-- Idempotente: cria a lista se não existir e só acrescenta itens que faltam.
-- Entra só cliente da loja de Brasília cujo telefone bate e que NÃO está na
-- exclusão ativa (os opt-outs de 16/09 já foram carregados em fv.disparo_exclusoes).
-- Pré-requisito: migração 20261014_disparo_listas.sql. Volta: apagar a lista (cascade).
begin;

create temp table _tel (e164 text primary key) on commit drop;
insert into _tel values
  ('+556181116116'),
  ('+556181118248'),
  ('+556181182222'),
  ('+556181190946'),
  ('+556181227155'),
  ('+556181268101'),
  ('+556181364105'),
  ('+556181410160'),
  ('+556181434268'),
  ('+556181547252'),
  ('+556181574718'),
  ('+556181590900'),
  ('+556181620886'),
  ('+556181656527'),
  ('+556181881603'),
  ('+556181991366'),
  ('+556182094884'),
  ('+556182191213'),
  ('+556182384888'),
  ('+556182406212'),
  ('+556182748822'),
  ('+556183637788'),
  ('+556184553626'),
  ('+556184847185'),
  ('+556184940484'),
  ('+556185137006'),
  ('+556191414285'),
  ('+556191617892'),
  ('+556191621616'),
  ('+556192498285'),
  ('+556192699732'),
  ('+556192759219'),
  ('+556194422121'),
  ('+556196181805'),
  ('+556196376695'),
  ('+556196459017'),
  ('+556196459396'),
  ('+556196861101'),
  ('+556199221222'),
  ('+556199399759'),
  ('+556199459118'),
  ('+556199514322'),
  ('+556199591359'),
  ('+556199652700'),
  ('+556199659579'),
  ('+556199723350'),
  ('+556199811003'),
  ('+556199820787'),
  ('+556199821010'),
  ('+556199824097'),
  ('+556199839043'),
  ('+556199845433'),
  ('+556199866974'),
  ('+556199875672'),
  ('+556199944649'),
  ('+556199947887');

with loja as (select id from fv.stores where name = 'Brasília'),
lista as (
  insert into fv.disparo_listas (store_id, nome, descricao)
  select id, 'Responderam positivo — 16/09', 'Responderam positivo ao disparo de 16/09/2026 (menos opt-outs).' from loja
  on conflict (store_id, nome) where ativa do nothing
  returning id
)
select 1;

-- O CSV traz o celular SEM o 9 (+55 61 9959-1359) e o cadastro com ele: casa
-- por DDD + 8 últimos dígitos (conferido em produção 14/10: 56 de 56, 1 para 1).
insert into fv.disparo_lista_itens (lista_id, customer_id)
select distinct l.id, c.id
from fv.disparo_listas l
join (select id, origin_store_id, regexp_replace(phone, '\D', '', 'g') d from fv.customers) c
  on c.origin_store_id = l.store_id
join _tel t on substr(t.e164, 4, 2) || right(t.e164, 8) =
  (case when c.d ~ '^55' and length(c.d) in (12, 13) then substr(c.d, 3, 2)
        when length(c.d) in (10, 11) then substr(c.d, 1, 2) end) || right(c.d, 8)
where l.nome = 'Responderam positivo — 16/09' and l.ativa
  and l.store_id = (select id from fv.stores where name = 'Brasília')
  and not exists (select 1 from fv.disparo_exclusoes e
                  where e.store_id = l.store_id and e.removido_em is null
                    and substr(e.telefone_e164, 4, 2) || right(e.telefone_e164, 8) = substr(t.e164, 4, 2) || right(t.e164, 8))
on conflict do nothing;

-- Conferência: telefones do CSV na lista, fora por exclusão, e sem cliente.
select (select count(*) from fv.disparo_lista_itens i join fv.disparo_listas l on l.id = i.lista_id
         where l.nome = 'Responderam positivo — 16/09' and l.ativa) as na_lista,
       (select count(*) from _tel t join fv.disparo_exclusoes e on e.removido_em is null
         and substr(e.telefone_e164, 4, 2) || right(e.telefone_e164, 8) = substr(t.e164, 4, 2) || right(t.e164, 8)
         and e.store_id = (select id from fv.stores where name = 'Brasília')) as fora_por_exclusao,
       (select count(*) from _tel) as telefones_no_csv;

commit;
