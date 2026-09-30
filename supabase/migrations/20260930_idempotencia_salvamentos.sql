-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotência do salvamento de VENDA e COMPRA (30/09)
--
-- POR QUÊ: `salvarVenda` e `salvarCompra` fazem várias escritas seguidas, sem
-- transação (venda → itens → estoque → pagamentos → financeiro). Se o servidor
-- grava tudo e a RESPOSTA se perde (rede, timeout, deploy no meio), a tela não
-- sabe que deu certo: ela clica Salvar de novo — ou recupera o rascunho — e a
-- venda/compra entra DUAS vezes, com estoque baixado/somado em dobro e
-- pagamentos duplicados no financeiro.
--
-- COMO: cada venda/compra nova ganha, na tela, um uuid (`client_request_id`)
-- que vai junto no rascunho e em todo reenvio. O servidor procura esse id
-- ANTES de gravar; se já existe, devolve a venda/compra existente em vez de
-- criar outra. O índice único é a trava do caso de corrida (dois cliques
-- chegando juntos): o segundo insert falha com 23505 e o código relê a
-- existente.
--
-- Decisão: coluna + índice único, sem transformar o salvamento em RPC.
-- Índice PARCIAL (where not null): vendas/compras antigas, a edição e qualquer
-- cliente velho sem o id continuam gravando nulo, sem conflito entre si.
--
-- O código novo TOLERA esta migration atrasada (coluna ausente = segue sem
-- idempotência, com console.warn). Mas a proteção só existe depois dela.
-- ─────────────────────────────────────────────────────────────────────────────

alter table fv.sales add column if not exists client_request_id uuid;
create unique index if not exists sales_client_request_id_key
  on fv.sales (client_request_id)
  where client_request_id is not null;

alter table fv.purchases add column if not exists client_request_id uuid;
create unique index if not exists purchases_client_request_id_key
  on fv.purchases (client_request_id)
  where client_request_id is not null;

comment on column fv.sales.client_request_id is
  'uuid gerado pela tela por venda nova; evita duplicar a venda quando a resposta do salvamento se perde e ela reenvia.';
comment on column fv.purchases.client_request_id is
  'uuid gerado pela tela por compra nova; evita duplicar a compra quando a resposta do salvamento se perde e ela reenvia.';

-- Recarrega o cache de schema do PostgREST (sem isto o insert com a coluna nova
-- responde PGRST204 "column not found in schema cache").
-- ATENÇÃO: pelo pooler o NOTIFY pode não chegar ao PostgREST. Se depois de
-- aplicar o `select client_request_id from fv.sales` via API ainda der
-- PGRST204/42703, reinicie o container supabase_rest (ou mande SIGUSR1 nele).
notify pgrst, 'reload schema';
