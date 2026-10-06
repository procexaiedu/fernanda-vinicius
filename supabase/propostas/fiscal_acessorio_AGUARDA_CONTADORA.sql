-- ============================================================================
-- PROPOSTA — classificação fiscal das peças da categoria "acessório"
-- ⚠️ AGUARDA CONTADORA. NÃO APLICAR. Não é migration (fica fora de migrations/
-- de propósito) e termina em ROLLBACK.
-- ============================================================================
--
-- O problema (levantado em 06/10/2026, leitura em produção): a categoria
-- `acessório` NÃO tem linha em `fv.fiscal_categorias`, então
-- `fv.fiscal_do_produto` devolve NCM/CFOP/CSOSN nulos e qualquer venda com uma
-- dessas peças fica sem nota. São 56 peças, TODAS de Brasília, todas próprias
-- (nenhuma consignada), 1 unidade cada.
--
-- Por tipo (nome da peça):
--   bolsa / clutch ............. 5    carteira de couro .......... 3
--   lenço ...................... 5    piranha/fivela/banana ..... 14
--   elástico de cabelo ......... 8    tiara/laço/fivela camélia .. 7
--   broche ..................... 5    extensor ................... 3
--   a identificar .............. 6    (casaco, adesivo de orelha, "ACESSORIO CON", camélia mini)
--
-- DUAS SAÍDAS — a contadora escolhe:
--
--   A) Como a loja já faz no Hiper: tudo como bijuteria (71179000 / CEST
--      2805800). É o que as categorias `bolsa` e `acessório de cabelo` já usam
--      hoje (semeado do Hiper em 31/08). Uma linha só, no fim deste arquivo.
--
--   B) NCM técnico por tipo (abaixo, peça a peça em `products`, que sobrescreve
--      a categoria). Bolsa não é bijuteria (cap. 42), lenço é têxtil (cap. 62),
--      acessório de cabelo de plástico é 9615. Os 6 "a identificar" ficam
--      NULOS de propósito: sem NCM a nota não sai, e NCM chutado é pior que
--      nota que não sai (ver validarVenda em src/lib/fiscal/montarNfce.ts).
--
-- Em ambas: CFOP 5102 (revenda de mercadoria de terceiros, dentro do DF) e
-- CSOSN 102 (Simples, sem permissão de crédito — confirmado pela contadora em
-- 04/09 para a loja). Origem 0 (nacional): CONFERIR as peças Swarovski/
-- importadas, que podem ser origem 2 (importada adquirida no mercado interno).
-- CEST só no que é bijuteria (2805800); nos demais vai nulo (não há ST).
-- ============================================================================

BEGIN;

-- ── B) NCM técnico por tipo ─────────────────────────────────────────────────

-- Bolsa de festa com cristal/strass e clutch: 4202.29.00 (bolsas, outras
-- matérias). A de paetê, superfície têxtil: 4202.22.20. CONFERIR o material.
UPDATE fv.products SET codigo_ncm = '42022900', cfop = '5102', csosn = '102', cest = NULL
 WHERE category = 'acessório' AND id IN (
   '1fa1980e-a9df-4f63-93fe-399c90a6cc50',  -- BOLSA CRISTAL
   '797bfef5-9e90-4c33-84ec-6a14320fea89',  -- BOLSA SWAROVSKI
   '38e54162-90be-4d7f-be54-57b610531d76',  -- BOLSA SWAROVSKI
   '411e9dcf-9dc0-47f2-9995-2e81ae853d83'); -- CLUTCH BOTEGA
UPDATE fv.products SET codigo_ncm = '42022220', cfop = '5102', csosn = '102', cest = NULL
 WHERE category = 'acessório' AND id = '13d5e6e6-0c05-4530-b323-3fd074578461'; -- BOLSA PAETE

-- Carteira de couro: 4202.31.00 (artigos de bolso, couro natural).
UPDATE fv.products SET codigo_ncm = '42023100', cfop = '5102', csosn = '102', cest = NULL
 WHERE category = 'acessório' AND id IN (
   'e980be46-84e2-4de0-a32b-7f3d12f492da', '953ebf2a-14fe-4420-826b-d95781d5be9d',
   '01e475b5-411f-421a-8caf-1b0256440495');

-- Lenço: 6214.30.00 (fibras sintéticas). Se for seda: 6214.10.00.
UPDATE fv.products SET codigo_ncm = '62143000', cfop = '5102', csosn = '102', cest = NULL
 WHERE category = 'acessório' AND id IN (
   'e4c3210a-f391-49e9-bf24-df095169157b', '7f9d9663-a479-409c-9870-37a125cbae08',
   'a2c4e9ef-00dc-4c51-9215-49fcb9dc60ee', '87b79988-d539-48be-befc-6b330a47072e',  -- LENCO BOLSA
   'c4bd8568-bb97-4165-9417-e501c81a63fb');                                        -- LENÇO PRETO

-- Piranha, fivela e banana de acetato (plástico): 9615.11.00.
UPDATE fv.products SET codigo_ncm = '96151100', cfop = '5102', csosn = '102', cest = NULL
 WHERE category = 'acessório' AND id IN (
   '4d4f190b-f60b-41e1-8c14-71f376f30e07', 'ae958810-577e-4f4c-bf0c-e536ac35dd2a',
   '04e7d85e-433a-4767-9589-7d0247f13354', '5ae74334-d4b6-491a-8ac0-1f2c5796d2e9',
   'b7ed86ab-679b-41ed-98ad-a8d05dfda8e4', '52d1da0d-52de-44ca-8885-ed78ee4e5db2',
   '7f9d4540-6d0d-45ea-a782-760b56fffea4', 'dcdd8cf1-9dd0-470b-a363-44ce0ddad637',
   'ce7dc22e-a796-4cb2-a693-fd42cecf91ea', '2c48ff76-02fb-403f-a6f1-2d580bda3688',  -- PIRANHA *
   '321775cd-3ffc-4053-928b-fdee3ca50be8', '72880701-d0b1-4d0d-b8ea-a91bd44d9dbf',  -- FIVELA ACETATO
   '98753479-d572-4175-be03-5945a4d40865', '590bc5bb-700b-4028-afcf-3071c3d1b3a3'); -- BANANA FLOR

