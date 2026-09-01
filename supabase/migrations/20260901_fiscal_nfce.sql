-- ============================================================================
-- Base fiscal para emissão de NFC-e
-- ============================================================================
--
-- A loja JÁ EMITE NFC-e — 1.429 notas na série 2, pelo Hiper Caixa. Isto não
-- inventa um processo novo: recria no nosso sistema o que já existe e funciona,
-- para a emissão poder sair daqui em vez do sistema antigo.
--
-- Todos os valores semeados abaixo foram lidos da configuração real no Hiper em
-- 31/08/2026, não escolhidos por mim. Onde eu não tinha certeza, deixei nulo.
--
--
-- DECISÃO 1 — Classificação por CATEGORIA, com exceção por peça.
--
-- São 1.245 produtos e 12 categorias. Pedir NCM peça a peça ao contador é
-- trabalho que ninguém termina; pedir por categoria são 12 linhas. A peça herda
-- da categoria e só carrega valor próprio quando destoa — que hoje é o caso de
-- 7 peças de fornecedor de importação, cuja ORIGEM é diferente das demais.
--
-- Por isso as colunas fiscais em `products` nascem TODAS nulas: nulo significa
-- "usa o da categoria", não "faltando". Ver `fv.fiscal_do_produto`.
--
--
-- DECISÃO 2 — O CSC e o certificado NÃO ficam no banco.
--
-- São credenciais: o CSC assina o QR Code da NFC-e e o certificado assina a
-- nota. Ficam em variável de ambiente, como `YCLOUD_API_KEY` já fica — ver
-- src/lib/ycloud.ts. Uma tabela de configuração é lida por qualquer tela que
-- faça `select *`, aparece em backup e em export; variável de ambiente não.
--
-- Aqui mora só o que é público na nota: IE, regime, CSOSN, série, numeração.
--
--
-- DECISÃO 3 — Série 3, começando do 1.
--
-- O Hiper parou na série 2, número 1429, e vai ser desligado. Ainda assim a
-- série nova é preferível a continuar a 2:
--
--   - Separa o que veio de cada sistema. Toda nota da série 3 é do sistema
--     novo, sem precisar olhar data — o que importa quando alguém for auditar
--     a transição daqui a dois anos.
--   - Elimina a única forma de dar errado: se alguém abrir o Hiper Caixa uma
--     vez, por engano, ele emite 1430 e a nossa numeração colide. A SEFAZ
--     rejeita duplicidade e o erro aparece no balcão, na frente da cliente.
--
-- A contabilidade prefere continuidade de numeração; a operação prefere não
-- ter corrida. Pendente de confirmação com a contadora — é a pergunta 3 da
-- mensagem enviada em 31/08.
-- ============================================================================


-- ── 1. Classificação fiscal por categoria ───────────────────────────────────

CREATE TABLE IF NOT EXISTS fv.fiscal_categorias (
  categoria      text PRIMARY KEY,
  codigo_ncm     text,
  cest           text,
  cfop           text,
  unidade        text NOT NULL DEFAULT 'UN',
  icms_origem    text NOT NULL DEFAULT '0',
  csosn          text,
  observacao     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- NCM é sempre 8 dígitos. Guardamos sem pontuação para ir direto na API.
  CONSTRAINT fiscal_categorias_ncm_8_digitos
    CHECK (codigo_ncm IS NULL OR codigo_ncm ~ '^\d{8}$'),
  CONSTRAINT fiscal_categorias_cest_7_digitos
    CHECK (cest IS NULL OR cest ~ '^\d{7}$'),
  CONSTRAINT fiscal_categorias_cfop_4_digitos
    CHECK (cfop IS NULL OR cfop ~ '^\d{4}$'),
  -- Origem é um dígito, 0 a 8 (tabela da NF-e).
  CONSTRAINT fiscal_categorias_origem_valida
    CHECK (icms_origem ~ '^[0-8]$')
);

