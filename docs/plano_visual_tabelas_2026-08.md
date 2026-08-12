# Plano — Enquadramento de tabelas, filtros, paginação, gráficos e período

**Data:** 12/08/2026 · **Status:** aguardando aprovação
**Método:** tudo abaixo foi medido no Chrome DevTools em 8 telas, com iframe em 1280 / 1440 / 1600px. Nada aqui é suposição.

---

## 1. Por que as tabelas parecem desenquadradas — causa raiz encontrada

Existe uma **zona morta entre ~1367px e ~1520px** de largura de janela onde as tabelas transbordam.

| Largura da janela | Espaço útil | Colunas mostradas | Soma das colunas | Transbordo |
|---|---|---|---|---|
| 1280px | 1153px | 9 de 12 | 1153px | **0** ✓ |
| **1440px** | **1137px** | **12 de 12** | **1189px** | **52px** ✗ |
| 1600px | 1297px | 12 de 12 | 1297px | **0** ✓ |

A regra que esconde colunas de baixa prioridade (`.col-tertiary` em ≤1366px, `.col-secondary` em ≤1180px) mede a **janela**, mas o que precisa caber é a **área de conteúdo** — janela menos a sidebar, que ocupa 240px aberta ou 64px fechada. Resultado: acima de 1366px a regra libera todas as colunas, mas o espaço real só passa a comportá-las perto de 1520px.

**1440×900 é resolução comum de notebook — cai exatamente no meio da zona morta.** É por isso que o problema aparece em todas as abas e não só numa.

**Correção:** trocar os limites por valores derivados do espaço real, e diferenciar sidebar aberta de fechada via `data-sidebar` no elemento raiz:

```
sidebar aberta  (240px):  esconder terciárias em ≤1520px  ·  secundárias em ≤1420px
sidebar fechada (64px):   esconder terciárias em ≤1344px  ·  secundárias em ≤1244px
```

Uma correção, todas as tabelas. Não usar container queries: `container-type` cria bloco de contenção para descendentes `position: fixed`, o que quebraria os dropdowns de filtro (já testado e descartado antes).

---

## 2. Colunas numéricas — três padrões convivendo

Dinheiro e quantidade deveriam alinhar à direita com `tabular-nums`, para os dígitos empilharem. Hoje:

| Tela | Colunas numéricas | Alinhamento atual |
|---|---|---|
| /produtos | Custo, Venda, Promo, Qtd. | **esquerda** ✗ |
| /estoque | Qtd., Venda, Promo | **esquerda** ✗ |
| /fornecedores | Produtos, Total investido, Em aberto | **esquerda** ✗ |
| /clientes | Total gasto | direita, mas **cabeçalho à esquerda** ✗ |
| /disparos | Enviados, Entregues, Lidos | direita, mas **cabeçalho à esquerda** ✗ |
| /compras | Itens, Custo total | direita ✓ |

**Correção:** duas classes globais (`.col-num`, `.col-center`) aplicadas ao `th` **e** ao `td` da mesma coluna, com `font-variant-numeric: tabular-nums`. Cabeçalho herda o alinhamento do corpo — nunca mais divergem.

---

## 3. Scroll interno → paginação de 10 em 10

| Tela | Linhas | Scroll interno | Situação |
|---|---|---|---|
| /produtos | 50 | **2542px** | caixa de 640px com scroll dentro |
| /estoque | 50 | **2441px** | idem |
| /clientes | **760** | página inteira rola | 2,2 MB de HTML por carregamento |
| /fornecedores | 64 | página rola | — |
| /financeiro | 22 | — | ok |
| /compras | 11 | — | ok |
| /disparos | 5 | — | ok |

**Correção:** componente `TabelaPaginada` único, 10 linhas por página, e remoção do `max-height`/scroll interno. Sobre a mecânica, ver a decisão pendente no fim deste documento.

---

## 4. Barra de filtros

| Tela | Controles | Alturas encontradas | Linhas que ocupa |
|---|---|---|---|
| /produtos | 7 | 13, 30, 34 | **3** |
| /estoque | 6 | 13, 30, 34 | 2 |
| /fornecedores | 5 | 13, 30, 32, 34 | 2 |
| /compras | 4 | 30, 34 | 2 |
| /clientes | 5 | 30, 32, 34 | 1 |
| /disparos | 5 | 30, 32, 34 | 1 |
| /financeiro | 9 | **34** (uniforme) | **1** ✓ |

