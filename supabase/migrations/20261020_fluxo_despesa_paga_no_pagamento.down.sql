-- Volta de 20261020_fluxo_despesa_paga_no_pagamento.sql: despesas voltam a sair no vencimento.

create or replace function fv.fluxo_caixa(p_loja uuid, p_de date, p_ate date)
returns table (
  dia date,
  pix_dinheiro numeric,     -- entra no dia da venda
  cartao_bruto numeric,
  cartao_taxa numeric,
  cartao_liquido numeric,
  outras_entradas numeric,  -- receitas manuais (não venda)
  saidas numeric            -- despesas pelo vencimento (ou data, se não tiver)
)
language sql stable security definer
set search_path = ''
as $$
  with dias as (
    select d::date as dia from generate_series(p_de, p_ate, interval '1 day') d
  ),
  vendas as (
    select (s.sale_date at time zone 'UTC')::date as dia, sum(sp.amount) as v
      from fv.sale_payments sp join fv.sales s on s.id = sp.sale_id
     where sp.payment_method in ('pix', 'cash') and s.status <> 'cancelled'
       and (p_loja is null or s.store_id = p_loja)
       and s.sale_date >= (p_de::timestamp at time zone 'UTC')
       and s.sale_date <  ((p_ate + 1)::timestamp at time zone 'UTC')
     group by 1
  ),
  cartao as (
    select r.expected_date as dia, sum(r.gross_amount) b, sum(r.fee_amount) t, sum(r.net_amount) l
      from fv.card_receivables r join fv.sales s on s.id = r.sale_id
     where r.expected_date between p_de and p_ate and s.status <> 'cancelled'
       and (p_loja is null or r.store_id = p_loja)
     group by 1
  ),
  outras as (
    select t.transaction_date as dia, sum(t.amount) v
      from fv.transactions t
     where t.type = 'income' and coalesce(t.reference_type, 'manual') <> 'sale'
       and t.transaction_date between p_de and p_ate
       and (p_loja is null or t.store_id = p_loja)
     group by 1
  ),
  saidas as (
    select coalesce(t.due_date, t.transaction_date) as dia, sum(t.amount) v
      from fv.transactions t
     where t.type = 'expense'
       and coalesce(t.due_date, t.transaction_date) between p_de and p_ate
       and (p_loja is null or t.store_id = p_loja)
     group by 1
  )
  select d.dia,
         coalesce(v.v, 0), coalesce(c.b, 0), coalesce(c.t, 0), coalesce(c.l, 0),
         coalesce(o.v, 0), coalesce(s.v, 0)
    from dias d
    left join vendas v on v.dia = d.dia
    left join cartao c on c.dia = d.dia
    left join outras o on o.dia = d.dia
    left join saidas s on s.dia = d.dia
   order by d.dia
$$;