COMMENT ON TABLE fv.fiscal_categorias IS
  'NCM/CEST/CFOP/origem/CSOSN por categoria de produto. A peça herda daqui; só carrega valor próprio quando destoa.';
COMMENT ON COLUMN fv.fiscal_categorias.codigo_ncm IS
  'Sem pontuação: 71179000, não 7117.90.00. É o formato que a API da SEFAZ recebe.';
COMMENT ON COLUMN fv.fiscal_categorias.icms_origem IS
  '0=nacional, 1=importação direta, 2=mercado interno importado, 3..8 conforme tabela da NF-e.';


-- ── 2. Exceção por peça ─────────────────────────────────────────────────────
--
-- NULO = herda da categoria. Não é "faltando".

ALTER TABLE fv.products
  ADD COLUMN IF NOT EXISTS codigo_ncm  text,
  ADD COLUMN IF NOT EXISTS cest        text,
  ADD COLUMN IF NOT EXISTS cfop        text,
  ADD COLUMN IF NOT EXISTS unidade     text,
  ADD COLUMN IF NOT EXISTS icms_origem text,
  ADD COLUMN IF NOT EXISTS csosn       text;

COMMENT ON COLUMN fv.products.codigo_ncm IS
  'Sobrescreve a categoria. NULO significa "usa o da categoria" — ver fv.fiscal_do_produto.';
COMMENT ON COLUMN fv.products.icms_origem IS
  'Sobrescreve a categoria. É o campo que difere nas peças importadas.';


-- ── 3. A resposta única: qual é a ficha fiscal desta peça? ───────────────────
--
-- Toda tela e a montagem da nota leem DAQUI. Se a herança ficasse espalhada em
-- COALESCE no TypeScript, cada lugar decidiria por conta própria e um dia dois
-- lugares discordariam — que é como nasce nota rejeitada difícil de rastrear.

CREATE OR REPLACE VIEW fv.fiscal_do_produto AS
SELECT
  p.id                                              AS product_id,
  p.category,
  COALESCE(p.codigo_ncm,  c.codigo_ncm)             AS codigo_ncm,
  COALESCE(p.cest,        c.cest)                   AS cest,
  COALESCE(p.cfop,        c.cfop)                   AS cfop,
  COALESCE(p.unidade,     c.unidade,     'UN')      AS unidade,
  COALESCE(p.icms_origem, c.icms_origem, '0')       AS icms_origem,
  COALESCE(p.csosn,       c.csosn)                  AS csosn,
  -- A tela precisa saber o que ainda impede a peça de virar item de nota.
  (COALESCE(p.codigo_ncm, c.codigo_ncm) IS NULL
   OR COALESCE(p.cfop,    c.cfop)       IS NULL
   OR COALESCE(p.csosn,   c.csosn)      IS NULL)    AS incompleto
FROM fv.products p
LEFT JOIN fv.fiscal_categorias c ON c.categoria = p.category;

COMMENT ON VIEW fv.fiscal_do_produto IS
  'Ficha fiscal efetiva por peça, já resolvida a herança categoria→peça. Fonte única: a montagem da NFC-e lê daqui.';


-- ── 4. Emitente por loja ────────────────────────────────────────────────────
--
-- Sem CSC e sem certificado — são credenciais e moram em variável de ambiente.

