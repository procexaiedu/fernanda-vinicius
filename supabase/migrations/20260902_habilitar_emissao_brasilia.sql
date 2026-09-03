-- ============================================================================
-- Liga a emissão de NFC-e — só para Brasília
-- ============================================================================
--
-- `habilitado` é a trava criada na migration fiscal: com tudo configurado e o
-- certificado no lugar, ninguém emite até alguém virar a chave de propósito.
-- Este é o momento de virá-la, e só para uma loja.
--
--
-- POR QUE SÓ BRASÍLIA
--
-- Decisão do dono em 02/09: **Campinas vai ter CNPJ próprio**, não é filial.
-- Isso fecha a pergunta que estava aberta desde 31/08 e tem três consequências:
--
--   1. Campinas precisa do PRÓPRIO certificado, do próprio cadastro na Focus e
--      da própria numeração. Nada disso existe.
--   2. Transferir peça entre as lojas não é transferência: é VENDA de uma para
--      a outra, com nota de saída e entrada de mercadoria do outro lado.
--   3. Emitir venda de Campinas sob o CNPJ de Brasília seria nota no CNPJ
--      errado — erro fiscal, não de sistema.
--
-- Campinas simplesmente NÃO TEM linha em `fv.fiscal_emitentes`, e o código já
-- trata isso: `emitirNotaDaVenda` recusa com "Esta loja não tem emitente fiscal
-- configurado". A ausência é a trava, e é a trava certa — não depende de
-- ninguém lembrar de manter um `false`.
--
--
-- CONTINUA EM HOMOLOGAÇÃO
--
-- `ambiente` fica em `homologacao` de propósito. Habilitado + homologação é o
-- estado seguro para testar de ponta a ponta: a nota sai de verdade, passa pelo
-- SEFAZ, e NÃO tem validade fiscal.
--
-- Só passa para `producao` quando o CSOSN estiver resolvido com a contadora —
-- hoje o 203 é recusado no schema por exigir os campos de substituição
-- tributária (ver `src/lib/fiscal/montarNfce.ts`).
-- ============================================================================

UPDATE fv.fiscal_emitentes e
   SET habilitado = true,
       ambiente   = 'homologacao',
       updated_at = now()
  FROM fv.stores s
 WHERE s.id = e.store_id
   AND s.name = 'Brasília';

-- Confere: tem de voltar UMA linha, Brasília, habilitada e em homologação.
-- Se voltar Campinas junto, algo está errado — pare e investigue.
SELECT s.name AS loja, e.habilitado, e.ambiente, e.serie_nfce, e.proximo_numero_nfce
  FROM fv.fiscal_emitentes e
  JOIN fv.stores s ON s.id = e.store_id;
