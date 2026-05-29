# Roadmap de Desenvolvimento — Fernanda Vinícius

> **Projeto Procex** | Documento vivo — gerado em 04/05/2026
> **Objetivo:** Estabelecer a ordem cronológica de desenvolvimento, dividindo o sistema em módulos incrementais.

Este roadmap define as fases de implementação do sistema. O desenvolvimento será **estritamente modular**: um módulo deve ser concluído, validado e documentado antes do início do próximo.

---

## Estratégia de Dependências

Para que o desenvolvimento seja fluido, construiremos de baixo para cima (bottom-up), garantindo que as dependências de um módulo já existam quando ele for iniciado.

1. **Setup & Core:** Base da aplicação, layout e usuários (lojas/funcionárias).
2. **Entidades Base:** Configurações, Produtos (catálogo/estoque) e Clientes.
3. **Operações (Entrada/Saída):** Compras (abastece estoque) e Vendas (esvazia estoque).
4. **Agregadores:** Financeiro (lê tudo) e Dashboard (lê tudo).

---

## Fase 0: Setup, Infraestrutura e Layout Base
**Objetivo:** Ter o "esqueleto" do sistema rodando online, com autenticação e navegação prontas.

- [ ] Setup do projeto Next.js (App Router, TypeScript)
- [ ] Criação do projeto no Supabase (Database, Auth, Storage)
- [ ] Execução dos scripts DDL do schema `fv` (19 tabelas) e setup inicial de RLS
- [ ] Implementação do layout global (Desktop-first): Sidebar retrátil, Header, tema visual (Dark mode/Premium)
- [ ] Integração com Supabase Auth (Página de Login)
- [ ] Middlewares de proteção de rota (apenas usuários logados acessam `/`)

## Fase 1: Módulo de Configurações & Administração
**Objetivo:** Gerenciar as entidades essenciais do sistema e os parâmetros globais.

- [ ] CRUD de **Lojas (`stores`)**
- [ ] Gestão de **Usuários (`users`)** (Vinculação de auth.uid() com perfil de Admin/Operator e loja)
- [ ] CRUD de **Configurações (`settings`)** (Regras de negócio como % desconto Pix, meses, etc.)
- [ ] Validação das permissões RLS (Admin vê tudo, Operadora limitada à loja)

## Fase 2: Módulo de Produtos (Catálogo + Estoque)
**Objetivo:** Ter a vitrine digital e a gestão de estoque funcional.

- [ ] CRUD de **Fornecedores (`suppliers`)** (Pré-requisito para cadastrar produtos)
- [ ] CRUD de **Produtos (`products`)**
  - Geração automática do `code` da etiqueta
  - Componente de Autocomplete para `category` e `material`
  - Upload de foto para o MinIO (`photo_url`)
- [ ] Gestão de Estoque Básica (Listagem, busca, filtros por loja)
- [ ] Tela de **Transferências de Estoque (`stock_transfers`)** entre lojas

## Fase 2.5: Impressão de Etiquetas Térmicas (Argox OS-214 Plus)
**Objetivo:** Imprimir etiquetas físicas (A 90×13mm e B 30×18mm) diretamente do sistema, replicando bit-a-bit o stream PPLA validado no Hiper Loja antigo.

- [x] Gerador PPLA (`src/lib/etiquetas/ppla.ts`) — produz bytes idênticos aos Apêndices A e B do `IMPRESSAO_ETIQUETAS.md`
- [x] Testes com fixtures bit-a-bit (12/12 passando)
- [x] Agente local `fv-print-agent` (Node + fastify + `@thiagoelg/node-printer` em modo RAW via `winspool.drv`)
- [x] Cliente HTTP + hook `useLocalPrintAgent()`
- [x] Componente compartilhado `<EtiquetasPrinter>` com fluxo "Imprimir A → trocar rolo → Imprimir B"
- [x] Integração nos 3 pontos: pós-compra, listagem de produtos (multi-select), detalhe do produto
- [x] Tela `/configuracoes/impressao` (endereço do agente, token, impressora padrão, tutorial)
- [ ] Build do `.exe` single-file via pkg/ncc (rodar `npm run build:exe` no diretório `agent/`)
- [ ] Validação física na Argox OS-214 Plus da Fernanda

## Fase 3: Módulo de Clientes
**Objetivo:** Base de CRM para permitir vínculos em vendas futuras.

- [ ] CRUD de **Clientes (`customers`)**
- [ ] Busca/Filtros (Aniversariantes do mês, clientes inativos)
- [ ] Visão de detalhes do cliente (preparada para receber o histórico de compras no futuro)

## Fase 4: Módulo de Compras
**Objetivo:** Abastecer o estoque e gerar as primeiras contas a pagar (transactions).

- [ ] Registro de **Compra (`purchases` e `purchase_items`)**
  - Seleção de fornecedor e adição de itens (criação de produtos no ato)
  - Upload de NF Eletrônica (`nf_url`)
- [ ] Múltiplos pagamentos **(`purchase_payments`)**
  - Geração de parcelas pendentes na tabela `transactions`
- [ ] Gestão de **Consignações (`consignments`)**
  - Controle de prazos e acertos

## Fase 5: Módulo de Vendas
**Objetivo:** A operação de caixa (PDV). Registrar saídas, esvaziar estoque e gerar receita.

- [ ] PDV Rápido: Nova **Venda (`sales` e `sale_items`)**
  - Busca de produtos via código/nome, seleção de cliente
  - Aplicação de regras de negócio automáticas (Settings: desconto pix, aniversário)
- [ ] Múltiplos pagamentos **(`sale_payments`)**
  - Aceitar Pix + Crédito na mesma venda
  - Geração automática de receita (`transactions`)
- [ ] Registro de **Trocas (`exchanges` e `exchange_items`)**
  - Devolução pro estoque e controle de diferença de valor

## Fase 6: Módulo Financeiro
**Objetivo:** A visão da dona. Lucro real, fluxo de caixa e gestão de despesas.

- [ ] Ledger Financeiro: Listagem de **Transações (`transactions`)**
  - Filtros: Entradas x Saídas, Pagas x Pendentes, Por Loja, Por Categoria
- [ ] Gestão de Contas a Pagar/Receber (Alterar `status` pending -> completed)
- [ ] Lançamento de Despesas Manuais Avulsas
- [ ] Templates de **Despesas Recorrentes (`recurring_expenses`)**
  - Worker/Cron para gerar transações pendentes no início do mês
- [ ] Rotina de **Fechamento de Caixa (`cash_closings`)** diário por loja

## Fase 7: Dashboard Principal
**Objetivo:** Consolidar todos os dados em painéis gerenciais.

- [ ] Métricas diárias/mensais: Vendas, Custo, Margem Bruta
- [ ] Alertas: Produtos sem venda há X dias (`v_stale_products`)
- [ ] Alertas financeiro: Sugestão de orçamento para garimpagem
- [ ] Gráficos visuais para tomada de decisão (performance Campinas x Brasília)

---

## Resumo do Processo de Cada Fase

1. **Planejamento Técnico:** O agente lê a documentação, propõe um plano de implementação para o módulo e aguarda aprovação.
2. **Desenvolvimento:** Código criado, focado em UI limpa (Premium/Dark) e regras de negócio no backend (Supabase).
3. **Validação:** Teste da funcionalidade, garantia de que RLS e UI estão de acordo.
4. **Deploy e Documentação:** Atualização do status no roadmap e documentação de componentes relevantes criados.