CREATE TABLE IF NOT EXISTS fv.fiscal_emitentes (
  store_id            uuid PRIMARY KEY REFERENCES fv.stores(id) ON DELETE CASCADE,
  inscricao_estadual  text,
  regime_tributario   smallint NOT NULL DEFAULT 1,
  csosn_padrao        text,
  cnae                text,
  serie_nfce          smallint NOT NULL DEFAULT 3,
  proximo_numero_nfce integer  NOT NULL DEFAULT 1,
  ambiente            text NOT NULL DEFAULT 'homologacao',
  habilitado          boolean NOT NULL DEFAULT false,
  logradouro          text,
  numero              text,
  complemento         text,
  bairro              text,
  cep                 text,
  razao_social        text,
  nome_fantasia       text,
  telefone            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fiscal_emitentes_regime_valido
    CHECK (regime_tributario IN (1, 2, 3)),
  CONSTRAINT fiscal_emitentes_ambiente_valido
    CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT fiscal_emitentes_serie_positiva
    CHECK (serie_nfce > 0),
  -- Só entra em produção quem tem o mínimo para a nota fechar.
  CONSTRAINT fiscal_emitentes_producao_completa
    CHECK (
      ambiente <> 'producao' OR habilitado = false
      OR (inscricao_estadual IS NOT NULL AND csosn_padrao IS NOT NULL
          AND logradouro IS NOT NULL AND cep IS NOT NULL AND razao_social IS NOT NULL)
    )
);

COMMENT ON TABLE fv.fiscal_emitentes IS
  'Dados do emitente por loja. CSC e certificado NÃO ficam aqui — são credenciais, vão em variável de ambiente como a YCLOUD_API_KEY.';
COMMENT ON COLUMN fv.fiscal_emitentes.serie_nfce IS
  'Série 3 por padrão, e não a 2 do Hiper (que parou em 1429). Separa o que veio de cada sistema e elimina a colisão caso alguém abra o Hiper Caixa por engano.';
COMMENT ON COLUMN fv.fiscal_emitentes.habilitado IS
  'Trava de segurança. Enquanto false, nenhuma nota é emitida por esta loja, mesmo com tudo configurado.';


-- ── 5. A nota na venda ──────────────────────────────────────────────────────

ALTER TABLE fv.sales
  ADD COLUMN IF NOT EXISTS nfce_status          text,
  ADD COLUMN IF NOT EXISTS nfce_ref             text,
  ADD COLUMN IF NOT EXISTS nfce_chave           text,
  ADD COLUMN IF NOT EXISTS nfce_numero          integer,
  ADD COLUMN IF NOT EXISTS nfce_serie           smallint,
  ADD COLUMN IF NOT EXISTS nfce_protocolo       text,
  ADD COLUMN IF NOT EXISTS nfce_qrcode_url      text,
  ADD COLUMN IF NOT EXISTS nfce_danfe_url       text,
  ADD COLUMN IF NOT EXISTS nfce_xml             text,
  ADD COLUMN IF NOT EXISTS nfce_motivo_rejeicao text,
  ADD COLUMN IF NOT EXISTS nfce_emitida_em      timestamptz,
  ADD COLUMN IF NOT EXISTS destinatario_cpf     text;

COMMENT ON COLUMN fv.sales.nfce_status IS
  'NULL = não pediu nota. pendente | autorizada | rejeitada | cancelada | erro.';
COMMENT ON COLUMN fv.sales.nfce_ref IS
  'Nossa referência única mandada à API. É ela que torna o reenvio idempotente: mesma ref, mesma nota, nunca duas.';
COMMENT ON COLUMN fv.sales.nfce_xml IS
  'O XML autorizado, guardado AQUI e não só como link do provedor. São duas razões: a lei exige 5 anos + o ano corrente, e é o que permite trocar de provedor (ou emitir direto) sem migração — sem isso, o histórico fiscal fica preso a quem contratamos.';
COMMENT ON COLUMN fv.sales.destinatario_cpf IS
  'Opcional. NFC-e sem identificação do consumidor é documento válido; só entra quando a cliente pede.';

CREATE INDEX IF NOT EXISTS idx_sales_nfce_status
  ON fv.sales (nfce_status) WHERE nfce_status IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_nfce_chave
  ON fv.sales (nfce_chave) WHERE nfce_chave IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_nfce_ref
  ON fv.sales (nfce_ref) WHERE nfce_ref IS NOT NULL;


