-- Teste de 20261015_taxas_cartao_fluxo_caixa.sql. Roda dentro de transação e
-- desfaz tudo no fim. Mesmos casos de src/lib/recebimentos.test.ts.
begin;

do $$
declare
  r record;
  v_sale uuid;
  v_store uuid;
  v_user uuid;
  v_n int;
  v_liq numeric;
begin
  -- 1. A conta pura ─────────────────────────────────────────────────────────
  select array_agg(data_prevista order by parcela)::text as d, array_agg(bruto order by parcela)::text as b,
         array_agg(liquido order by parcela)::text as l, sum(taxa) as t
    into r from fv.calcular_recebimentos(100, 3, 2.81, '2026-10-14', 'credit');
  assert r.d = '{2026-11-14,2026-12-15,2027-01-15}', 'datas 3x: ' || r.d;
  assert r.b = '{33.34,33.33,33.33}', 'bruto 3x: ' || r.b;
  assert r.l = '{32.41,32.39,32.39}', 'liquido 3x: ' || r.l;
  assert r.t = 2.81, 'taxa 3x: ' || r.t;

  select * into r from fv.calcular_recebimentos(250, 1, 2.57, '2026-10-14', 'credit');
  assert r.liquido = 243.57 and r.taxa = 6.43 and r.data_prevista = '2026-11-14', 'à vista';

  select * into r from fv.calcular_recebimentos(100, 3, 0.91, '2026-10-16', 'debit');
  assert r.data_prevista = '2026-10-19' and r.liquido = 99.09, 'débito sexta → segunda';

  select count(*) c, bool_and(taxa = 0) z, max(data_prevista) m into r
    from fv.calcular_recebimentos(700, 7, null, '2026-10-14', 'credit');
  assert r.c = 7 and r.z and r.m = '2027-05-19', 'sem taxa 7x';

  -- 2. O gatilho: pagamento de cartão vira recebimentos; Pix não ─────────────
  select id into v_store from fv.stores limit 1;
  select id into v_user from fv.users limit 1;
  insert into fv.sales (store_id, user_id, sale_date, subtotal, total, total_cost)
       values (v_store, v_user, '2026-10-14 15:00-03', 150, 150, 0) returning id into v_sale;
  insert into fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
       values (v_sale, 'credit', 100, 3, 'visa'), (v_sale, 'pix', 50, 1, null);

  select count(*), sum(net_amount) into v_n, v_liq from fv.card_receivables where sale_id = v_sale;
  assert v_n = 3 and v_liq = 97.19, format('gatilho: %s recebimentos, líquido %s', v_n, v_liq);
  assert (select bool_and(fee_pct = 2.81 and store_id = v_store) from fv.card_receivables where sale_id = v_sale), 'taxa congelada';

  -- Hipercard: sem taxa, fica marcado (fee_pct null)
  insert into fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
       values (v_sale, 'credit', 60, 2, 'hipercard');
  assert (select count(*) from fv.card_receivables where sale_id = v_sale and brand = 'hipercard' and fee_pct is null and net_amount = gross_amount) = 2, 'hipercard sem taxa';

  -- Sem bandeira: taxa de Visa/Master
  insert into fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
       values (v_sale, 'debit', 100, 1, null);
  assert (select net_amount from fv.card_receivables where sale_id = v_sale and card_type = 'debit') = 99.09, 'sem bandeira = visa';

  -- Editar a venda (apaga e regrava pagamentos) refaz os recebimentos
  delete from fv.sale_payments where sale_id = v_sale;
  assert (select count(*) from fv.card_receivables where sale_id = v_sale) = 0, 'cascade';

  -- 3. Fluxo do dia: Pix entra no dia ─────────────────────────────────────────
  insert into fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
       values (v_sale, 'pix', 50, 1, null), (v_sale, 'credit', 100, 3, 'visa');
  select * into r from fv.fluxo_caixa(v_store, '2026-10-14', '2026-10-14');
  assert r.pix_dinheiro >= 50, 'pix no dia';
  select * into r from fv.fluxo_caixa(v_store, '2026-11-14', '2026-11-14');
  assert r.cartao_liquido >= 32.41, 'parcela 1 em +31';

  -- 4. Conciliação em lote respeita a loja
  assert fv.conciliar_recebimentos(array(select id from fv.card_receivables where sale_id = v_sale),
                                   gen_random_uuid(), '2026-11-14', v_user) = 0, 'outra loja não concilia';
  assert fv.conciliar_recebimentos(array(select id from fv.card_receivables where sale_id = v_sale),
                                   v_store, '2026-11-14', v_user) = 3, 'concilia 3';

  -- 5. Taxa é da loja: mudar a da outra loja não mexe nesta
  update fv.card_fees set fee_pct = 9.99
   where store_id <> v_store and brand = 'visa' and card_type = 'credit' and installments = 3;
  insert into fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
       values (v_sale, 'credit', 100, 3, 'visa');
  assert (select bool_and(fee_pct = 2.81) from fv.card_receivables cr join fv.sale_payments sp on sp.id = cr.sale_payment_id
           where cr.sale_id = v_sale and sp.amount = 100 and cr.status = 'previsto'), 'taxa da outra loja vazou';
  update fv.card_fees set fee_pct = 5 where store_id = v_store and brand = 'visa' and card_type = 'credit' and installments = 2;
  insert into fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
       values (v_sale, 'credit', 100, 2, 'visa');
  assert (select sum(net_amount) from fv.card_receivables cr join fv.sale_payments sp on sp.id = cr.sale_payment_id
           where sp.sale_id = v_sale and sp.installments = 2 and sp.card_brand = 'visa') = 95, 'usa a taxa da própria loja';
  assert (select count(distinct store_id) from fv.card_fees) = (select count(*) from fv.stores), 'cada loja tem a sua grade';

  raise notice 'OK: taxas_cartao_fluxo_caixa';
end $$;

rollback;
