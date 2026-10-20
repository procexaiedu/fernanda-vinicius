-- ─────────────────────────────────────────────────────────────────────────────
-- Fluxo de caixa: despesa PAGA sai no dia do pagamento — 20/10/2026
--
-- POR QUÊ (chamado #3 da Eleandra): a conta da Neoenergia vence 09/11 e foi
-- paga em 06/10. O dinheiro saiu em 06/10, mas o fluxo tirava a despesa no
-- vencimento (ou no lançamento, se não tivesse vencimento). Em 20/10/2026, 170
-- das 434 despesas pagas caíam num dia diferente do pagamento.
--
-- REGRA (decidida com o dono):
--   * despesa manual paga      -> dia do pagamento, paid_at no fuso de Brasília
--     (o app grava "pago em" ao meio-dia de Brasília; ver pagoEm em actions.ts)
--   * pendente                 -> vencimento (ou lançamento, se não tiver)
--
-- DUAS EXCEÇÕES, que ficam como antes (vencimento, ou lançamento):
--   * COMPRA (reference_type purchase): "pago" lá quer dizer quitado com cheque
--     pré-datado ou cartão no ato do cadastro; o dinheiro sai no vencimento do
--     cheque. 131 de 386 compras pagas têm paid_at = dia do cadastro e
--     vencimento meses depois. Usar paid_at as tiraria do caixa cedo demais.
--   * DESPESA MANUAL ANTIGA sem vencimento (47 em 20/10/2026): foram lançadas
--     antes de existir o campo "Pago em", com paid_at = hora do cadastro (24
--     delas lançadas em lote em 10/10 com datas de setembro). A data que a
--     Eleandra digitou (transaction_date) é a melhor pista do pagamento real.
--     O app agora exige vencimento, então toda despesa nova cai na regra.
-- Só a CTE `saidas` muda. Mesma assinatura: grants continuam valendo.
--
-- Volta: 20261020_fluxo_despesa_paga_no_pagamento.down.sql
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fv.fluxo_caixa(p_loja uuid, p_de date, p_ate date)
returns table (
  dia date,
  pix_dinheiro numeric,     -- entra no dia da venda
  cartao_bruto numeric,
  cartao_taxa numeric,
  cartao_liquido numeric,
  outras_entradas numeric,  -- receitas manuais (não venda)
  saidas numeric            -- paga: dia do pagamento; pendente: vencimento
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
    select x.dia, sum(x.amount) v
      from (
        select t.amount,
               case when t.status = 'completed' and t.paid_at is not null
                     and coalesce(t.reference_type, 'manual') = 'manual' and t.due_date is not null
                    then (t.paid_at at time zone 'America/Sao_Paulo')::date
                    else coalesce(t.due_date, t.transaction_date)
               end as dia
          from fv.transactions t
         where t.type = 'expense'
           and (p_loja is null or t.store_id = p_loja)
      ) x
     where x.dia between p_de and p_ate
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