-- ── 6. Semente: o que a loja JÁ USA hoje ────────────────────────────────────
--
-- Lido da configuração real do Hiper em 31/08/2026, em três amostras de
-- categorias diferentes (brinco, acessório de cabelo, bolsa) — todas iguais.
-- A loja classifica tudo como bijuteria, inclusive o que não é.
--
-- `conserto` fica de fora de propósito: é serviço (remessa para conserto,
-- operação diferente), e a contadora ainda vai dizer como sai.

INSERT INTO fv.fiscal_categorias (categoria, codigo_ncm, cest, cfop, unidade, icms_origem, csosn, observacao)
SELECT c, '71179000', '2805800', '5102', 'UN', '0', '203',
       'Semeado do Hiper em 31/08/2026. A loja usa a mesma classificação de bijuteria para todas as categorias — confirmar com a contadora se alguma deve mudar.'
FROM unnest(ARRAY[
  'brinco', 'colar', 'anel', 'pulseira', 'acessório de cabelo',
  'piercing', 'broche', 'extensor', 'outros', 'pingente', 'bolsa'
]) AS c
ON CONFLICT (categoria) DO NOTHING;


-- ── 7. Semente do emitente de Brasília ──────────────────────────────────────
--
-- É a loja que tem CNPJ, certificado, CSC e credenciamento. Campinas ainda não
-- tem CNPJ — está em abertura — então não entra aqui.
--
-- Nasce em HOMOLOGAÇÃO e com `habilitado = false`: nada é emitido enquanto
-- alguém não ligar de propósito.

INSERT INTO fv.fiscal_emitentes (
  store_id, inscricao_estadual, regime_tributario, csosn_padrao, cnae,
  serie_nfce, proximo_numero_nfce, ambiente, habilitado,
  logradouro, numero, bairro, cep, razao_social, nome_fantasia, telefone
)
SELECT s.id, '0754249400107', 1, '203', '4783101',
       3, 1, 'homologacao', false,
       'SHIS QI 5 Bloco F Sala 322', 'SN', 'Setor de Habitações Individuais Sul',
       '71600500', 'FERNANDA DE OLIVEIRA VINICIUS FARJALLAT COMERCIO DE JOIAS',
       'FERNANDA VINICIUS', '6130466866'
FROM fv.stores s
WHERE s.name = 'Brasília'
ON CONFLICT (store_id) DO NOTHING;


-- ── 8. Permissões e RLS ─────────────────────────────────────────────────────
--
-- O schema fv tem ALTER DEFAULT PRIVILEGES dando ALL em tabela nova para o
-- `anon` — a chave que vai no bundle do navegador. Sem RLS, qualquer pessoa
-- leria e apagaria a configuração fiscal. Ver a migration 20260830.

GRANT SELECT, INSERT, UPDATE ON fv.fiscal_categorias TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON fv.fiscal_emitentes  TO authenticated, service_role;
GRANT SELECT ON fv.fiscal_do_produto TO authenticated, service_role;

REVOKE ALL ON fv.fiscal_categorias FROM anon;
REVOKE ALL ON fv.fiscal_emitentes  FROM anon;
REVOKE ALL ON fv.fiscal_do_produto FROM anon;

ALTER TABLE fv.fiscal_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE fv.fiscal_emitentes  ENABLE ROW LEVEL SECURITY;

-- Classificação fiscal é catálogo: quem está logado lê. Escrita só por admin,
-- e só pelas server actions (service_role ignora RLS).
CREATE POLICY fiscal_categorias_leitura ON fv.fiscal_categorias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY fiscal_emitentes_admin ON fv.fiscal_emitentes
  FOR SELECT TO authenticated USING (fv.is_admin());

CREATE POLICY fiscal_emitentes_operadora ON fv.fiscal_emitentes
  FOR SELECT TO authenticated USING (store_id = fv.get_user_store_id());
