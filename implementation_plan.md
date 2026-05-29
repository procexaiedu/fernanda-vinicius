# Implementation Plan — Responsividade (notebooks/desktops)

> **Módulo:** Responsividade sistemática do sistema inteiro.
> **Status:** Aguardando aprovação.
> **Última atualização:** 2026-05-28

---

## 1. Contexto

O front foi construído e validado num monitor grande. Em notebooks (ex: o da loja, ~1366×768) vários módulos renderizam mal — começando por Produtos. Hoje o sistema é desktop-first **sem nenhum tratamento responsivo** (só o Dashboard tem `@media`).

**Decisões alinhadas:**
- **Alcance:** só notebooks/desktops. Piso garantido: **1366×768**. (Sem celular/tablet.)
- **Abordagem:** varredura sistemática — base fluida + tokens, aplicada módulo a módulo.
- **Tabelas no aperto:** reduzir densidade + esconder colunas menos importantes (detalhe completo continua no modal).
- **Sidebar:** recolhe automaticamente em telas menores (continua expansível manual em telas grandes).

## 2. Causas-raiz (diagnóstico)

| # | Problema | Arquivo |
|---|---|---|
| 1 | Sidebar fixa 240px, não recolhe sozinha | `layout-client.tsx`, `layout.module.css`, `Sidebar.module.css` |
| 2 | Tabelas largas (Produtos: 11 colunas) + `overflow-x: auto` cru | módulos `*Client.module.css` |
| 3 | Tudo em px fixo (fontes, paddings 28px, alturas) | global + todos os módulos |
| 4 | Sem tokens de espaçamento/tipografia fluida | `globals.css` |
| 5 | Alturas com número mágico (`100vh - 260px`) | módulos com tabela |
| 6 | Zero breakpoints (exceto Dashboard) | global |

## 3. Estratégia técnica

### Breakpoints (convenção — px literais, pois `@media` não aceita `var()`)
- **≤ 1440px** — leve: reduz padding de página.
- **≤ 1366px** ("compacto") — sidebar auto-recolhe; densidade de tabela menor; oculta colunas **terciárias**.
- **≤ 1180px** ("apertado", ex: janela não-maximizada / notebook menor) — oculta também colunas **secundárias**; densidade mínima.

### Fundações (globais — alto impacto, baixo risco)
1. `globals.css`: escala de espaçamento (`--space-1..8`), padding de página fluido (`clamp`), e tokens de densidade de tabela (`--table-cell-py/px/fs`) que encolhem por breakpoint.
2. Tipografia: tokens fluidos para títulos/labels via `clamp()` (corpo permanece 14px, encolhe levemente no compacto).
3. **Classes utilitárias globais de prioridade de coluna**: `.colTertiary` (some ≤1366), `.colSecondary` (some ≤1180) — aplicadas em `<th>` e `<td>`.
4. Cap de largura opcional pra leitura em monitores gigantes (a avaliar; data-density geralmente quer largura total).

### Shell
5. Sidebar auto-recolhe: `matchMedia('(max-width: 1366px)')` no `layout-client.tsx` força colapsado em tela pequena; restaura preferência salva em tela grande. Botão manual continua valendo em telas grandes.
6. `.content` padding fluido; `.main` margin-left acompanha o estado da sidebar.

### Padrão de tabela responsiva (reutilizável)
7. Densidade controlada por tokens globais (padding/fonte da célula encolhem por breakpoint).
8. Prioridade de colunas por módulo: marcar quais são terciárias/secundárias com as classes utilitárias. Essenciais nunca somem.
9. `max-height` das tabelas: trocar número mágico por cálculo robusto (ou `flex` + min-height) que respeita telas baixas (768px).

### Modais
10. `Modal.tsx`/`*.module.css`: `max-height: min(90vh, ...)`, scroll interno, padding fluido — pra caber em 768px de altura.

## 4. Sequência de entrega

### Bloco 1 — Fundações (base fluida + tokens + shell)
- 1.1 Tokens (espaçamento, densidade, tipografia fluida) + utilitários de coluna em `globals.css`
- 1.2 Shell: sidebar auto-collapse + paddings fluidos (`layout-client.tsx`, `layout.module.css`)
- 1.3 Modal base responsivo

### Bloco 2 — Piloto: Produtos (estabelece o padrão de tabela)
- 2.1 Aplicar densidade + prioridade de colunas (terciárias: Material, Loja, Promo; secundárias: Fornecedor, Custo — a confirmar) na tabela
- 2.2 Toolbar de filtros: wrap limpo, inputs flexíveis
- 2.3 Validar em 1920/1440/1366/1280

### Bloco 3 — Varredura módulo a módulo (ordem por uso/severidade)
- 3.1 Vendas (PDV `/vendas/nova` — crítico p/ operadoras) + listagem
- 3.2 Compras + `/compras/nova` (grid de itens é largo)
- 3.3 Estoque + transferências
- 3.4 Clientes
- 3.5 Financeiro
- 3.6 Configurações (lojas/usuários/negócio/impressão)
- 3.7 Dashboard (refinar os `@media` existentes p/ a nova convenção)
- 3.8 Modais de detalhe (produto, venda, compra, fornecedor, vendedora, cliente)

### Bloco 4 — Validação + ajustes
- 4.1 Varredura automatizada via **Chrome DevTools MCP** (resize 1920×1080 / 1440×900 / 1366×768 / 1280×720 + screenshots por tela). *Obs: o MCP do Chrome DevTools está desconectado agora — reconectar pra eu automatizar os testes.*
- 4.2 Ajustes finos onde quebrar

## 5. Princípios (pra não virar gambiarra)
- Mudanças primeiro nos **tokens globais** (efeito em cascata), depois ajustes pontuais por módulo.
- **Nada de quebrar o visual no monitor grande** — o desktop continua igual ou melhor; o compacto é que ganha adaptação.
- Reaproveitar os utilitários globais (densidade, prioridade de coluna) em vez de CSS ad-hoc por módulo.
- Cada módulo validado em 1366×768 antes de marcar como pronto.

## 6. Riscos
| Risco | Mitigação |
|---|---|
| Auto-collapse da sidebar conflitar com toggle manual | matchMedia controla só o piso; preferência salva volta em tela grande |
| Esconder coluna esconder info crítica | Essenciais nunca somem; detalhe completo no modal; prioridades revisadas com você |
| Regressão visual no desktop grande | Mudanças são "tightening" por max-width; desktop fica como está |
| `clamp()`/container queries em navegador antigo | Alvos são Chrome/Edge atuais (já exigidos pelo agente) — suporte total |

## 7. Critérios de aceite
- [ ] Todos os módulos usáveis e bem renderizados em **1366×768** (e até ~1180 de janela)
- [ ] Sidebar recolhe sozinha no compacto; expansível no grande
- [ ] Tabelas: densidade adaptativa + colunas priorizadas; sem scroll horizontal sofrível nas essenciais
- [ ] Modais cabem em 768px de altura (scroll interno)
- [ ] Desktop grande sem regressão visual
- [ ] Tokens/utilitários globais reaproveitados (não CSS duplicado por módulo)
