# Implementation Plan — Impressão de Etiquetas Térmicas (v2 — PPLA RAW)

> **Módulo:** Fase 2.5 (entre Produtos e Clientes).
> **Status:** v2 — aguardando aprovação para implementar.
> **Última atualização:** 2026-05-27

---

## 1. Contexto

A Fernanda hoje, pós-viagem a São Paulo, importa produtos no Hiper Gestão (desktop) e imprime 2 modelos físicos de etiqueta:
- **A — 90×13mm** (tag comprida): anel, colar, pulseira, broche, tornozeleira
- **B — 30×18mm** (etiqueta pequena, rolo 3 colunas): brinco, bolsa, conjunto, piercing

Cada etiqueta carrega **4 campos**: nome, referência do fornecedor, preço, barcode Code128.

> **Mudança de abordagem (2026-05-27):** a engenharia reversa do Hiper no notebook antigo (documentada em `IMPRESSAO_ETIQUETAS.md`) revelou que o sistema antigo **não usa PDF nem renderiza graficamente** — ele envia **bytes PPLA brutos** diretamente ao spooler do Windows em modo RAW. A saída foi validada bit-a-bit em impressora física Argox OS-214 plus. Os hex dumps completos dos jobs estão nos apêndices A e B do doc.

Objetivo: replicar exatamente esse comportamento. Cortar Hiper e BarTender.

---

## 2. Arquitetura técnica (v2)

### Stack do transporte
```
Sistema web (Next.js)
   ↓ gera jobText PPLA (strings + cp1252)
   ↓ POST http://localhost:17777/print
Agente local (Node single-file .exe)
   ↓ winspool.drv → StartDocPrinter(RAW) → WritePrinter
Argox OS-214 plus (USB)
```

### Por que essa arquitetura (e não PDF)
- O PDF (POC anterior) força o driver Argox a renderizar via GDI — perde fidelidade.
- O Hiper original valida que mandar bytes PPLA brutos é o caminho correto.
- WebUSB conflita com o driver Argox já instalado (`Access denied`) e quebra outros softwares na máquina.
- Agente local é a única ponte viável entre browser e `winspool.drv` em modo RAW.

### Pré-requisito no PC da operadora (one-time)
1. Instalar `fv-print-agent.exe` (1 clique, ~15 MB, autostart no tray)
2. Driver Argox já existente continua intacto — nada para configurar.

---

## 3. Modelo de dados

**Sem alterações no schema.** As colunas necessárias já existem em `fv.products`:

| Coluna | Tipo | Uso |
|---|---|---|
| `code` | text NOT NULL | Código humano-legível (F+iniciais+...). **NÃO usado no barcode** |
| `name` | text NOT NULL | Linha 1 da etiqueta |
| `supplier_reference` | text NULL | Linha 2 da etiqueta (referência do fornecedor) |
| `sale_price` | numeric NOT NULL | Linha 3 (formatado pt-BR, sem "R$" — vem do template) |
| `barcode_number` | text NOT NULL UNIQUE | **Conteúdo do barcode em ambos os layouts (A=tipo B, B=tipo C)** |
| `label_format` | text NOT NULL DEFAULT 'B' | Escolhe A ou B |

`supplier_reference` `NULL` ou `''` → linha em branco (não quebra PPLA).

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
- **Tabela editável**: nome | referência | preço | A/B (toggle) | qty
- **Quantidade inteligente**:
  - Origem "Compra" → `purchase_items.quantity`
  - Origem "Listagem" → `products.quantity_in_stock`
  - Origem "Detalhe" → 1
- **Indicador do agente**: badge verde "Agente conectado" ou vermelho "Agente offline → Instalar"
- **Resumo**: "X etiquetas A | Y etiquetas B"
- **Botão "Imprimir"** (só habilita com agente online):
  1. Monta `jobText` PPLA para todos com `label_format='A'`
  2. POST /print → modal "✓ A enviadas. Troque o rolo. [Já troquei / Pular B]"
  3. Monta `jobText` para os de `label_format='B'`
  4. POST /print → "✓ Concluído"

Pula etapa se lote tem só A ou só B.

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

## 7. Sequência de entrega (v2)

