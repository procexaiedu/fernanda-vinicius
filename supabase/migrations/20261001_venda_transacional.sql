-- ============================================================================
-- Venda transacional: salvar, editar e excluir numa transação só (01/10)
-- ============================================================================
--
-- POR QUÊ
--
-- `salvarVenda` fazia umas dez escritas seguidas pelo PostgREST, cada uma na
-- sua própria transação: venda → itens → estoque (ler e depois gravar) →
-- pagamentos → financeiro → consertos → troca. Qualquer passo que falhasse
-- deixava a venda PELA METADE — venda sem peças, peça vendida sem baixa,
-- pagamento fora do caixa — e a tela tinha de dizer "A venda FOI gravada, mas…
-- NÃO salve de novo" e mandar a dona corrigir à mão. Excluir e editar tinham o
-- mesmo buraco: um `delete` falhando no meio já devolveu estoque de venda que
-- continuou existindo.
--
-- E o estoque era ler-e-escrever: duas vendas da mesma peça ao mesmo tempo
-- liam o mesmo saldo e uma das baixas sumia.
--
-- COMO — "o TypeScript calcula, o SQL persiste"
--
-- Toda a conferência continua no servidor Next (login, escopo de loja, peças
-- da loja, custo relido do cadastro, conserto da cliente, percentuais, total
-- de src/lib/vendas/total.ts). Ele monta o pacote JÁ RESOLVIDO — as linhas
-- exatamente como iam para cada tabela — e chama UMA função. Aqui dentro não
-- se recalcula nada de preço: repetir a regra de arredondamento em dois
-- lugares foi o bug de 01/09.
--
-- As linhas do pacote passam por `jsonb_populate_record(null::fv.<tabela>)`:
-- a conversão de tipo é a da própria coluna, igual à que o PostgREST fazia no
-- insert. `sale_date` chega 'YYYY-MM-DD' e vira o mesmo timestamptz de antes.
--
-- Estoque ATÔMICO (`quantity_in_stock = quantity_in_stock - x`). A regra do
-- balcão NÃO muda: venda sem estoque passa, o saldo pode ficar negativo — a
-- peça está na mão da cliente, quem acerta o número é a conferência. Serviço
-- (conserto) não mexe em estoque. A venda nunca gravou `stock_movements`, e
-- continua não gravando (o diário é dos ajustes: baixa, conferência).
--
-- Erro em qualquer passo = exception = rollback de TUDO. A única exceção é o
-- vínculo do conserto, de propósito: "a venda vale mais que o vínculo" (ver a
-- nota em vendas/actions.ts). Ele roda num sub-bloco (savepoint); se falhar,
-- a venda entra e a função devolve `consertos_pendentes` para o log.
--
-- IDEMPOTÊNCIA: o `client_request_id` (coluna + índice único da migration
-- 20260930) é conferido AQUI, sob um advisory lock do próprio id — dois
-- cliques simultâneos da mesma venda entram em fila, e o segundo encontra a
-- venda do primeiro em vez de bater no índice único.
--
-- SEGURANÇA: sem SECURITY DEFINER. Roda com o papel de quem chama, e só o
-- service_role (o client admin das server actions) pode chamar. O schema fv
-- tem DEFAULT PRIVILEGES que dão EXECUTE a anon/authenticated em toda função
-- nova — por isso o REVOKE explícito no fim. Sem ele, qualquer navegador com
-- a chave anon lançava venda direto na API, sem as conferências do servidor.
--
-- ORDEM DO DEPLOY: aplicar ESTA migration ANTES do push. O código novo não
-- tem caminho antigo: sem a função, salvar venda responde erro.
-- ============================================================================


-- ─── O corpo da venda: itens, estoque, consertos, pagamentos, troca ─────────
--
-- Comum a salvar e editar. Supõe que a linha de `fv.sales` já existe (acabou
-- de ser inserida ou atualizada na mesma transação) e que o corpo antigo, na
-- edição, já foi desfeito.
--
-- `p_marca_ultima_venda`: a venda nova grava `products.last_sale_date` (é o
-- que alimenta o alerta de peça parada); a edição nunca gravou.

