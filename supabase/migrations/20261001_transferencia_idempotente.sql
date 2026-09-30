-- ============================================================================
-- Transferência idempotente: o mesmo romaneio enviado duas vezes entra UMA vez
-- ============================================================================
--
-- O problema: "Enviar" faz a transferência inteira numa transação só, mas a
-- RESPOSTA atravessa a rede. Se o banco grava e a resposta se perde (timeout,
-- deploy, oscilação), a tela mostra erro, o rascunho continua lá, ela clica de
-- novo — e a caixa inteira sai da origem pela segunda vez.
--
-- A saída é a mesma de vendas/compras (20260930_idempotencia_salvamentos.sql):
-- a TELA gera um uuid por romaneio (`client_request_id`) e manda em todo
-- reenvio. A função reconhece o id e devolve o romaneio que já gravou, sem
-- tocar em estoque.
--
-- Id repetido com CONTEÚDO diferente (outra origem/destino/peças) NÃO devolve
-- sucesso: seria um sucesso falso para uma caixa que nunca foi enviada. Nesse
-- caso a função recusa com mensagem clara.
--
-- Base: a definição de fv.enviar_transferencia que está no banco (dump de
-- 30/09/2026 = 20260921_transferencia_entrada_automatica.sql). O corpo abaixo é
-- ela, sem mudança de regra, mais o bloco de idempotência.
--
-- Por que DROP + CREATE e não CREATE OR REPLACE: um parâmetro novo muda a
-- assinatura, e CREATE OR REPLACE criaria uma SEGUNDA função (overload). Com
-- duas, a chamada nomeada sem o parâmetro novo fica ambígua para o PostgREST.
-- O parâmetro novo vai no FIM com DEFAULT NULL, então toda chamada antiga
-- (nomeada, com 4, 5 ou 6 argumentos) continua resolvendo nesta função.
--
-- Rodar esta migration inteira numa transação (é o padrão do SQL editor e do
-- psql -1). Depois: recarregar o schema do PostgREST (SIGUSR1 no container
-- supabase_rest — NOTIFY não passa pelo pooler). Até recarregar, a action
-- recebe PGRST202 ao mandar o parâmetro novo e repete a chamada sem ele.
-- ============================================================================

BEGIN;

-- ── 1. Coluna + índice único parcial ────────────────────────────────────────

ALTER TABLE fv.transfers ADD COLUMN IF NOT EXISTS client_request_id uuid;

COMMENT ON COLUMN fv.transfers.client_request_id IS
  'uuid gerado pela tela por romaneio; evita enviar a caixa duas vezes quando a resposta do envio se perde e ela reenvia.';

CREATE UNIQUE INDEX IF NOT EXISTS transfers_client_request_id_key
  ON fv.transfers (client_request_id)
  WHERE client_request_id IS NOT NULL;


-- ── 2. Nova assinatura de fv.enviar_transferencia ───────────────────────────

DROP FUNCTION IF EXISTS fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean);