`/financeiro` já é o padrão certo: 9 controles, altura única, uma linha. As outras misturam três alturas diferentes na mesma barra.

**Correção:** componente `BarraFiltros` com altura única de 34px para todo controle, ordem fixa (busca → seletores → alternadores → ação primária à direita), o contador de resultados sempre no mesmo lugar e um botão "limpar filtros" que só aparece quando há filtro ativo.

---

## 5. Gráficos da dashboard

Os três gráficos (`Vendas × Compras`, `Vendas por Categoria`, `Evolução de Vendas`) usam recharts e **já têm tooltip de hover**. Faltam duas coisas:

- **Dado ao clicar** — hover em trackpad de notebook é impreciso; o tooltip desaparece ao tirar o dedo. Vai passar a fixar no clique e só sair ao clicar fora ou em outro ponto.
- **Cores fora dos tokens** — `#E05252` e `#4CAF7D` estão cravados no código, então não seguem o tema nem a paleta de gemas nova. Vão para `var(--gem-*)`.

---

## 6. Filtro de período único

Dois campos separados de início e fim existem em **2 lugares**: `/vendas` e `/financeiro`. (`VendedoraDetalheModal` calcula as datas a partir de mês/ano internamente — não tem campo duplicado, fica como está. Os `DatePicker` de data única em formulários de lançamento também ficam.)

**Correção:** componente `SeletorPeriodo` — um botão só, um popover só:
- calendário de dois meses lado a lado, seleção de intervalo em dois cliques
- mês e ano trocáveis direto (dropdown de mês + stepper de ano), sem clicar em seta 12 vezes para voltar um ano
- atalhos: Hoje · Últimos 7 dias · Este mês · Mês passado · Este ano
- o botão mostra o intervalo escolhido ("01/08 – 12/08/2026")

**Observação à parte:** `/vendas` abre filtrando "hoje" e, como não há venda registrada desde 23/07, a tela abre vazia com "Nenhuma venda encontrada" — parece defeito. Sugiro que o padrão passe a ser "Este mês". Não mudei: é alteração de comportamento, não de visual.

---

## 7. Sidebar e header

Hoje a sidebar tem **11 itens numa lista plana**, o botão de fechar está no **pé**, e o usuário logado (nome, papel, tema, sair) vive no **header**.

**Correção:** os dois pontos de entrada soltos no topo, o resto em coleções, e o rodapé assume o usuário:

```
[fv Fernanda Vinícius]                    ‹     ← fechar sobe para cá
  Dashboard
  PDV
  ── VENDAS ─────────
  Vendas · Clientes · Disparos
  ── ESTOQUE ────────
  Produtos · Estoque
  ── COMPRAS ────────
  Compras · Fornecedores
  ── GESTÃO ─────────
  Financeiro · Configurações
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  [P] ProceX              ☀ ⏻   ← desce do header para cá
      Administrador
```

Racional do agrupamento: `Disparos` fica com `Clientes` porque é contato com cliente, não relatório. `Compras` + `Fornecedores` é o fluxo da mala de SP. Colapsada, os rótulos de grupo viram um traço separador e sobram só os ícones.

O header perde o bloco de usuário e fica só com a trilha de navegação (breadcrumb) — que é o que ele deveria ser.

---

## Ordem de execução

1. Zona morta dos breakpoints (`data-sidebar` + novos limites) — uma correção, todas as tabelas
2. Alinhamento numérico (`.col-num` / `.col-center`) em todas as telas
3. Sidebar em coleções + fechar no topo + usuário no rodapé (sai do header)
4. `BarraFiltros` padronizada
5. `TabelaPaginada` de 10 em 10, removendo o scroll interno
6. `SeletorPeriodo` em `/vendas` e `/financeiro`
7. Gráficos: clique fixa o dado + cores nos tokens

A sidebar vem antes das tabelas de propósito: ela define a largura da área de conteúdo, que é a variável da zona morta do item 1.

Cada etapa é verificada no DevTools nas três larguras (1280 / 1440 / 1600), nos dois estados da sidebar e nos dois temas, antes de seguir para a próxima.

---

## Decisões pendentes

**Mecânica da paginação.** Hoje `/produtos` e `/estoque` paginam no servidor de 50 em 50. Passar para 10 em 10 no servidor significa uma ida ao servidor por página — ~500ms por clique, e 104 páginas para 1031 produtos. A alternativa é continuar buscando 50 do servidor e paginar 10 na tela, o que torna a troca de página instantânea e só vai ao servidor a cada 5 páginas.
