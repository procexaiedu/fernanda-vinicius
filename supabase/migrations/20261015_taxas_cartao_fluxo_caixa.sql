-- ─────────────────────────────────────────────────────────────────────────────
-- Taxas de cartão + recebimentos previstos (fluxo de caixa) — 15/10/2026
--
-- POR QUÊ: a venda grava em fv.transactions uma entrada por forma de pagamento
-- já paga, valor cheio, no dia da venda. Para o cartão isso é falso: o dinheiro
-- cai depois, parcela a parcela, descontada a taxa da maquininha. A gestora
-- precisa saber QUANTO cai e QUANDO, e conferir toda semana o que caiu.
--
-- DECISÕES (dev + gestora, 14/10/2026):
--   * TAXA É DA LOJA (regra do dev, 14/10): na FV nada é global; Campinas e
--     Brasília não compartilham configuração. Cada loja tem a sua grade; a venda
--     usa a taxa da loja dela. Loja nova nasce SEM taxa (líquido = bruto + aviso).
--   * Uma máquina só: Laranjinha. Taxas reais da planilha enviada pela Eleandra
--     (13-10-2026 - taxas_cartao_laranjinha.xlsx), por BANDEIRA, até 6x.
--   * Crédito: parcela k cai em data da venda + 31*k dias corridos.
--     Débito: 1 dia útil (sábado e domingo pulam; feriado não é tratado).
--   * 7x a 12x e Hipercard: sem taxa cadastrada → líquido = bruto e o
--     recebimento fica marcado "sem taxa" (fee_pct NULL) para a tela avisar.
--   * Bandeira não informada no PDV (é opcional): usa a linha 'nao_informada',
--     semeada com a taxa de Visa/Master (a mais comum).
--   * Pix e dinheiro entram no dia (não passam por aqui).
--   * Vendas antigas: só gera o que ainda NÃO caiu (parcelas de hoje em diante).
--
-- NÃO MEXE em PDV nem em fv.salvar_venda: o gatilho AFTER INSERT em
-- fv.sale_payments cria os recebimentos. Editar venda apaga e regrava os
-- pagamentos, então os recebimentos se refazem (on delete cascade).
-- O Resultado (P&L) continua bruto; a taxa só aparece no fluxo de caixa.
--
-- Volta: 20261015_taxas_cartao_fluxo_caixa.down.sql
-- Teste: supabase/tests/20261015_taxas_cartao_fluxo_caixa.test.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. Cadastro de taxas ────────────────────────────────────────────────────────
create table if not exists fv.card_fees (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references fv.stores(id) on delete cascade,
  acquirer      text not null default 'Laranjinha',
  card_type     text not null check (card_type in ('debit', 'credit')),
  brand         text not null,
  installments  smallint not null check (installments between 1 and 12),
  fee_pct       numeric(6,4) not null check (fee_pct >= 0 and fee_pct < 100),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references fv.users(id) on delete set null,
  unique (store_id, acquirer, card_type, brand, installments),
  check (card_type = 'credit' or installments = 1)
);

comment on table fv.card_fees is
  'Taxa da maquininha POR LOJA, bandeira, modalidade e parcelas. Sem linha = sem taxa (líquido = bruto, aviso na tela).';
comment on column fv.card_fees.fee_pct is 'Percentual (2.81 = 2,81%).';
comment on column fv.card_fees.brand is
  'Bandeira como o PDV grava (visa, mastercard, elo, amex...). nao_informada = venda sem bandeira.';