CREATE OR REPLACE FUNCTION fv._gravar_corpo_da_venda(
  p_sale_id            uuid,
  p                    jsonb,
  p_marca_ultima_venda boolean
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_venda       fv.sales%ROWTYPE;
  v_item        jsonb;
  v_linha       fv.sale_items%ROWTYPE;
  v_item_id     uuid;
  v_conserto    jsonb;
  v_pendentes   jsonb := '[]'::jsonb;
  v_exchange_id uuid;
BEGIN
  SELECT * INTO v_venda FROM fv.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venda % não existe ao gravar o corpo', p_sale_id;
  END IF;

  /*
   * Trava de uma vez, em ordem de id, todas as peças que esta venda mexe
   * (itens + devolvidas na troca). Sem isto, duas vendas simultâneas com as
   * mesmas peças em ordem inversa se travam (deadlock, 40P01) e uma é
   * abortada no balcão; em ordem fixa, a segunda só espera a primeira.
   */
  PERFORM 1
     FROM fv.products
    WHERE id IN (
            SELECT (e->>'product_id')::uuid FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) e
             WHERE e->>'product_id' IS NOT NULL
            UNION
            SELECT (e->>'product_id')::uuid FROM jsonb_array_elements(COALESCE(p->'exchange'->'returned', '[]'::jsonb)) e
             WHERE e->>'product_id' IS NOT NULL
          )
    ORDER BY id
      FOR UPDATE;

  -- ── Itens (+ estoque + conserto), um a um: o conserto precisa do id da linha
  FOR v_item IN
    SELECT e.value FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) WITH ORDINALITY AS e(value, ord)
    ORDER BY e.ord
  LOOP
    v_linha := jsonb_populate_record(NULL::fv.sale_items, v_item);

    INSERT INTO fv.sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
    VALUES (p_sale_id, v_linha.product_id, v_linha.quantity, v_linha.unit_price, v_linha.unit_cost, v_linha.subtotal)
    RETURNING id INTO v_item_id;

    -- Atômico: sem ler o saldo antes. Pode ficar negativo (regra do balcão).
    UPDATE fv.products
       SET quantity_in_stock = quantity_in_stock - v_linha.quantity,
           last_sale_date    = CASE WHEN p_marca_ultima_venda THEN v_venda.sale_date ELSE last_sale_date END
     WHERE id = v_linha.product_id
       AND NOT is_service;

    v_conserto := v_item->'conserto';
    IF v_conserto IS NOT NULL AND jsonb_typeof(v_conserto) = 'object' THEN
      /*
       * Sub-bloco = savepoint. Falhou o vínculo, desfaz só ele; a venda segue.
       * Mesmos dois caminhos de consertos/interno.ts:
       *   { id }    → peça já registrada: a venda diz que foi PAGA (não entregue)
       *   { novo }  → cobrança direta no PDV: nasce o registro do conserto
       */
      BEGIN
        IF v_conserto ? 'id' THEN
          UPDATE fv.consertos
             SET sale_item_id = v_item_id,
                 updated_at   = now()
           WHERE id = (v_conserto->>'id')::uuid;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Conserto não encontrado ao registrar o pagamento.';
          END IF;
        ELSIF jsonb_typeof(v_conserto->'novo') = 'object' THEN
          INSERT INTO fv.consertos (store_id, customer_id, peca, recebido_em, status, entregue_em, sale_item_id, user_id)
          SELECT c.store_id, c.customer_id, c.peca, c.recebido_em, c.status, c.entregue_em, v_item_id, c.user_id
            FROM jsonb_populate_record(NULL::fv.consertos, v_conserto->'novo') AS c;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_pendentes := v_pendentes || jsonb_build_object(
          'conserto_id',  v_conserto->>'id',
          'sale_item_id', v_item_id,
          'erro',         SQLERRM
        );
      END;
    END IF;
  END LOOP;

  -- ── Pagamentos e o financeiro (uma transaction por pagamento) ──────────────
  INSERT INTO fv.sale_payments (sale_id, payment_method, amount, installments, card_brand)
  SELECT p_sale_id, x.payment_method, x.amount, x.installments, x.card_brand
    FROM jsonb_populate_recordset(NULL::fv.sale_payments, COALESCE(p->'payments', '[]'::jsonb)) AS x;

  INSERT INTO fv.transactions (
    store_id, type, amount, category, description, reference_type, reference_id,
    user_id, payment_method, transaction_date, status, paid_at
  )
  SELECT t.store_id, t.type, t.amount, t.category, t.description, t.reference_type, p_sale_id,
         t.user_id, t.payment_method, t.transaction_date, t.status, now()
    FROM jsonb_populate_recordset(NULL::fv.transactions, COALESCE(p->'transactions', '[]'::jsonb)) AS t;

  -- ── Troca: o que voltou (entra no estoque) e o que saiu ────────────────────
  IF jsonb_typeof(p->'exchange') = 'object' THEN
    INSERT INTO fv.exchanges (
      sale_id, original_sale_id, store_id, customer_id, user_id,
      exchange_date, reason, price_difference, payment_method
    )
    SELECT p_sale_id, e.original_sale_id, e.store_id, e.customer_id, e.user_id,
           e.exchange_date, e.reason, e.price_difference, e.payment_method
      FROM jsonb_populate_record(NULL::fv.exchanges, p->'exchange'->'row') AS e
    RETURNING id INTO v_exchange_id;

    INSERT INTO fv.exchange_items (exchange_id, direction, product_id, quantity, unit_price, unit_cost)
    SELECT v_exchange_id, 'returned', r.product_id, r.quantity, r.unit_price, COALESCE(r.unit_cost, 0)
      FROM jsonb_populate_recordset(NULL::fv.exchange_items, COALESCE(p->'exchange'->'returned', '[]'::jsonb)) AS r;

    /*
     * `is_active = true` junto com o saldo: peça vendida costuma estar zerada e
     * inativada; voltou para a gaveta, volta para as listas (ver a nota que
     * morava em gravarItensDaTroca).
     */
    UPDATE fv.products pr
       SET quantity_in_stock = pr.quantity_in_stock + d.qtd,
           is_active         = true,
           updated_at        = now()
      FROM (
        SELECT r.product_id, sum(r.quantity)::integer AS qtd
          FROM jsonb_populate_recordset(NULL::fv.exchange_items, COALESCE(p->'exchange'->'returned', '[]'::jsonb)) AS r
         GROUP BY r.product_id
      ) AS d
     WHERE pr.id = d.product_id
       AND NOT pr.is_service;

    INSERT INTO fv.exchange_items (exchange_id, direction, product_id, quantity, unit_price, unit_cost)
    SELECT v_exchange_id, 'given', g.product_id, g.quantity, g.unit_price, COALESCE(g.unit_cost, 0)
      FROM jsonb_populate_recordset(NULL::fv.exchange_items, COALESCE(p->'exchange'->'given', '[]'::jsonb)) AS g;
  END IF;

  RETURN jsonb_build_object(
    'exchange_id',         v_exchange_id,
    'consertos_pendentes', v_pendentes
  );
