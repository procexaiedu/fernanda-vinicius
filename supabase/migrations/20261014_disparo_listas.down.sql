-- Volta de 20261014_disparo_listas.sql.
drop table if exists fv.disparo_lista_itens;
drop table if exists fv.disparo_listas;
drop function if exists fv.disparo_lista_item_mesma_loja();
notify pgrst, 'reload schema';