create temp table _seed_taxas (brand text, card_type text, installments smallint, fee_pct numeric) on commit drop;
insert into _seed_taxas (brand, card_type, installments, fee_pct) values
  ('mastercard', 'debit', 1, 0.91),
  ('mastercard', 'credit', 1, 2.57),
  ('mastercard', 'credit', 2, 2.81),
  ('mastercard', 'credit', 3, 2.81),
  ('mastercard', 'credit', 4, 2.81),
  ('mastercard', 'credit', 5, 2.81),
  ('mastercard', 'credit', 6, 2.81),
  ('visa', 'debit', 1, 0.91),
  ('visa', 'credit', 1, 2.57),
  ('visa', 'credit', 2, 2.81),
  ('visa', 'credit', 3, 2.81),
  ('visa', 'credit', 4, 2.81),
  ('visa', 'credit', 5, 2.81),
  ('visa', 'credit', 6, 2.81),
  ('credz', 'credit', 1, 2.95),
  ('credz', 'credit', 2, 3.37),
  ('credz', 'credit', 3, 3.37),
  ('credz', 'credit', 4, 3.37),
  ('credz', 'credit', 5, 3.37),
  ('credz', 'credit', 6, 3.37),
  ('jcb', 'credit', 1, 2.95),
  ('jcb', 'credit', 2, 3.37),
  ('jcb', 'credit', 3, 3.37),
  ('jcb', 'credit', 4, 3.37),
  ('jcb', 'credit', 5, 3.37),
  ('jcb', 'credit', 6, 3.37),
  ('banescard', 'credit', 1, 3.37),
  ('banescard', 'credit', 2, 3.61),
  ('banescard', 'credit', 3, 3.61),
  ('banescard', 'credit', 4, 3.61),
  ('banescard', 'credit', 5, 3.61),
  ('banescard', 'credit', 6, 3.61),
  ('cup', 'credit', 1, 3.37),
  ('sorocred', 'credit', 1, 2.95),
  ('sorocred', 'credit', 2, 3.37),
  ('sorocred', 'credit', 3, 3.37),
  ('sorocred', 'credit', 4, 3.37),
  ('sorocred', 'credit', 5, 3.37),
  ('sorocred', 'credit', 6, 3.37),
  ('sicredi', 'debit', 1, 1.86),
  ('sicredi', 'credit', 1, 2.95),
  ('sicredi', 'credit', 2, 3.37),
  ('sicredi', 'credit', 3, 3.37),
  ('sicredi', 'credit', 4, 3.37),
  ('sicredi', 'credit', 5, 3.37),
  ('sicredi', 'credit', 6, 3.37),
  ('amex', 'credit', 1, 3.37),
  ('amex', 'credit', 2, 3.61),
  ('amex', 'credit', 3, 3.61),
  ('amex', 'credit', 4, 3.61),
  ('amex', 'credit', 5, 3.61),
  ('amex', 'credit', 6, 3.61),
  ('diners', 'credit', 1, 3.37),
  ('diners', 'credit', 2, 3.61),
  ('diners', 'credit', 3, 3.61),
  ('diners', 'credit', 4, 3.61),
  ('diners', 'credit', 5, 3.61),
  ('diners', 'credit', 6, 3.61),
  ('cabal', 'debit', 1, 1.71),
  ('cabal', 'credit', 1, 3.37),
  ('cabal', 'credit', 2, 3.61),
  ('cabal', 'credit', 3, 3.61),
  ('cabal', 'credit', 4, 3.61),
  ('cabal', 'credit', 5, 3.61),
  ('cabal', 'credit', 6, 3.61),
  ('elo', 'debit', 1, 1.71),
  ('elo', 'credit', 1, 3.37),
  ('elo', 'credit', 2, 3.61),
  ('elo', 'credit', 3, 3.61),
  ('elo', 'credit', 4, 3.61),
  ('elo', 'credit', 5, 3.61),
  ('elo', 'credit', 6, 3.61)
;

-- Sem bandeira no PDV → taxa de Visa/Master.
insert into _seed_taxas select 'nao_informada', card_type, installments, fee_pct from _seed_taxas where brand = 'visa';

-- A mesma planilha para cada loja que existe hoje; daqui em diante cada uma edita a sua.
insert into fv.card_fees (store_id, brand, card_type, installments, fee_pct)
select st.id, x.brand, x.card_type, x.installments, x.fee_pct
  from fv.stores st cross join _seed_taxas x
on conflict (store_id, acquirer, card_type, brand, installments) do nothing;

-- 2. Recebimentos previstos ───────────────────────────────────────────────────
create table if not exists fv.card_receivables (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references fv.sales(id) on delete cascade,
  sale_payment_id     uuid not null references fv.sale_payments(id) on delete cascade,
  store_id            uuid not null references fv.stores(id),
  card_type           text not null check (card_type in ('debit', 'credit')),
  brand               text,
  installment_number  smallint not null,
  installments_total  smallint not null,
  gross_amount        numeric(12,2) not null,
  fee_pct             numeric(6,4),             -- NULL = sem taxa cadastrada
  fee_amount          numeric(12,2) not null default 0,
  net_amount          numeric(12,2) not null,
  expected_date       date not null,
  status              text not null default 'previsto'
                      check (status in ('previsto', 'recebido', 'divergente')),
  received_amount     numeric(12,2),
  received_at         date,
  conciliated_by      uuid references fv.users(id) on delete set null,
  conciliated_at      timestamptz,
  created_at          timestamptz not null default now(),
  unique (sale_payment_id, installment_number)
);

