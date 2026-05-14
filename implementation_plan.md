# Implementation Plan — Impressão de Etiquetas Térmicas

> **Módulo:** Fase 2.5 (entre Produtos e Clientes) — Feature de impressão das etiquetas físicas A (90x13mm) e B (30x18mm) na impressora Argox OS-214 Plus.
> **Status:** Aprovado, em execução.
> **Última atualização:** 2026-05-14

---

## 1. Contexto

A Fernanda hoje, pós-viagem a São Paulo, importa produtos no Hiper Gestão (versão desktop), depois usa BarTender com driver Argox para imprimir 2 modelos físicos de etiqueta:
- **A — 90x13mm** (tag comprida): anel, colar, pulseira, broche, tornozeleira
- **B — 30x18mm** (etiqueta pequena, rolo 3 colunas): brinco, bolsa, conjunto, piercing

Cada etiqueta carrega **4 campos**: nome do produto, referência do fornecedor (ex: FWG04329), preço, código de barras Code128.

A engenharia reversa nos `.prn` antigos (linguagem EPL2/PPLB) confirmou os templates de produção:
- **A:** `Etiqueta 9x13.prn` — 1 etiqueta por print, 4 placeholders.
- **B:** `30x18x3 Elgin V1.3.prn` — 3 etiquetas por linha, 4 placeholders.

Objetivo: cortar Hiper e BarTender, gerar tudo dentro do nosso sistema.

---

## 2. Arquitetura técnica

### Stack do transporte
```
Nosso código (Next.js) → pdf-lib + bwip-js → PDF vetor → Diálogo de impressão do navegador → Driver Argox no Windows → Impressora térmica
```

### Por que PDF (e não WebUSB ou agente local)
- **Zero instalação** de app extra na máquina da operadora.
- **HTTPS já garantido** (Vercel).
- **Code128 vetor a 203 dpi** é renderizado com nitidez aceitável pelo driver Argox.
- **Fallback claro**: se o POC mostrar qualidade insuficiente, pivotamos para agente local em ~1 dia sem refazer schema/UI.

### Pré-requisito no PC da operadora (one-time, 5 min)
Configurar perfis no driver Argox:
- **Perfil "Etiqueta A"**: tamanho custom 90×13mm, 1 coluna, velocidade 2-3 ips, densidade 10, sensor Gap.
- **Perfil "Etiqueta B"**: tamanho custom 30×18mm, 3 colunas (gutter ~3mm), mesmas opções.

---

## 3. Modelo de dados

### Schema atual (já existente)
- `fv.purchase_items.label_format` (A|B, NOT NULL) — em uso pelo módulo de compras

### Lacunas (a criar)
| Coluna/Tabela | Tipo | Default | Constraint |
|---|---|---|---|
| `products.supplier_reference` | text | NULL | — |
| `products.label_format` | text | 'B' | CHECK (A\|B), NOT NULL |
| `products.barcode_number` | text | LPAD(nextval(seq), 5, '0') | UNIQUE, NOT NULL |
| `fv.products_barcode_seq` | sequence | start 10000 | — |
| `fv.category_label_mapping` | tabela | — | category PK |

### Backfill
- `label_format`: puxar de `purchase_items` quando o produto veio de uma compra; senão, derivar via `category_label_mapping`.
- `barcode_number`: atribuir sequencial a todos os 107 produtos existentes.

---

## 4. UX — 3 pontos de entrada

### a) Após salvar uma Compra (fluxo pós-SP)
- Toast/modal: "Compra registrada com sucesso. Imprimir etiquetas? [Imprimir agora / Depois]"
- Abre `<EtiquetasPrinter>` filtrado nos itens da compra recém-criada.

### b) Listagem de Produtos
- Checkbox de seleção múltipla (já existente na listagem).
- Botão "Imprimir etiquetas" aparece na toolbar quando há ≥1 selecionado.

### c) Detalhe individual do produto
- Botão "Reimprimir etiqueta" no modal de detalhe. Quantidade padrão = 1.

---

## 5. Componente `<EtiquetasPrinter>` (compartilhado)

