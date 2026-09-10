-- ============================================================================
-- Consertos: a peça da cliente, do recebimento à entrega
-- ============================================================================
--
-- O botão de conserto no PDV resolveu o DINHEIRO: a cliente paga junto com as
-- peças, sem custo, sem estoque e fora da comissão. Ficou faltando a PEÇA.
--
-- O dono levantou em 10/09: "o conserto não entra uma peça, então deveria ser
-- possível registrar essa peça". A ata de 09/09 sustenta — na hora de desenhar
-- o botão, o Lucas disse "vai abrir uma listinha ali para você preencher QUAL
-- VAI SER O CONSERTO e o valor dele". O "vou digitar um valor só" da dona veio
-- logo depois, mas respondendo a outra pergunta: se digitaria o custo do
-- Ourives e o valor cobrado separados.
--
-- E o fluxo inteiro aparece na ata sem ser nomeado: "nunca entra no mesmo mês
-- porque a gente avisa o cliente que está lá, às vezes ela demora para buscar".
-- A peça fica na loja esperando, e até agora sem registro nenhum de que está lá.
--
--
-- POR QUE NÃO EXISTE VALOR NESTA TABELA
--
-- O dinheiro continua na linha da venda. Guardar `valor_cobrado` aqui também
-- criaria duas fontes para o mesmo número — o erro que já aconteceu neste
-- projeto com o CMV e a despesa da compra, e que fez o painel exibir a
-- formação do estoque como prejuízo por semanas.
--
-- `sale_item_id` é o elo: nulo enquanto a peça está na loja, preenchido quando
-- a cliente paga e leva.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fv.consertos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES fv.stores(id),
  -- Sem cliente não há a quem devolver: a peça é dela, não da loja.
  customer_id     uuid NOT NULL REFERENCES fv.customers(id),
  peca            text NOT NULL,
  servico         text,
  recebido_em     date NOT NULL DEFAULT CURRENT_DATE,
  prometido_para  date,
  status          text NOT NULL DEFAULT 'recebido'
                  CHECK (status IN ('recebido','no_ourives','pronto','entregue')),
  sale_item_id    uuid REFERENCES fv.sale_items(id) ON DELETE SET NULL,
  entregue_em     date,
  notes           text,
  user_id         uuid REFERENCES fv.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consertos_loja_status_idx ON fv.consertos (store_id, status, recebido_em DESC);
CREATE INDEX IF NOT EXISTS consertos_cliente_idx     ON fv.consertos (customer_id);

COMMENT ON TABLE fv.consertos IS
  'Peça da cliente em conserto: entra, vai ao Ourives, volta, a cliente busca. NÃO guarda valor — o dinheiro vive na linha da venda (sale_items), para não haver duas fontes do mesmo número.';

COMMENT ON COLUMN fv.consertos.sale_item_id IS
  'A linha da venda que cobrou este conserto. Nulo até a cliente pagar.';

-- Schema novo nasce sem GRANT: sem isto, 42501 na cara da usuária.
GRANT SELECT, INSERT, UPDATE, DELETE ON fv.consertos TO authenticated, service_role;


-- Conserto cobrado direto no balcão pode não ter cliente identificada.
-- Registrado pela tela, o cliente segue obrigatório — a própria tela exige.
ALTER TABLE fv.consertos ALTER COLUMN customer_id DROP NOT NULL;

COMMENT ON COLUMN fv.consertos.customer_id IS
  'De quem é a peça. Nulo só quando o conserto nasceu de uma cobrança avulsa no PDV, sem cliente selecionada.';
