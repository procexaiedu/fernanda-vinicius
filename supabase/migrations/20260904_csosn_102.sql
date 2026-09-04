-- ============================================================================
-- CSOSN 203 → 102, por definição da contadora
-- ============================================================================
--
-- Era o ÚNICO bloqueio para a emissão em produção.
--
-- Extraímos 203 do Hiper em 31/08 e semeamos com ele. Em homologação, 02/09, a
-- SEFAZ recusou:
--
--   Element 'vBCST': This element is not expected. Expected is ( modBCST )
--
-- O 203 é "isenção do ICMS no Simples Nacional para faixa de receita bruta COM
-- ST" — declarar 203 obriga a mandar também os campos de substituição
-- tributária (modBCST, pICMSST, vICMSST). A venda de balcão não tem ST, os
-- campos iam vazios, e o schema recusava.
--
-- Com 102 a mesma nota foi AUTORIZADA (status 100, série 3 nº 1).
--
-- O valor NÃO foi trocado na hora, de propósito: qual CSOSN usar é decisão de
-- regime tributário, não escolha de quem escreve o código. A pergunta foi para
-- a contadora, que respondeu em 04/09:
--
--   "se a empresa for optante pelo Simples Nacional o CST é chamado de CSOSN
--    (Código de Situação da Operação no Simples Nacional) [...]
--    102 - Tributada pelo Simples Nacional sem permissão de crédito"
--
-- 11 categorias e 1 emitente. Sem override por produto (`products.csosn` é nulo
-- em todas as 1.333 peças), e `fv.fiscal_do_produto` é VIEW — propaga sozinha.
-- ============================================================================

UPDATE fv.fiscal_categorias
   SET csosn = '102'
 WHERE csosn = '203';

UPDATE fv.fiscal_emitentes
   SET csosn_padrao = '102',
       updated_at   = now()
 WHERE csosn_padrao = '203';
