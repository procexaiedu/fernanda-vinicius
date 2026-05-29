# Implementation Plan — Metas de Vendas por Vendedora + Comissão

> **Módulo:** Metas mensais de faturamento por vendedora, com progresso e comissão.
> **Status:** Aguardando aprovação.
> **Última atualização:** 2026-05-29

---

## 1. Contexto

A dona quer definir metas mensais de faturamento por vendedora, acompanhar o progresso (realizado vs meta) e pagar comissão quando a meta é batida. Hoje não existe conceito de meta/comissão no schema.

## 2. Decisões alinhadas

| Tema | Decisão |
|---|---|
| Base da meta | **Faturamento em R$** por vendedora/mês |
| Atribuição do realizado | **`seller_id`** (vendedora real) — vendas `status='completed'`, por `sale_date` no mês |
| Recorrência | Meta **padrão recorrente** + **override por mês** (mantém histórico) |
| Comissão | **% por vendedora**, incide sobre **todo o faturamento do mês** quando atinge **≥100%** da meta |
| Visibilidade | Admin define e vê todas; operadora vê **só a dela** |
| Financeiro | Comissão **gera despesa** (transação) no ledger |
| Consistência | Alinhar a tela de Usuários pra contar por `seller_id` também |

### Achado importante (do schema ao vivo)
`sales` grava `user_id` (quem registrou) **e** `seller_id` (vendedora escolhida, default = quem registrou). A tela de Usuários hoje agrega por `user_id` — será corrigida para `seller_id` para bater com as metas.

## 3. Modelo de dados (migration nova)

### Tabela `fv.seller_goals`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NOT NULL FK users(id) | a vendedora |
| month | date NULL | **NULL = meta padrão recorrente**; 1º dia do mês = override daquele mês |
| target_amount | numeric(12,2) NOT NULL | meta de faturamento |
| commission_pct | numeric(5,2) NOT NULL default 0 | % de comissão da vendedora |
| created_at / updated_at | timestamptz | |

**Unicidade:**
- índice único parcial `(user_id) where month is null` (uma meta padrão por vendedora)
- único `(user_id, month) where month is not null` (um override por mês)

**Resolução da meta efetiva do mês M:** `override(user,M) ?? default(user)`. Sem nenhuma → vendedora sem meta (não entra em comissão).

**RLS:** admin total; operadora `SELECT` só onde `user_id = auth.uid()`.

### Comissão → `fv.transactions`
Gerada por ação do admin (idempotente). Para cada vendedora com realizado ≥ meta:
- `type='expense'`, `category='Comissão'`, `amount = realizado * commission_pct/100`
- `status='pending'` (a pagar), `transaction_date` = 1º dia do mês seguinte, `due_date` idem
- `user_id` = vendedora, `store_id` = loja da vendedora
- `reference_type='seller_commission'`, `reference_id` = id da `seller_goals` efetiva (ou null), `description` = "Comissão {nome} — {MM/AAAA}"
- **Idempotência:** se já existe transação `seller_commission` da vendedora naquele mês → atualiza o `amount`; senão cria.

## 4. UI

### a) Definição — aba "Metas" em Configurações (admin)
- Lista de vendedoras (users role operator + admin que vende) com: meta padrão (R$), % comissão, e meta do mês selecionado (override opcional).
- Seletor de mês no topo. Editar meta padrão e/ou override do mês inline.
- Botão **"Gerar/atualizar comissões do mês"** (idempotente) → cria as despesas no Financeiro para quem bateu.

### b) Acompanhamento (admin)
- Tela de Usuários: adicionar **barra de progresso** (realizado/meta, % atingido) e comissão projetada por vendedora.
- `FuncionariaDetalheModal`: seção de meta/progresso/comissão do mês.

### c) Operadora — "Minha meta do mês"
- Como Configurações é admin-only, a operadora vê a própria meta num **card na página de Vendas** (realizado, meta, % atingido, comissão projetada).

## 5. Sequência de entrega

### Bloco 1 — Migration
- 1.1 `seller_goals` + índices únicos parciais + RLS (via Supabase MCP `apply_migration`)

### Bloco 2 — Server actions (`metas/actions.ts`)
- 2.1 `getMetasDoMes(month)` — vendedoras + meta efetiva + realizado(seller_id) + progresso + comissão projetada
- 2.2 `upsertMetaPadrao(userId, target, pct)` e `upsertMetaMes(userId, month, target, pct)`
- 2.3 `gerarComissoesDoMes(month)` — idempotente, grava despesas no ledger
- 2.4 `getMinhaMetaDoMes()` — para a operadora (própria)

### Bloco 3 — UI definição
- 3.1 Aba "Metas" no `ConfigNavTabs` + página `/configuracoes/metas` + client

### Bloco 4 — UI acompanhamento
- 4.1 Progresso na tela de Usuários
- 4.2 Seção de meta no `FuncionariaDetalheModal`
- 4.3 Card "Minha meta" na página de Vendas (operadora)

### Bloco 5 — Consistência de atribuição
- 5.1 Trocar agregação `user_id` → `seller_id` em `configuracoes/usuarios/page.tsx` e `FuncionariaDetalheModal`

### Bloco 6 — Docs
- 6.1 `schema_database.md` (nova tabela) + `roadmap_desenvolvimento.md`

## 6. Pontos a confirmar na aprovação
- **Geração da comissão:** proponho **manual** (botão "Gerar comissões do mês"), idempotente — admin controla quando o mês fechou. (Alternativa: cron automático no fim do mês — exige infra de agendamento.)
- **Operadora vê a meta na página de Vendas** (card "Minha meta") — ok?
- **Trocas/devoluções:** v1 considera só `sales.total` (completed); trocas não abatem o realizado. Refinar depois se necessário.

## 7. Riscos
| Risco | Mitigação |
|---|---|
| Comissão recalcula se vendas mudam após gerar | Geração idempotente atualiza o valor; admin regenera antes de pagar |
| Inconsistência seller_id vs user_id em dados antigos | seller_id tem default=user_id, então sempre preenchido; alinhamento cobre as telas |
| Meta efetiva ambígua (override vs padrão) | Regra clara: override do mês vence; senão padrão; senão sem meta |
| Duplicar despesa de comissão | Idempotência por (reference_type, user, mês) |

## 8. Critérios de aceite
- [ ] Admin define meta padrão e override mensal + % comissão por vendedora
- [ ] Realizado medido por `seller_id` (vendas completed do mês)
- [ ] Progresso (barra + %) na tela de Usuários e no detalhe da vendedora
- [ ] Operadora vê só a própria meta/progresso
- [ ] "Gerar comissões do mês" cria despesas corretas e idempotentes no Financeiro
- [ ] Tela de Usuários alinhada para `seller_id`
- [ ] schema_database.md + roadmap atualizados