Modal/drawer com:
- **Tabela editável** dos produtos: nome | referência | preço | A/B (toggle) | quantidade (editável)
- **Quantidade inteligente**:
  - Origem "Compra" → `purchase_items.quantity`
  - Origem "Listagem" → `products.quantity_in_stock`
  - Origem "Detalhe" → 1
- **Resumo no rodapé**: "X etiquetas A | Y etiquetas B | Total Z"
- **Botão "Gerar"** → produz 2 PDFs em sequência:
  1. PDF A → abre diálogo de impressão
  2. Modal "✓ A enviadas. Troque o rolo para B. [Já troquei / Pular B]"
  3. PDF B → abre diálogo de impressão
  4. "✓ Concluído"

Se o lote tem só A ou só B, pula a etapa do outro.

---

## 6. Layout das etiquetas (replica fiel)

### A — 90x13mm (1 por página)
```
┌──────────────────────────────────────────────────┐
│ NOME DO PRODUTO          │                       │
│ REFERÊNCIA               │  ▮▮▮▮ Code128 ▮▮▮▮    │
│ R$ XX,XX (bold)          │     barcode_number    │
└──────────────────────────────────────────────────┘
```
Texto vertical (rotação 90°), barcode à direita.

### B — 30x18mm (3 por página)
```
┌──────────┐ ┌──────────┐ ┌──────────┐
│NOME      │ │NOME      │ │NOME      │
│REFER     │ │REFER     │ │REFER     │
│R$ XX,XX  │ │R$ XX,XX  │ │R$ XX,XX  │
│▮Code128▮ │ │▮Code128▮ │ │▮Code128▮ │
└──────────┘ └──────────┘ └──────────┘
```

---

## 7. Sequência de entrega

| Fase | Entregável | Tempo |
|---|---|---|
| **1** | Migration (label_format + supplier_reference + barcode_number + mapping table + backfill) | 15min |
| **2** | Instalação `pdf-lib` e `bwip-js` | 5min |
| **3** | POC `/etiquetas/poc` | 1h |
| **4** | **✋ Validação com impressora real (Fernanda)** | — |
| **5** | Ajustes finos de layout/dimensões | 30min |
| **6** | Componente `<EtiquetasPrinter>` | 2h |
| **7** | Integração nos 3 pontos de entrada | 1h |
| **8** | Campos novos no `ProdutoFormModal` | 45min |
| **9** | Tela `/configuracoes/etiquetas` (mapping editável) | 45min |
| **10** | Tutorial config do driver Argox (markdown + prints) | 30min |
| **11** | Atualização schema_database.md + roadmap | 10min |

**Tempo total estimado: ~7h** (sem contar validação manual da Fernanda no passo 4).

---

## 8. Decisões registradas

| # | Decisão | Razão |
|---|---|---|
| 1 | PDF via browser (não agente local, não WebUSB) | UX mínima friction + fallback claro |
| 2 | `barcode_number` separado do `code` | `code` pode repetir (formato F+iniciais+mês+custo); barcode precisa ser único e simples |
| 3 | `label_format` em `products` (não só em `purchase_items`) | Permite reimpressão sem dependência da compra original |
| 4 | Mapping categoria→tipo configurável (tabela própria) | Dona pode ajustar sem dev |
| 5 | Sem logo nas etiquetas | Confirmado pelas fotos das etiquetas atuais |

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| PDF + driver não tem qualidade do BarTender | POC valida antes de codar feature. Fallback agente local 1d. |
| Driver Argox precisa config one-time | Tutorial com prints |
| Sequência barcode estoura 5 dígitos (90k+ produtos) | Aceita 6 dígitos depois; Code128 não limita |
| Capitalização inconsistente de categoria | Normalização LOWER(TRIM()) no mapping |

---

## 10. Critérios de aceite

- [ ] Migration aplicada sem erro, 107 produtos com `barcode_number` único e `label_format` definido
- [ ] POC imprime etiqueta A e B legíveis com Code128 escaneável
- [ ] Fluxo "Imprimir A → trocar rolo → Imprimir B" funcionando em lote
- [ ] Cadastro de produto permite editar `supplier_reference` e override de `label_format`
- [ ] Tela de mapping categoria→tipo funcionando
- [ ] Tutorial de config do driver Argox documentado
- [ ] schema_database.md e roadmap atualizados
