-- ============================================================================
-- Despesa por loja: a compra passa a ter dono
-- ============================================================================
--
-- O dashboard mostrava, no mesmo mês: "Todas as lojas" com −R$86 mil, Campinas
-- positiva e Brasília zerada. Três números que não podem coexistir se um for a
-- soma dos outros — e não eram.
--
-- A causa: TODA despesa do sistema é compra de fornecedor (297 lançamentos,
-- R$105.041,73) e TODA ELA está com `store_id` nulo. A compra é uma ida a São
-- Paulo que abastece as duas lojas, então o cabeçalho nasce sem loja. O
-- resultado é que a despesa só aparecia em "Todas as lojas": ao filtrar por
-- Campinas, sobrava a receita sozinha e a loja parecia lucrar tudo.
--
--
-- POR QUE UMA VIEW E NÃO `UPDATE transactions SET store_id = ...`
--
-- Porque a transação é o PAGAMENTO, não a mercadoria. Um cheque de R$3.000
-- pode cobrir peças das duas lojas. Gravar uma loja nele seria mentira; quebrá-
-- lo em duas linhas seria pior — o financeiro mostraria duas contas a pagar
-- onde existe um cheque só, e ela pagaria errado.
--
-- A view resolve no momento da leitura: o pagamento continua inteiro para quem
-- paga, e rateado para quem analisa.
--
--
-- DE ONDE VEM A LOJA
--
-- De `products.store_id` — cada linha da compra já diz para qual loja a peça
-- vai, porque o grid tem a coluna de loja. Hoje as 16 compras são 100%
-- Campinas e nenhuma é multiloja, mas isso muda no dia em que Brasília entrar,
-- e aí o rateio já está de pé.
-- ============================================================================


-- Quanto de cada compra pertence a cada loja, em valor e em proporção.
CREATE OR REPLACE VIEW fv.compra_rateio_loja AS
WITH por_loja AS (
  SELECT pi.purchase_id,
         pr.store_id,
         sum(pi.subtotal) AS valor
    FROM fv.purchase_items pi
    JOIN fv.products pr ON pr.id = pi.product_id
   GROUP BY pi.purchase_id, pr.store_id
)
SELECT purchase_id,
       store_id,
       valor,
       -- NULLIF protege a compra de valor zero (só brinde/conserto): sem ele,
       -- divisão por zero derruba a view inteira por causa de uma linha.
       valor / NULLIF(sum(valor) OVER (PARTITION BY purchase_id), 0) AS proporcao
  FROM por_loja;

COMMENT ON VIEW fv.compra_rateio_loja IS
  'Fatia de cada compra que pertence a cada loja, pela loja de destino das peças.';


-- As despesas já rateadas, prontas para filtrar por loja.
--
-- Uma linha por (pagamento × loja) quando é compra; uma linha só para o resto.
-- Despesa que não é compra e não tem loja (aluguel da rede, por exemplo)
-- aparece com store_id nulo e fica de fora do filtro por loja — é o
-- comportamento correto: ninguém deve atribuí-la a uma loja por conta própria.
CREATE OR REPLACE VIEW fv.despesas_por_loja AS
SELECT t.id                          AS transaction_id,
       t.transaction_date,
       t.due_date,
       t.status,
       t.category,
       t.description,
       t.payment_method,
       t.reference_type,
       t.reference_id,
       COALESCE(r.store_id, t.store_id) AS store_id,
       CASE WHEN r.proporcao IS NOT NULL
            -- Centavo de arredondamento pode sobrar aqui. Em relatório é
            -- tolerável; o valor exato de quem paga continua em `transactions`.
            THEN round(t.amount * r.proporcao, 2)
            ELSE t.amount
       END                           AS amount,
       (r.proporcao IS NOT NULL)     AS rateado
  FROM fv.transactions t
  LEFT JOIN fv.compra_rateio_loja r
         ON t.reference_type = 'purchase'
        AND r.purchase_id     = t.reference_id
 WHERE t.type = 'expense';

COMMENT ON VIEW fv.despesas_por_loja IS
  'Despesas com a compra de fornecedor rateada pela loja de destino das peças. Use no lugar de transactions ao filtrar despesa por loja.';


-- Schema novo nasce sem GRANT: sem isto, 42501 na cara da usuária.
GRANT SELECT ON fv.compra_rateio_loja, fv.despesas_por_loja
  TO authenticated, service_role;
