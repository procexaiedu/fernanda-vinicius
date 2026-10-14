-- Volta de 20261015_taxas_cartao_fluxo_caixa.sql. Vendas e transações não são tocadas.
begin;
drop trigger if exists sale_payment_recebimentos on fv.sale_payments;
drop function if exists fv.tg_sale_payment_recebimentos();
drop function if exists fv.fluxo_caixa(uuid, date, date);
drop function if exists fv.conciliar_recebimentos(uuid[], uuid, date, uuid);
drop function if exists fv.gerar_recebimentos_cartao(uuid, boolean);
drop function if exists fv.calcular_recebimentos(numeric, int, numeric, date, text);
drop table if exists fv.card_receivables;
drop table if exists fv.card_fees;
commit;
notify pgrst, 'reload schema';