-- Elástico de cabelo: 9615.19.00 (outras matérias).
UPDATE fv.products SET codigo_ncm = '96151900', cfop = '5102', csosn = '102', cest = NULL
 WHERE category = 'acessório' AND id IN (
   '74fde1ad-34cc-48b5-ae74-a0183aa37fdd', 'b63efe4b-73f8-4a8e-8cdd-9f1353e41935',
   'ac566696-bde3-40c8-89d3-3e79974a520c', '2354ec9e-8414-4a66-b4fa-a87fc685817b',
   'e60ad7ed-2d58-4338-8c5a-334ea2a2254d', '0aee7eb7-b71e-476f-aa72-e6a86b0548b5',
   'ce39fb56-6982-41f7-8041-cd77987926d0', '33effe56-bc25-4562-9c8e-758440e8597c');

-- Tiara, laço de cabelo e fivela camélia: 9615.19.00. Se a tiara for de
-- plástico: 9615.11.00. CONFERIR se os laços são de cabelo ou broche.
UPDATE fv.products SET codigo_ncm = '96151900', cfop = '5102', csosn = '102', cest = NULL
 WHERE category = 'acessório' AND id IN (
   '3d118440-c886-404b-96ed-07b26ea47465', 'abd59f5a-16c7-44dd-9aa5-74f4e8f4773b',
   '13389429-9bd6-4c99-a36f-270c9a7c14dc', '0e920706-3564-4d4a-a875-7e529da89f42',  -- TIARA *
   '40511c7d-5cf6-4651-bcbb-e61d819245cb', '541cf942-c01b-41d3-bcd4-8aa1a53d8bff',  -- LACO CETIM / CRISTAL
   '05efe6b8-8bc4-4e9f-a93e-100a177e073f');                                        -- FIVELA CAMELIA

-- Broche e extensor: bijuteria, igual às categorias `broche` e `extensor`.
-- (Melhor ainda: mudar a categoria dessas 8 peças para broche/extensor.)
UPDATE fv.products SET codigo_ncm = '71179000', cest = '2805800', cfop = '5102', csosn = '102'
 WHERE category = 'acessório' AND id IN (
   '3a723e42-d922-4051-83ec-caa272e6a977', '84d1f263-375a-4e93-9431-53d025d1eaf6',
   'a24ed09a-ec47-49c7-a01d-99a17c3f2bca', 'd9789d7c-5b36-4ec1-8541-7353e828be58',  -- BROCHE FLOR
   '3edd44ea-f3e2-451b-aa44-eb11f037a3c9',                                          -- BROCHE LACO
   'fe97dfb5-e59b-4448-a942-9a84d9a620da', '2c5d9f03-ad4c-46a3-aa54-bf3738daccfb',
   'ea912afd-d0cc-4d5e-b81a-f138ce0b5860');                                        -- EXTENSOR

-- A IDENTIFICAR (ficam nulos — a nota NÃO sai com eles até alguém decidir):
--   42bd6d55-9ffa-4fe2-b962-1ba388c026cd  CASACO INDIANO   (vestuário, cap. 62: 6202.xx conforme o tecido)
--   4e623d1d-a46d-42f0-8bc4-7794d863f4c5  ADESIVO ORELHA   (adesivo de suporte de brinco: 3919.90.00? 3005.10?)
--   87e8be7e-a67c-4fec-9db8-a5bbe9fd7af2  ADESIVO ORELHA
--   3fc003a2-81a2-4890-ba1b-321a2c7f0e96  ACESSORIO CON    (R$198 — perguntar à loja o que é)
--   68d23c06-6c4e-49cd-96a5-6f146ef62806  ACESSORIO CON
--   6343d4a4-53da-486b-98dc-2cc03e5c9aaf  CAMELIA MIN      (broche → 71179000 ou cabelo → 9615.19.00)

-- ── A) Alternativa: tudo como bijuteria (como no Hiper) ─────────────────────
-- Use NO LUGAR do bloco B (não os dois). Cobre também os 6 a identificar e
-- toda peça nova que entrar em "acessório".
--
-- INSERT INTO fv.fiscal_categorias (categoria, codigo_ncm, cest, cfop, unidade, icms_origem, csosn, observacao)
-- VALUES ('acessório', '71179000', '2805800', '5102', 'UN', '0', '102',
--         'Como no Hiper: tudo como bijuteria. Aprovado pela contadora em <data>.')
-- ON CONFLICT (categoria) DO NOTHING;

-- ── Conferência: quantas peças de acessório com saldo ainda sem nota ─────────
-- Esperado com B: 6 (os a identificar). Com A: 0.
SELECT count(*) AS acessorios_sem_classificacao
  FROM fv.fiscal_do_produto f
  JOIN fv.products p ON p.id = f.product_id
 WHERE p.category = 'acessório' AND p.is_active AND p.quantity_in_stock > 0 AND f.incompleto;

-- Troque por COMMIT só depois do OK da contadora.
ROLLBACK;