### Bloco 1 — Limpeza + gerador PPLA (sistema web)
| # | Entregável | Tempo |
|---|---|---|
| 1.1 | Apagar `src/lib/etiquetas/generator.ts` e deps `pdf-lib`, `bwip-js` | 5min |
| 1.2 | `src/lib/etiquetas/ppla.ts` (gerador) | 1h |
| 1.3 | `src/lib/etiquetas/ppla.test.ts` com fixtures dos Apêndices A e B | 1h |
| 1.4 | Reescrever `src/app/(sistema)/etiquetas/poc/page.tsx` para exercitar gerador | 30min |

### Bloco 2 — Agente local (repo separado `fv-print-agent`)
| # | Entregável | Tempo |
|---|---|---|
| 2.1 | Setup Node 20 + TS + fastify | 30min |
| 2.2 | GET /health + GET /printers + POST /print (winspool RAW via `@thiagoelg/node-printer`) | 1h |
| 2.3 | CORS + token opcional | 30min |
| 2.4 | Build single-file `.exe` via `@vercel/ncc` + `pkg` | 1h |
| 2.5 | Tray icon + autostart | 1h |
| 2.6 | Tutorial de instalação (markdown + prints) | 30min |

### Bloco 3 — Integração no sistema web
| # | Entregável | Tempo |
|---|---|---|
| 3.1 | `printAgent.ts` + `useLocalPrintAgent()` hook | 1h |
| 3.2 | `<EtiquetasPrinter>` modal compartilhado | 2h |
| 3.3 | Card "Instalar agente" para estado offline | 30min |
| 3.4 | Integrar nos 3 pontos: pós-compra, listagem produtos, detalhe | 1h |
| 3.5 | Tela `/configuracoes/impressao` (endereço + impressora padrão) | 1h |

### Bloco 4 — Documentação
| # | Entregável | Tempo |
|---|---|---|
| 4.1 | Atualizar `schema_database.md` + `roadmap_desenvolvimento.md` | 15min |
| 4.2 | Vault: registrar achados sobre PPLA + agente local | 20min |

**Tempo total estimado: ~14h** (mais alto que v1 por causa do agente, mas com bem menos risco).

---

## 8. Decisões registradas (v2)

| # | Decisão | Razão |
|---|---|---|
| 1 | **PPLA bruto + agente local** (não PDF, não WebUSB) | Fidelidade idêntica ao Hiper (validada); WebUSB conflita com driver Argox |
| 2 | Reusar `barcode_number` em ambos layouts | Já existe, único, numérico (formato compatível com Hiper); escaneável no PDV |
| 3 | `label_format` em `products` | Permite reimpressão sem depender da compra original |
| 4 | Agente em **Node single-file `.exe`** | Compartilha stack TS com o sistema web; auto-update simples |
| 5 | Sem logo nas etiquetas | Confirmado pelas fotos das etiquetas atuais |
| 6 | Encoding **Windows-1252**, LF (não CRLF), sem STX inicial | Validado no doc; Argox tolera ambos no STX, simplificamos |

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Fixture dos apêndices não bate bit a bit | Diff em hex no test runner; consertar o gerador antes de testar na impressora |
| Agente bloqueado por Windows Defender / SmartScreen | Code-signing futuro; instruções claras de 1ª execução |
| CORS do agente local | Whitelist explícita de origins (localhost + domínio prod) |
| Múltiplas impressoras instaladas | GET /printers lista tudo; user escolhe na config |
| Sequência barcode estoura 5 dígitos (90k+ produtos) | Aceita 6 dígitos depois; PPLA não limita |
| Agente offline quebra o resto do sistema | Hook isolado; só o botão "Imprimir" desabilita, demais features intactas |

---

## 10. Critérios de aceite

- [ ] `src/lib/etiquetas/ppla.ts` gera bytes idênticos aos Apêndices A e B do doc
- [ ] Testes unitários comparam hex byte a byte e passam
- [ ] Agente `fv-print-agent.exe` builda e responde em localhost:17777
- [ ] Etiqueta A e B saem na Argox física idênticas ao Hiper (validação Fernanda)
- [ ] Fluxo "Imprimir A → trocar rolo → Imprimir B" em lote
- [ ] Cadastro de produto permite editar `supplier_reference` e override de `label_format`
- [ ] Tela `/configuracoes/impressao` funcional
- [ ] Estado offline mostra CTA de instalar agente sem quebrar o resto
- [ ] `schema_database.md` e `roadmap_desenvolvimento.md` atualizados
- [ ] POC PDF (`generator.ts`, deps pdf-lib/bwip-js) removidos do branch