create index if not exists idx_card_receivables_loja_data
  on fv.card_receivables (store_id, expected_date);

-- 3. A conta das parcelas (pura, testável) ────────────────────────────────────
-- Os TOTAIS ficam exatos: taxa total = round(bruto * taxa, 2), líquido = bruto - taxa. Bruto e
-- líquido são divididos em n partes iguais e a sobra de centavos vai na 1ª.
create or replace function fv.calcular_recebimentos(
  p_valor       numeric,
  p_parcelas    int,
  p_taxa_pct    numeric,    -- NULL = sem taxa
  p_data_venda  date,
  p_tipo        text        -- 'debit' | 'credit'
)
returns table (parcela int, data_prevista date, bruto numeric, taxa numeric, liquido numeric)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_n int := greatest(1, coalesce(p_parcelas, 1));
  v_liq_total numeric := p_valor - round(p_valor * coalesce(p_taxa_pct, 0) / 100, 2);
  v_bruto_parc numeric := trunc(p_valor / v_n, 2);
  v_liq_parc numeric := trunc(v_liq_total / v_n, 2);
  v_data date;
  k int;
  b numeric;
  l numeric;
begin
  if p_tipo = 'debit' then v_n := 1; v_bruto_parc := p_valor; v_liq_parc := v_liq_total; end if;
  for k in 1..v_n loop
    if p_tipo = 'debit' then
      v_data := p_data_venda + 1;
      while extract(isodow from v_data) in (6, 7) loop v_data := v_data + 1; end loop;
    else
      v_data := p_data_venda + 31 * k;
    end if;
    b := v_bruto_parc; l := v_liq_parc;
    if k = 1 then
      b := p_valor - v_bruto_parc * (v_n - 1);
      l := v_liq_total - v_liq_parc * (v_n - 1);
    end if;
    parcela := k; data_prevista := v_data; bruto := b; liquido := l; taxa := b - l;
    return next;
  end loop;
end $$;

-- 4. Gera os recebimentos de um pagamento ─────────────────────────────────────
-- p_so_futuros: no backfill, só parcelas que ainda não caíram.
create or replace function fv.gerar_recebimentos_cartao(p_payment_id uuid, p_so_futuros boolean default false)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pag  fv.sale_payments%rowtype;
  v_sale fv.sales%rowtype;
  v_brand text;
  v_n int;
  v_taxa numeric;
  v_qtd int;
begin
  select * into v_pag from fv.sale_payments where id = p_payment_id;
  if not found or v_pag.payment_method not in ('credit', 'debit') or v_pag.amount <= 0 then
    return 0;
  end if;
  select * into v_sale from fv.sales where id = v_pag.sale_id;

  v_n := case when v_pag.payment_method = 'debit' then 1 else greatest(1, coalesce(v_pag.installments, 1)) end;
  v_brand := coalesce(nullif(lower(trim(v_pag.card_brand)), ''), 'nao_informada');

  select f.fee_pct into v_taxa from fv.card_fees f
   where f.store_id = v_sale.store_id
     and f.acquirer = 'Laranjinha' and f.card_type = v_pag.payment_method
     and f.brand = v_brand and f.installments = v_n;

  delete from fv.card_receivables where sale_payment_id = p_payment_id;

  insert into fv.card_receivables (
    sale_id, sale_payment_id, store_id, card_type, brand, installment_number,
    installments_total, gross_amount, fee_pct, fee_amount, net_amount, expected_date)
  select v_pag.sale_id, v_pag.id, v_sale.store_id, v_pag.payment_method, v_brand, c.parcela,
         v_n, c.bruto, v_taxa, c.taxa, c.liquido, c.data_prevista
    from fv.calcular_recebimentos(v_pag.amount, v_n, v_taxa,
           (v_sale.sale_date at time zone 'America/Sao_Paulo')::date, v_pag.payment_method) c
   where not p_so_futuros or c.data_prevista >= (now() at time zone 'America/Sao_Paulo')::date;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