END;
$$;

COMMENT ON FUNCTION fv._gravar_corpo_da_venda(uuid, jsonb, boolean) IS
  'Interna: itens + estoque atômico + consertos + pagamentos + financeiro + troca de uma venda. Só chamada por salvar_venda/editar_venda, na mesma transação.';


-- ─── Desfaz o corpo: devolve estoque e apaga itens, pagamentos, troca ───────
--
-- O que `deletarVenda` e o começo de `editarVenda` faziam: peça vendida volta
-- (+), peça devolvida na troca sai de novo (−), e somem troca, financeiro,
-- pagamentos e itens. A linha de `fv.sales` fica — quem chama decide se apaga
-- (excluir) ou regrava (editar).
--
-- RASTRO EM fv.stock_movements (pedido da conferência): a conferência deixa
-- de ajustar peça que se mexeu depois do início da contagem, e descobre isso
-- lendo sale_items, exchanges e stock_movements. Excluir/editar APAGA os
-- itens — sem esta linha o movimento sumiria sem deixar rastro, e a
-- conferência "corrigiria" um saldo que estava certo. Uma linha por peça cujo
-- saldo mudou (delta líquido: item devolvido − peça da troca), ref_type
-- 'sale', ref_id = a venda, reason = `p_motivo` ('venda_excluida' |
-- 'venda_editada').
--
-- Peça com saldo NEGATIVO (antes ou depois) não ganha linha: o CHECK
-- `stock_movements_nao_negativo` a recusaria e derrubaria a exclusão inteira.
-- O saldo muda do mesmo jeito; só o diário fica sem ela (e sai um NOTICE).
--
-- Consertos ligados a itens apagados ficam soltos pelo próprio FK
-- (ON DELETE SET NULL), como antes.

