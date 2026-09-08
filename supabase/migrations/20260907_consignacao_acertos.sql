-- ============================================================================
-- Acertos de consignação: o pagamento parcelado que não tinha onde morar
-- ============================================================================
--
-- Pedido do dono em 07/09: poder clicar no lote e ir registrando o acerto,
-- várias vezes, até fechar o total. É como ela trabalha — vende algumas peças,
-- paga aquelas, e assim por diante.
--
--
-- POR QUE ISTO CONSERTA UM BURACO FINANCEIRO, E NÃO SÓ ADICIONA UMA TELA
--
-- Consignado NÃO é despesa quando chega: a peça ainda é do fornecedor. A
-- despesa nasce no ACERTO, quando o dinheiro sai. Como o acerto não existia em
-- lugar nenhum do sistema, esse dinheiro nunca aparecia no financeiro — nem na
-- entrada (certo) nem depois (errado). O lote nascia 'active' e ficava assim
-- para sempre.
--
-- Por isso cada acerto grava uma `fv.transactions` de despesa. É ele o
-- lançamento que faltava.
--
--
-- POR QUE UMA TABELA E NÃO UMA COLUNA `valor_acertado`
--
-- Uma coluna só guardaria o total e perderia o histórico: quando pagou, quanto,
-- em quê. É justamente o que a dona precisa para conversar com o fornecedor —
-- "te paguei 300 no dia 12 e 250 no dia 30". E permitir DESFAZER um acerto
-- exige saber qual transação ele criou.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fv.consignment_acertos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id  uuid NOT NULL REFERENCES fv.consignments(id) ON DELETE CASCADE,
  acerto_date     date NOT NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_method  text,
  notes           text,
  -- A despesa que este acerto gerou. Guardada para o "remover" desfazer os
  -- dois lados; nula só se a transação tiver sido apagada por fora.
  transaction_id  uuid REFERENCES fv.transactions(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES fv.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consignment_acertos_lote_idx
  ON fv.consignment_acertos (consignment_id, acerto_date DESC);

COMMENT ON TABLE fv.consignment_acertos IS
  'Pagamentos parciais ao fornecedor de um lote consignado. A soma fecha o lote (consignments.status = settled).';

-- Quanto já foi pago e quanto falta em cada lote, para a tela não recalcular.
CREATE OR REPLACE VIEW fv.consignment_saldo AS
SELECT c.id                                             AS consignment_id,
       c.total_cost_value                               AS total,
       COALESCE(sum(a.amount), 0)                       AS acertado,
       c.total_cost_value - COALESCE(sum(a.amount), 0)  AS falta,
       count(a.id)                                      AS qtd_acertos
  FROM fv.consignments c
  LEFT JOIN fv.consignment_acertos a ON a.consignment_id = c.id
 GROUP BY c.id, c.total_cost_value;

COMMENT ON VIEW fv.consignment_saldo IS
  'Total, já acertado e quanto falta por lote consignado.';

-- Schema novo nasce sem GRANT: sem isto, 42501 na cara da usuária.
GRANT SELECT, INSERT, UPDATE, DELETE ON fv.consignment_acertos TO authenticated, service_role;
GRANT SELECT ON fv.consignment_saldo TO authenticated, service_role;


-- ============================================================================
-- Consignação passa a ser uma compra como qualquer outra
-- ============================================================================
--
-- "esse consignado é exatamente igual a compra, mas é uma compra que ela ainda
-- não pagou, então tem que ter tudo o que tem numa compra normal" — o dono, em
-- 07/09, depois de carregar 65 peças de Brasília e não conseguir imprimir uma
-- etiqueta sequer.
--
-- Ele estava certo. `salvarCompra` criava o lote, marcava as peças e RETORNAVA:
-- nenhuma linha em `purchases`. Como detalhe, edição, exclusão e impressão de
-- etiqueta são todos pendurados na compra, a consignação não tinha nenhum dos
-- quatro. Foi preciso criar a compra na mão, no banco, para destravá-la.
--
-- Agora o lote consignado cria a compra junto, e é ela que aparece na lista —
-- com o rótulo "Consignação" e o status "A acertar" no lugar de Pago/Pendente,
-- porque consignado não tem pagamento na entrada. O custo vira despesa no
-- ACERTO (fv.consignment_acertos), não quando a peça chega.
-- ============================================================================

ALTER TABLE fv.purchases
  ADD COLUMN IF NOT EXISTS consignment_id uuid REFERENCES fv.consignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchases_consignment_idx ON fv.purchases (consignment_id);

COMMENT ON COLUMN fv.purchases.consignment_id IS
  'Preenchido quando esta compra é um lote consignado. Consignação é uma compra como outra qualquer (detalhe, edição, etiqueta) que ainda não foi paga.';


-- O acerto precisa de um reference_type próprio em transactions.
-- Sem isto: new row violates check constraint "transactions_reference_type_check".
ALTER TABLE fv.transactions DROP CONSTRAINT IF EXISTS transactions_reference_type_check;

ALTER TABLE fv.transactions ADD CONSTRAINT transactions_reference_type_check
  CHECK (reference_type = ANY (ARRAY[
    'sale'::text, 'purchase'::text, 'exchange'::text, 'manual'::text,
    'seller_commission'::text,
    -- Acerto de lote consignado: aponta para fv.consignments, não para a
    -- compra, porque o que está sendo quitado é o LOTE.
    'consignment'::text
  ]));