create or replace function fv.tg_sale_payment_recebimentos()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform fv.gerar_recebimentos_cartao(new.id, false);
  return null;
end $$;

drop trigger if exists sale_payment_recebimentos on fv.sale_payments;
create trigger sale_payment_recebimentos
  after insert on fv.sale_payments
  for each row execute function fv.tg_sale_payment_recebimentos();

-- 5. Backfill: vendas no cartão que ainda não caíram ──────────────────────────
select fv.gerar_recebimentos_cartao(sp.id, true)
  from fv.sale_payments sp
  join fv.sales s on s.id = sp.sale_id
 where sp.payment_method in ('credit', 'debit')
   and s.status <> 'cancelled'
   and not exists (select 1 from fv.card_receivables r where r.sale_payment_id = sp.id)
   and (s.sale_date at time zone 'America/Sao_Paulo')::date + 31 * greatest(1, coalesce(sp.installments, 1))
       >= (now() at time zone 'America/Sao_Paulo')::date - 1;

-- 6. Fluxo de caixa por dia ───────────────────────────────────────────────────
-- p_loja NULL = rede inteira (só o admin global chega aqui sem loja; quem
-- decide o escopo é o servidor, lojaDoEscopo). Venda cancelada não entra.
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
    select (s.sale_date at time zone 'America/Sao_Paulo')::date as dia, sum(sp.amount) as v
      from fv.sale_payments sp join fv.sales s on s.id = sp.sale_id
     where sp.payment_method in ('pix', 'cash') and s.status <> 'cancelled'
       and (p_loja is null or s.store_id = p_loja)
       and s.sale_date >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and s.sale_date <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
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

-- Conciliação em lote: "caiu certinho" = recebido pelo líquido previsto.
-- p_loja NULL só para o admin global; o servidor decide (lojaDoEscopo).
create or replace function fv.conciliar_recebimentos(p_ids uuid[], p_loja uuid, p_data date, p_user uuid)
returns int
language sql security definer
set search_path = ''
as $$
  with u as (
    update fv.card_receivables r
       set status = 'recebido', received_amount = r.net_amount, received_at = p_data,
           conciliated_by = p_user, conciliated_at = now()
     where r.id = any(p_ids) and (p_loja is null or r.store_id = p_loja)
    returning 1
  )
  select count(*)::int from u
$$;

-- 7. Permissões e RLS ─────────────────────────────────────────────────────────
-- O app lê e grava com service_role (servidor, escopo por lojaDoEscopo).
-- Pela API com sessão: taxas e recebimentos → admin da loja (mesma regra de
-- fv.transactions); o global vê as duas.
alter table fv.card_fees enable row level security;
alter table fv.card_receivables enable row level security;

drop policy if exists card_fees_admin_loja on fv.card_fees;
create policy card_fees_admin_loja on fv.card_fees for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

drop policy if exists card_receivables_admin_loja on fv.card_receivables;
create policy card_receivables_admin_loja on fv.card_receivables for all to authenticated
  using      ((select fv.is_admin()) and fv.pode_ver_loja(store_id))
  with check ((select fv.is_admin()) and fv.pode_ver_loja(store_id));

grant select, insert, update, delete on fv.card_fees, fv.card_receivables to authenticated;
grant all on fv.card_fees, fv.card_receivables to service_role;

-- RPCs só pelo servidor (padrão do fv: nenhuma é executável por authenticated).
revoke all on function fv.calcular_recebimentos(numeric, int, numeric, date, text) from public;
revoke all on function fv.gerar_recebimentos_cartao(uuid, boolean) from public;
revoke all on function fv.tg_sale_payment_recebimentos() from public;
revoke all on function fv.fluxo_caixa(uuid, date, date) from public;
grant execute on function fv.calcular_recebimentos(numeric, int, numeric, date, text) to service_role;
grant execute on function fv.gerar_recebimentos_cartao(uuid, boolean) to service_role;
grant execute on function fv.fluxo_caixa(uuid, date, date) to service_role;
revoke all on function fv.conciliar_recebimentos(uuid[], uuid, date, uuid) from public;
grant execute on function fv.conciliar_recebimentos(uuid[], uuid, date, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