CREATE OR REPLACE FUNCTION fv._desfazer_corpo_da_venda(
  p_sale_id uuid,
  p_user_id uuid,
  p_motivo  text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sem_rastro integer;
BEGIN
  -- Mesma trava em ordem de id da gravação (ver _gravar_corpo_da_venda).
  PERFORM 1
     FROM fv.products
    WHERE id IN (
            SELECT si.product_id FROM fv.sale_items si WHERE si.sale_id = p_sale_id
            UNION
            SELECT ei.product_id
              FROM fv.exchange_items ei
              JOIN fv.exchanges ex ON ex.id = ei.exchange_id
             WHERE ex.sale_id = p_sale_id
          )
    ORDER BY id
      FOR UPDATE;

  WITH deltas AS (
    SELECT x.product_id, sum(x.delta)::integer AS delta
      FROM (
        SELECT si.product_id, si.quantity AS delta
          FROM fv.sale_items si
         WHERE si.sale_id = p_sale_id
        UNION ALL
        SELECT ei.product_id, -ei.quantity
          FROM fv.exchange_items ei
          JOIN fv.exchanges ex ON ex.id = ei.exchange_id
         WHERE ex.sale_id = p_sale_id
           AND ei.direction = 'returned'
      ) AS x
     GROUP BY x.product_id
    HAVING sum(x.delta) <> 0
  ),
  mudou AS (
    UPDATE fv.products pr
       SET quantity_in_stock = pr.quantity_in_stock + d.delta
      FROM deltas d
     WHERE pr.id = d.product_id
       AND NOT pr.is_service
    RETURNING pr.id AS product_id, pr.quantity_in_stock AS depois, d.delta
  ),
  rastro AS (
    INSERT INTO fv.stock_movements (
      product_id, quantity_before, delta, quantity_after,
      reason, ref_type, ref_id, user_id, notes
    )
    SELECT m.product_id, m.depois - m.delta, m.delta, m.depois,
           p_motivo, 'sale', p_sale_id, p_user_id,
           CASE p_motivo WHEN 'venda_editada' THEN 'Venda editada: estoque da venda antiga devolvido'
                         ELSE 'Venda excluída: estoque devolvido' END
      FROM mudou m
     WHERE m.depois >= 0 AND m.depois - m.delta >= 0
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM mudou) - (SELECT count(*) FROM rastro) INTO v_sem_rastro;

  IF v_sem_rastro > 0 THEN
    RAISE NOTICE '_desfazer_corpo_da_venda: % peça(s) com saldo negativo ficaram sem linha em stock_movements (venda %)', v_sem_rastro, p_sale_id;
  END IF;

  DELETE FROM fv.exchange_items
   WHERE exchange_id IN (SELECT id FROM fv.exchanges WHERE sale_id = p_sale_id);
  DELETE FROM fv.exchanges     WHERE sale_id = p_sale_id;
  DELETE FROM fv.transactions  WHERE reference_id = p_sale_id AND reference_type = 'sale';
  DELETE FROM fv.sale_payments WHERE sale_id = p_sale_id;
  DELETE FROM fv.sale_items    WHERE sale_id = p_sale_id;
END;
$$;

COMMENT ON FUNCTION fv._desfazer_corpo_da_venda(uuid, uuid, text) IS
  'Interna: devolve o estoque de uma venda (e tira de novo o que voltou na troca), grava o rastro em stock_movements (ref_type sale) e apaga itens, pagamentos, financeiro e troca. Não apaga a linha de sales.';


-- ─── salvar_venda ────────────────────────────────────────────────────────────
--
-- p = {
--   client_request_id: uuid | null,
--   sale:         { store_id, customer_id, user_id, seller_id, sale_date, subtotal,
--                   discount_type, discount_pct, discount_amount, manual_discount,
--                   total, total_cost, previsao_pagamento, destinatario_cpf,
--                   payment_summary, status, notes },
--   items:        [ { product_id, quantity, unit_price, unit_cost, subtotal,
--                     conserto: null | { id } | { novo: { store_id, customer_id, peca,
--                               recebido_em, status, entregue_em, user_id } } } ],
--   payments:     [ { payment_method, amount, installments, card_brand } ],
--   transactions: [ { store_id, type, amount, category, description, reference_type,
--                     user_id, payment_method, transaction_date, status } ],
--   exchange:     null | { row: { original_sale_id, store_id, customer_id, user_id,
--                                 exchange_date, reason, price_difference, payment_method },
--                          returned: [ { product_id, quantity, unit_price, unit_cost } ],
--                          given:    [ { product_id, quantity, unit_price, unit_cost } ] }
-- }
--
-- Devolve:
--   { sale_id, ja_existia: false, consertos_pendentes: [...] }   gravou agora
--   { sale_id, ja_existia: true, incompleta: bool }               reenvio da mesma venda
--   { erro: 'id_reusado', sale_id_existente }                     o id é de OUTRA venda; nada gravado

CREATE OR REPLACE FUNCTION fv.salvar_venda(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_req       uuid;
  v_nova      fv.sales%ROWTYPE;
  v_existente fv.sales%ROWTYPE;
  v_n_itens   integer;
  v_n_pag     integer;
  v_env_itens integer;
  v_env_pag   integer;
  v_sale_id   uuid;
  v_corpo     jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p->'sale') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'salvar_venda: pacote sem a venda';
  END IF;
  v_env_itens := CASE WHEN jsonb_typeof(p->'items') = 'array' THEN jsonb_array_length(p->'items') ELSE 0 END;
  v_env_pag   := CASE WHEN jsonb_typeof(p->'payments') = 'array' THEN jsonb_array_length(p->'payments') ELSE 0 END;
  IF v_env_itens = 0 THEN
    RAISE EXCEPTION 'salvar_venda: venda sem itens';
  END IF;

  v_nova := jsonb_populate_record(NULL::fv.sales, p->'sale');
  v_req  := NULLIF(p->>'client_request_id', '')::uuid;

  -- ── Reenvio? ────────────────────────────────────────────────────────────
  IF v_req IS NOT NULL THEN
    -- Fila por id: o segundo clique espera o primeiro terminar e o encontra.
    PERFORM pg_advisory_xact_lock(hashtextextended('fv.salvar_venda:' || v_req::text, 0));

    SELECT * INTO v_existente FROM fv.sales WHERE client_request_id = v_req;
    IF FOUND THEN
      SELECT count(*) INTO v_n_itens FROM fv.sale_items    WHERE sale_id = v_existente.id;
      SELECT count(*) INTO v_n_pag   FROM fv.sale_payments WHERE sale_id = v_existente.id;

      /*
       * Impressão digital: loja, cliente, total (±1 centavo) e nº de peças.
       * O total aceita também "mesmo subtotal + mesmos descontos": se a dona
       * mudou o % do PIX entre os dois envios, a MESMA venda recalcula outro
       * total — e chamar isso de "outra venda" faria a tela trocar o id e
       * lançar a venda de novo.
       */
      IF v_existente.store_id IS DISTINCT FROM v_nova.store_id
         OR v_existente.customer_id IS DISTINCT FROM v_nova.customer_id
         OR v_n_itens > v_env_itens
         OR NOT (
              abs(COALESCE(v_existente.total, 0) - COALESCE(v_nova.total, 0)) <= 0.011
              OR (    abs(COALESCE(v_existente.subtotal, 0) - COALESCE(v_nova.subtotal, 0)) <= 0.011
                  AND v_existente.discount_type IS NOT DISTINCT FROM v_nova.discount_type
                  AND abs(COALESCE(v_existente.manual_discount, 0) - COALESCE(v_nova.manual_discount, 0)) <= 0.011)
            )
      THEN
        RETURN jsonb_build_object('erro', 'id_reusado', 'sale_id_existente', v_existente.id);
      END IF;

      -- Menos linhas que as enviadas só acontece com venda gravada pelo
      -- caminho antigo (sem transação), antes desta migration.
      RETURN jsonb_build_object(
        'sale_id',    v_existente.id,
        'ja_existia', true,
        'incompleta', (v_n_itens < v_env_itens OR v_n_pag < v_env_pag)
      );
    END IF;
  END IF;

  -- ── A venda ─────────────────────────────────────────────────────────────
  INSERT INTO fv.sales (
    store_id, customer_id, user_id, seller_id, sale_date, subtotal,
    discount_type, discount_pct, discount_amount, manual_discount,
    total, total_cost, previsao_pagamento, destinatario_cpf,
    payment_summary, status, notes, client_request_id
  ) VALUES (
    v_nova.store_id, v_nova.customer_id, v_nova.user_id, v_nova.seller_id, v_nova.sale_date, v_nova.subtotal,
    v_nova.discount_type, v_nova.discount_pct, v_nova.discount_amount, COALESCE(v_nova.manual_discount, 0),
    v_nova.total, v_nova.total_cost, v_nova.previsao_pagamento, v_nova.destinatario_cpf,
    v_nova.payment_summary, COALESCE(v_nova.status, 'completed'), v_nova.notes, v_req
  )
  RETURNING id INTO v_sale_id;

  v_corpo := fv._gravar_corpo_da_venda(v_sale_id, p, true);

  RETURN jsonb_build_object(
    'sale_id',             v_sale_id,
    'ja_existia',          false,
    'consertos_pendentes', v_corpo->'consertos_pendentes'
  );
END;
$$;

COMMENT ON FUNCTION fv.salvar_venda(jsonb) IS
  'Grava uma venda nova inteira numa transação (venda, itens, estoque atômico, consertos, pagamentos, financeiro, troca), com idempotência por client_request_id. Pacote montado e conferido por salvarVenda (vendas/actions.ts). Só service_role.';


-- ─── editar_venda ────────────────────────────────────────────────────────────
--
-- p = o mesmo pacote de salvar_venda (sem client_request_id) + sale_id.
-- Desfaz o corpo antigo, regrava a linha de sales (mesmo id; user_id e
-- client_request_id não mudam) e grava o corpo novo — tudo ou nada.
--
-- Devolve { sale_id, consertos_pendentes } ou { erro: 'nao_encontrada' }.

CREATE OR REPLACE FUNCTION fv.editar_venda(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id uuid;
  v_nova    fv.sales%ROWTYPE;
  v_corpo   jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p->'sale') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'editar_venda: pacote sem a venda';
  END IF;
  IF COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p->'items') = 'array' THEN p->'items' END), 0) = 0 THEN
    RAISE EXCEPTION 'editar_venda: venda sem itens';
  END IF;

  v_sale_id := (p->>'sale_id')::uuid;
  v_nova    := jsonb_populate_record(NULL::fv.sales, p->'sale');

  -- Trava a venda: duas edições (ou edição + exclusão) não se cruzam.
  PERFORM 1 FROM fv.sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'nao_encontrada');
  END IF;

  -- Quem edita: sale.user_id do pacote (o servidor põe a usuária logada).
  PERFORM fv._desfazer_corpo_da_venda(v_sale_id, v_nova.user_id, 'venda_editada');

  UPDATE fv.sales SET
    store_id           = v_nova.store_id,
    customer_id        = v_nova.customer_id,
    seller_id          = v_nova.seller_id,
    sale_date          = v_nova.sale_date,
    subtotal           = v_nova.subtotal,
    discount_type      = v_nova.discount_type,
    discount_pct       = v_nova.discount_pct,
    discount_amount    = v_nova.discount_amount,
    manual_discount    = COALESCE(v_nova.manual_discount, 0),
    total              = v_nova.total,
    total_cost         = v_nova.total_cost,
    payment_summary    = v_nova.payment_summary,
    status             = COALESCE(v_nova.status, 'completed'),
    previsao_pagamento = v_nova.previsao_pagamento,
    destinatario_cpf   = v_nova.destinatario_cpf,
    notes              = v_nova.notes,
    updated_at         = now()
  WHERE id = v_sale_id;

  v_corpo := fv._gravar_corpo_da_venda(v_sale_id, p, false);

  RETURN jsonb_build_object(
    'sale_id',             v_sale_id,
    'consertos_pendentes', v_corpo->'consertos_pendentes'
  );