CREATE FUNCTION fv.enviar_transferencia(
  p_from_store_id     uuid,
  p_to_store_id       uuid,
  p_itens             jsonb,
  p_user_id           uuid,
  p_notes             text    DEFAULT NULL,
  p_auto_receber      boolean DEFAULT false,
  p_client_request_id uuid    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fv, public
AS $$
DECLARE
  v_transfer_id uuid;
  v_item        jsonb;
  v_produto     fv.products%ROWTYPE;
  v_qtd         integer;
  v_pecas       integer := 0;
  v_itens       integer := 0;
  v_custo       numeric(12,2) := 0;
  v_venda       numeric(12,2) := 0;
  v_preco       numeric(12,2);
  v_rec         json;
  v_existente   fv.transfers%ROWTYPE;
  v_pedido      jsonb;
  v_gravado     jsonb;
BEGIN
  IF p_from_store_id = p_to_store_id THEN
    RETURN json_build_object('success', false, 'error', 'Origem e destino não podem ser a mesma loja.');
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Nenhuma peça no romaneio.');
  END IF;

  /*
   * Idempotência. ANTES de qualquer checagem de saldo: no reenvio o saldo já
   * saiu da origem, e a checagem de "estoque insuficiente" recusaria o
   * reenvio de um romaneio que deu certo.
   *
   * O advisory lock serializa dois envios simultâneos do MESMO id (duplo
   * clique que escapou da trava da tela, ou reenvio enquanto o primeiro ainda
   * roda). O segundo espera o primeiro terminar e, como cada comando do
   * plpgsql tira snapshot novo em READ COMMITTED, enxerga o romaneio gravado.
   * Sem o lock, o segundo bateria no índice único e voltaria como erro.
   */
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('fv.transfers:' || p_client_request_id::text, 0));

    SELECT * INTO v_existente
      FROM fv.transfers
     WHERE client_request_id = p_client_request_id;

    IF FOUND THEN
      -- Impressão digital: mesma origem, mesmo destino, mesmas peças e
      -- quantidades. Itens com quantity_sent = 0 são sobras lançadas na
      -- conferência de chegada, não fazem parte do que foi enviado.
      SELECT coalesce(jsonb_agg(jsonb_build_object('p', x.pid, 'q', x.qtd) ORDER BY x.pid), '[]'::jsonb)
        INTO v_pedido
        FROM (
          SELECT (e->>'product_id')::uuid AS pid, sum(coalesce((e->>'quantity')::integer, 0)) AS qtd
            FROM jsonb_array_elements(p_itens) e
           GROUP BY 1
        ) x;

      SELECT coalesce(jsonb_agg(jsonb_build_object('p', x.pid, 'q', x.qtd) ORDER BY x.pid), '[]'::jsonb)
        INTO v_gravado
        FROM (
          SELECT ti.product_id AS pid, sum(ti.quantity_sent) AS qtd
            FROM fv.transfer_items ti
           WHERE ti.transfer_id = v_existente.id
             AND ti.quantity_sent > 0
           GROUP BY 1
        ) x;

      IF v_existente.from_store_id <> p_from_store_id
         OR v_existente.to_store_id <> p_to_store_id
         OR v_pedido <> v_gravado THEN
        RETURN json_build_object('success', false, 'error',
          'Este romaneio já foi enviado antes, com outras peças. Confira a lista de transferências; '
          || 'se é uma caixa nova, descarte o rascunho e bipe de novo.');
      END IF;

      -- Mesmo retorno de sucesso do envio original, lido do que foi gravado.
      RETURN json_build_object(
        'success',     true,
        'transfer_id', v_existente.id,
        'pecas',       coalesce((v_existente.totals->>'pecas')::integer, 0),
        'itens',       coalesce((v_existente.totals->>'itens')::integer, 0),
        'custo_total', coalesce((v_existente.totals->>'custo_total')::numeric, 0),
        'venda_total', coalesce((v_existente.totals->>'venda_total')::numeric, 0),
        'auto_recebida', CASE WHEN p_auto_receber
                              THEN v_existente.status IN ('recebida', 'divergente')
                              ELSE NULL END,
        'repetido',    true
      );
    END IF;
  END IF;

  INSERT INTO fv.transfers (from_store_id, to_store_id, sent_by, notes, client_request_id)
  VALUES (p_from_store_id, p_to_store_id, p_user_id, p_notes, p_client_request_id)
  RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_qtd := COALESCE((v_item->>'quantity')::integer, 0);

    IF v_qtd <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida para a peça %.', v_item->>'product_id';
    END IF;

    SELECT * INTO v_produto
      FROM fv.products
     WHERE id = (v_item->>'product_id')::uuid
       AND store_id = p_from_store_id
       AND is_active = true
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Peça % não está ativa na loja de origem.', v_item->>'product_id';
    END IF;

    IF v_produto.quantity_in_stock < v_qtd THEN
      RAISE EXCEPTION 'Estoque insuficiente de "%" — disponível: %.',
        v_produto.name, v_produto.quantity_in_stock;
    END IF;

    v_preco := COALESCE(
      CASE
        WHEN v_produto.promotional_active AND COALESCE(v_produto.promotional_price, 0) > 0
          THEN v_produto.promotional_price
        ELSE v_produto.sale_price
      END, 0);

    INSERT INTO fv.transfer_items (
      transfer_id, product_id, product_code, product_name, barcode_number,
      quantity_sent, unit_cost, unit_sale_price, reetiquetar
    ) VALUES (
      v_transfer_id, v_produto.id, v_produto.code, v_produto.name, v_produto.barcode_number,
      v_qtd, v_produto.cost_price, v_preco,
      false
    );

    UPDATE fv.products
       SET quantity_in_stock = quantity_in_stock - v_qtd,
           is_active = (quantity_in_stock - v_qtd) > 0,
           updated_at = now()
     WHERE id = v_produto.id;

    INSERT INTO fv.stock_movements (
      product_id, quantity_before, delta, quantity_after,
      reason, ref_type, ref_id, user_id
    ) VALUES (
      v_produto.id, v_produto.quantity_in_stock, -v_qtd, v_produto.quantity_in_stock - v_qtd,
      'transferencia_envio', 'transfer', v_transfer_id, p_user_id
    );

    v_pecas := v_pecas + v_qtd;
    v_itens := v_itens + 1;
    v_custo := v_custo + (v_produto.cost_price * v_qtd);
    v_venda := v_venda + (v_preco * v_qtd);
  END LOOP;

  UPDATE fv.transfers
     SET totals = json_build_object('pecas', v_pecas, 'itens', v_itens,
                                    'custo_total', v_custo, 'venda_total', v_venda),
         updated_at = now()
   WHERE id = v_transfer_id;

  IF p_auto_receber THEN
    v_rec := fv.receber_transferencia(
      v_transfer_id, p_itens, p_user_id,
      'Entrada automática no envio (sem conferência).'
    );
    IF NOT COALESCE((v_rec->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'Falha na entrada automática: %', COALESCE(v_rec->>'error', 'desconhecido');
    END IF;

    RETURN json_build_object('success', true, 'transfer_id', v_transfer_id,
                             'pecas', v_pecas, 'itens', v_itens,
                             'custo_total', v_custo, 'venda_total', v_venda,
                             'auto_recebida', true);
  END IF;

  RETURN json_build_object('success', true, 'transfer_id', v_transfer_id,
                           'pecas', v_pecas, 'itens', v_itens,
                           'custo_total', v_custo, 'venda_total', v_venda);
END;
$$;

ALTER FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid) OWNER TO postgres;

COMMENT ON FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid) IS
  'Abre o romaneio e tira o saldo da origem (com p_auto_receber, já dá entrada no destino). '
  'p_client_request_id torna o envio idempotente: o mesmo id devolve o romaneio já gravado sem mexer em estoque; '
  'mesmo id com conteúdo diferente é recusado.';


-- ── 3. Grants — os MESMOS que a função tinha no banco (dump de 30/09) ────────
--
-- No banco a versão anterior tinha EXECUTE para anon, authenticated e
-- service_role (default privileges do schema fv), e PUBLIC nunca foi revogado.
-- O DROP leva os grants junto; aqui eles voltam exatamente como estavam, para
-- não mudar comportamento nesta migration. (Ver o relatório: anon executando
-- uma SECURITY DEFINER que mexe em estoque é um furo a fechar à parte.)

-- Revisão de 01/10: devolver o grant a anon reabria o furo (esta migration
-- roda antes da 20261002_fechar_acesso_anonimo). O app só chama pelo client
-- admin (transferencias/actions.ts), então basta service_role.
REVOKE ALL ON FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fv.enviar_transferencia(uuid, uuid, jsonb, uuid, text, boolean, uuid)
  TO service_role;

COMMIT;