END;
$$;

COMMENT ON FUNCTION fv.editar_venda(jsonb) IS
  'Refaz uma venda existente (mesmo id) numa transação: devolve o estoque antigo, apaga o corpo antigo e grava o novo. Pacote montado por editarVenda (vendas/actions.ts). Só service_role.';


-- ─── excluir_venda ───────────────────────────────────────────────────────────
--
-- Devolve { sale_id, existia }. Venda que não existe não é erro (era assim:
-- os deletes simplesmente não achavam nada). `p_user_id` = quem excluiu, para
-- o rastro em stock_movements (user_id é NOT NULL lá).

CREATE OR REPLACE FUNCTION fv.excluir_venda(p_sale_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_existia boolean;
BEGIN
  PERFORM 1 FROM fv.sales WHERE id = p_sale_id FOR UPDATE;
  v_existia := FOUND;

  PERFORM fv._desfazer_corpo_da_venda(p_sale_id, p_user_id, 'venda_excluida');
  DELETE FROM fv.sales WHERE id = p_sale_id;

  RETURN jsonb_build_object('sale_id', p_sale_id, 'existia', v_existia);
END;
$$;

COMMENT ON FUNCTION fv.excluir_venda(uuid, uuid) IS
  'Exclui uma venda numa transação: estoque de volta (com rastro em stock_movements; a peça da troca sai de novo), financeiro, pagamentos, itens, troca e a venda. Só service_role.';


-- ─── Quem pode chamar: só o service_role ────────────────────────────────────
-- (DEFAULT PRIVILEGES do schema fv dão EXECUTE a anon/authenticated em toda
-- função nova — o REVOKE tira.)

REVOKE ALL ON FUNCTION fv._gravar_corpo_da_venda(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv._desfazer_corpo_da_venda(uuid, uuid, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv.salvar_venda(jsonb)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv.editar_venda(jsonb)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fv.excluir_venda(uuid, uuid)                    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fv._gravar_corpo_da_venda(uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION fv._desfazer_corpo_da_venda(uuid, uuid, text)   TO service_role;
GRANT EXECUTE ON FUNCTION fv.salvar_venda(jsonb)                          TO service_role;
GRANT EXECUTE ON FUNCTION fv.editar_venda(jsonb)                          TO service_role;
GRANT EXECUTE ON FUNCTION fv.excluir_venda(uuid, uuid)                    TO service_role;

-- Recarrega o cache do PostgREST (sem isto: PGRST202 "function not found").
-- Pelo pooler o NOTIFY pode não chegar: se continuar PGRST202, SIGUSR1 no
-- container supabase_rest.
NOTIFY pgrst, 'reload schema';
