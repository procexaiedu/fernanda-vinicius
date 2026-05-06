# Fernanda Vinícius — Contextualização do Projeto

> **Projeto Procex** | Documento vivo — atualizado em 04/05/2026  
> **Diretor de Produto:** Boris (até haver reuniões semanais com a cliente)  
> **Desenvolvedor:** Banos  
> **Cliente:** Fernanda (dona) + 2 funcionárias

---

## 1. Visão Geral do Negócio

**Fernanda Vinícius** é uma empresa familiar de varejo de **joias e semi-joias**, operada pela Fernanda. O negócio tem mais de 20 anos de história e é baseado no relacionamento pessoal da dona com suas clientes.

### Modelo de Negócio
- Varejo físico em lojas próprias
- Compra de peças em fornecedores de São Paulo (viagens quinzenais)
- Modelo de **coleções rotativas** — alto giro, poucos produtos voltam ao estoque
- Algumas peças em **consignação** de fornecedores
- Sem e-commerce, sem vendas online estruturadas
- Eventos presenciais esporádicos (datas comemorativas) com alto sucesso de vendas

### Lojas

| Loja | Cidade | Status | CNPJ | Funcionária | Observação |
|------|--------|--------|------|-------------|------------|
| Campinas | SP | Ativa (principal) | PJ próprio | 1 funcionária | Opera normalmente, vendas de R$4-5k em dias bons |
| Brasília | DF | Ativa (à venda) | PJ próprio | 1 funcionária | Performance ruim, vendas quase zeradas. À venda por falta de gestão remota |

> **Decisão:** O sistema deve ser **multi-loja desde o início**. Quando Brasília for vendida, apenas desativa. Se abrir novas lojas no futuro, já está preparado.

### Números Relevantes

| Métrica | Valor |
|---------|-------|
| Margem de lucro | 100% a 200% (multiplicador médio: **2,5x**) |
| Ticket médio | R$ 100–400 (maioria) |
| Peças mais caras | Até R$ 2.000–3.000 (prata) |
| Gasto por compra (SP) | R$ 10.000–25.000 |
| Frequência de compra | Quinzenal |
| Volume vendas/dia (Campinas) | R$ 4.000–5.000 (dias bons) |

---

## 2. Operação Atual — Mapeamento Completo

### 2.1 Fluxo de Compra (Entrada de Estoque)

```
Fernanda vai a SP (quinzenal)
    → Visita múltiplos fornecedores (variam a cada viagem)
    → Garimpa peças interessantes por instinto/experiência
    → Compra a maioria parcelada (poucos à vista)
    → Recebe NF eletrônica de todos os fornecedores
    → Algumas peças são consignação
    → Cria código do produto (F + iniciais fornecedor + mês + custo disfarçado)
    → Importa dados no Hiper APENAS para imprimir etiquetas
    → Distribui entre as lojas
```

**Problemas identificados:**
- Não sabe quanto pode gastar antes de ir comprar
- Não tem visibilidade do estoque atual para decidir o que comprar
- Compra parcelada sem controle das parcelas a vencer
- Perde desconto à vista por falta de fluxo de caixa

### 2.2 Código do Produto

O código é criado pela Fernanda e vai impresso na **etiqueta** junto com o preço de venda. A estrutura é:

```
F + [Iniciais do Fornecedor] + [Mês da compra (2 dígitos)] + [Custo em centavos, sem separador]
```

**Exemplos reais:**

| Fornecedor | Mês | Custo | Código |
|-----------|-----|-------|--------|
| Maria Joias | Novembro (11) | R$ 135,90 | `FMJ1113590` |
| Jonas Carlos | Abril (04) | R$ 129,00 | `FJC04129` |

> [!NOTE]
> O custo fica "escondido" dentro do código — as funcionárias e clientes não sabem interpretar. Esse sistema funciona há anos e **não precisa ser alterado**. O sistema digital deve replicar essa lógica, armazenando o custo real de forma segura (visível apenas para a Fernanda). O sistema deve gerar o código automaticamente com base no fornecedor, data e custo informados no cadastro.

### 2.3 Fluxo de Venda

```
Cliente entra na loja
    → Escolhe peça(s)
    → Funcionária registra na BOLETA FÍSICA:
        - Itens vendidos
        - Valor
        - Nome do cliente
        - Data
    → Pagamento via Cielo:
        - Crédito (5x s/ juros, 6x s/ juros acima de R$3k)
        - Débito
        - Pix (5% de desconto sobre valor total)
        - Dinheiro
        - Pagamento misto (ex: parte Pix + parte crédito)
        - Desconto de 10% no mês de aniversário da cliente (Pix ou cartão)
    → Se precisar de desconto ou troca → liga para Fernanda
    → No fim do dia → fechamento de caixa com boletas
    → Funcionária liga para Fernanda reportando o dia
```

**Problemas identificados:**
- Boleta física consome tempo e não gera dados digitais
- Sem histórico de compras por cliente
- Sem visibilidade em tempo real para a Fernanda (especialmente Brasília)
- Funcionária depende de ligação para qualquer decisão
- Fechamento de caixa manual, sujeito a erros

### 2.4 Consignação

```
Fernanda pega peças do fornecedor (consignação)
    → Tenta vender nas lojas
    → O que vendeu → paga ao fornecedor
    → O que não vendeu → devolve ao fornecedor
```

Cada fornecedor tem suas próprias condições de consignação. O sistema deve ser **versátil** e aceitar por fornecedor/lote:
- **Prazo de pagamento/devolução** (data limite)
- **Preço de compra** das peças consignadas
- **Valor mínimo de compra** em % do lote (se aplicável)

> [!NOTE]
> A consignação funciona por confiança. Fernanda tem bom relacionamento com fornecedores. O sistema precisa separar **estoque próprio** de **estoque consignado** para saber o que é dela e o que precisa ser devolvido/pago.

### 2.5 Clientes

| Aspecto | Situação Atual |
|---------|---------------|
| Base de dados | Agenda do celular das lojas (Campinas e Brasília) |
| Registro | Nome + telefone nas boletas físicas |
| Pós-venda | Esporádico — eventual mensagem ou ligação |
| Eventos | Datas comemorativas, coffee break, disparo para 50-150 clientes |
| Canais de chegada | Walk-in, indicação, Instagram (inativo), WhatsApp (fraco) |
| Rastreamento | Nenhum — não sabe de onde os clientes vêm |

**Problemas identificados:**
- Sem CRM — não sabe quem comprou o quê, quando
- Não identifica clientes inativos
- Eventos funcionam muito bem mas são totalmente manuais
- Instagram e WhatsApp subutilizados
- Sem dados para marketing direcionado

### 2.6 Financeiro

| Aspecto | Situação Atual |
|---------|---------------|
| Gestão | **Inexistente** |
| Responsável | Ninguém |
| Fluxo de caixa | Não existe |
| Contas | PJ e PF separadas, mas mistura na prática |
| Controle de gastos | Despesas fixas anotadas, sem visão completa |
| Margem por produto | Sabe o multiplicador (2,5x) mas não tem análise |
| Decisão de compra | Por instinto — não sabe quanto pode gastar |

**Problemas identificados:**
- Não sabe se está dando lucro ou prejuízo real
- Vende bem → gasta muito → aperta quando vende mal (ciclo vicioso)
- Sem visibilidade de parcelas a pagar (compras parceladas)
- Sem separação clara PJ/PF na prática
- Não consegue fazer gestão financeira — **precisa de educação junto com o sistema**

### 2.7 Ferramentas Atuais

| Ferramenta | Uso Real | Dados Aproveitáveis |
|-----------|----------|---------------------|
| Hiper | Apenas importação para etiquetas | ❌ Nenhum (só entradas, sem saídas, sem vendas) |
| Cielo | Pagamentos (crédito, débito, Pix) | ⚠️ Tem portal com transações — não utilizado |
| WhatsApp (celular da loja) | Comunicação informal com clientes | ⚠️ Contatos na agenda |
| Google Meu Negócio | Presença superficial | ❌ Desatualizado |
| Instagram | Inativo | ❌ Sem postagens recentes |
| Boletas físicas | Registro de todas as vendas | ⚠️ 20+ anos, inviável digitalizar em massa |

---

## 3. Perfil dos Usuários

### Fernanda (Dona)
- **Papel:** Compradora, vendedora eventual, tomadora de decisão
- **Dispositivo:** Notebook pessoal (de casa e na loja)
- **Nível técnico:** Baixo, mas sem resistência. Aprende se ensinada de forma didática
- **O que precisa ver:** Visão geral do negócio — vendas, estoque, finanças, clientes
- **Sonho:** "Viver comprando e vendendo, sem cuidar de mais nada"
- **Dor principal:** Não saber quanto pode gastar, não ter controle de nada

### Funcionárias (2)
- **Papel:** Vendedora, abre/fecha loja, organiza vitrine
- **Dispositivo:** Celular da loja + notebook na loja (confirmado)
- **Nível técnico:** Baixo. Precisam de interface simples e treinamento
- **Autonomia:** Limitada — consultam Fernanda para descontos, trocas
- **O que precisam fazer:** Registrar vendas, consultar preços, registrar clientes
- **Sem resistência:** Farão o que Fernanda determinar

---

## 4. Dores Priorizadas e Impacto

| # | Dor | Impacto | Prioridade |
|---|-----|---------|-----------|
| 1 | Sem controle financeiro — não sabe quanto pode gastar | Ciclo de gastos excessivos seguido de aperto | 🔴 Crítica |
| 2 | Sem registro digital de vendas | Sem dados, sem histórico, sem análise | 🔴 Crítica |
| 3 | Sem controle de estoque | Não sabe o que tem, compra duplicado, peças paradas | 🔴 Crítica |
| 4 | Sem base de clientes | Não consegue fazer pós-venda, eventos são manuais | 🟡 Alta |
| 5 | Boleta física consome tempo | Processo lento e sem dados digitais | 🟡 Alta |
| 6 | Gestão remota impossível (Brasília) | Loja dando prejuízo por falta de visibilidade | 🟡 Alta |
| 7 | Funcionária sem autonomia | Liga para cada decisão, processo travado | 🟢 Média |
| 8 | Canais digitais inativos | Perde vendas potenciais | 🔵 Futura |
| 9 | Sem marketing/CRM ativo | Depende de walk-in e indicação | 🔵 Futura |

---

## 5. Escopo 1 — Gestão Administrativa Core

### Filosofia do Escopo

> **"Registrar compra + registrar venda = estoque + financeiro de graça."**

O insight central é que os fluxos de **entrada de estoque (compra)** e **registro de venda** são os dois movimentos fundamentais. Deles, derivam-se automaticamente:
- **Estoque:** entrada na compra, baixa na venda
- **Financeiro:** custo na compra, receita na venda, margem por produto
- **Clientes:** vinculados à venda

Portanto, o Escopo 1 NÃO são 4 módulos separados — é **um sistema integrado** onde compra e venda alimentam tudo.

### 5.1 Módulos do Escopo 1

#### 📦 Cadastro de Produtos
- Cadastro com: nome, código (lógica atual), categoria, material, preço de custo, preço de venda, foto (opcional)
- Categorias dinâmicas (colar, anel, brinco, pulseira, bolsa + novas)
- Marcação de material (prata, banhado, etc.)
- Fornecedor vinculado ao produto
- Suporte a etiqueta (manter compatibilidade com formato atual)

#### 📥 Entrada de Estoque (Compra)
- Registro de compra com: fornecedor, data, itens, custo unitário, forma de pagamento
- Status: **Próprio** ou **Consignação**
- Se consignação: controle de devolução e prazo
- Cada item entra no estoque automaticamente
- Custo registrado no financeiro automaticamente
- Suporte a NF eletrônica (upload de XML/DANFE)
- Loja destino (Campinas ou Brasília)

#### 🛒 Registro de Venda (substitui a boleta)
- Registro rápido: selecionar peça(s) + cliente + forma(s) de pagamento
- Formas: crédito, débito, Pix, dinheiro
- **Pagamento misto:** aceita múltiplas formas na mesma venda (ex: R$200 Pix + R$300 crédito 3x)
- **Regras de desconto (automáticas):**
  - 5% no Pix (qualquer compra)
  - 10% no mês de aniversário da cliente (Pix ou cartão)
  - Promoções esporádicas criadas pela Fernanda: preço promocional por peça (em % ou valor fixo)
- **Regras de parcelamento:**
  - 5x sem juros para qualquer compra
  - 6x sem juros para compras acima de R$ 3.000
- Funcionárias aplicam apenas os descontos pré-configurados — sem necessidade de ligar para Fernanda
- Baixa automática no estoque
- Receita registrada no financeiro automaticamente
- Fechamento de caixa digital (totais do dia por forma de pagamento)
- Vinculação com cliente (nome, telefone, data de aniversário, CPF, endereço)
- **Trocas:** prazo de 30 dias a partir da data da venda. Sistema deve registrar a troca e devolver a peça ao estoque

#### 💰 Financeiro (Visão)
- Dashboard com: receita, custo, lucro bruto (por dia/semana/mês)
- Visão por loja
- Parcelas a pagar (compras parceladas)
- Parcelas a receber (vendas parceladas)
- **Despesas fixas e variáveis:** cadastro de contas recorrentes (aluguel, salário, energia) que geram cobranças pendentes automaticamente a cada mês. Fernanda marca como paga quando quitar
- **Despesas avulsas:** registro manual de gastos que não são recorrentes
- **Status de pagamento:** toda transação (venda, compra, despesa) tem status de paga ou pendente
- **Sugestão de compra calculada automaticamente:** com base no saldo disponível, parcelas a vencer e média de vendas recentes, o sistema sugere quanto pode gastar na próxima viagem a SP
- **Indicador educativo:** "Você faturou X, gastou Y, sobram Z para compras"

#### 👥 Clientes (Básico)
- Cadastro: nome, telefone, data de aniversário, CPF, endereço, loja de origem
- Histórico de compras vinculado automaticamente pela venda
- Indicador de inatividade ("não compra há X dias")
- Filtro por mês de aniversário (para aplicar desconto de 10%)
- Exportação de lista para disparo manual de WhatsApp (para eventos)

#### 📊 Dashboard Principal
- Visão geral: vendas do dia/semana/mês por loja
- Estoque: total de peças, peças consignadas, peças paradas há muito tempo
- Financeiro resumido: faturamento, custo, margem
- Clientes: total, novos no mês, inativos
- **Visibilidade remota** — Fernanda vê tudo de qualquer lugar

### 5.2 O que NÃO entra no Escopo 1

| Funcionalidade | Motivo | Escopo Futuro |
|---------------|--------|---------------|
| E-commerce / catálogo online | Foco é organizar antes de crescer | Escopo 2+ |
| Integração Cielo automática | Complexidade vs. valor nesta fase | Escopo 2+ |
| Integração WhatsApp / Mensageria | Requer infra de agentes | Escopo 3+ |
| Marketing / CRM ativo | Precisa de base de dados primeiro | Escopo 2+ |
| Instagram / Redes sociais | Fora do core administrativo | Escopo 3+ |
| Agentes de IA | Dependem de dados e processos estáveis | Escopo 4+ |
| Emissão de NF + Etiquetas integrados | Hoje feito pelo Hiper, integrar ao sistema | Escopo 2 |
| App mobile nativo | Desktop-first, mobile depois | Escopo 2+ |
| Integração com Hiper | Hiper só faz etiqueta, sem valor de integração | Avaliar |
| Tráfego pago / Ads | Requer presença digital primeiro | Escopo 3+ |

---

## 6. Decisões Técnicas

### Stack

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| Frontend | **Next.js** (App Router), TypeScript | Stack que Banos domina, SSR, produtivo |
| Estilo | **Vanilla CSS** + Custom Properties | Padrão Procex |
| Banco de dados | **Supabase** (Postgres) | Infra Procex, auth, realtime |
| Storage | **MinIO** (infra Procex) | Fotos de produtos, NFs eletrônicas |
| Auth | **Supabase Auth** | Fernanda = admin, funcionárias = operadoras |
| Hosting (sistema) | **Vercel** | Frontend Next.js, deploy automático |
| Hosting (workers) | **Portainer** (VPS Procex) | Crons, workers, agentes futuros |
| Domínio | Subdomínio Procex: `fv.procexai.tech` | Confirmado |

### Princípios de Design

| Princípio | Detalhe |
|-----------|---------|
| **Desktop-first** | Notebook como dispositivo principal. Responsivo depois |
| **Interface didática** | Linguagem simples, tooltips educativos, confirmações claras |
| **Rápido para registrar** | A venda precisa ser registrada em segundos, não minutos |
| **Visibilidade para a dona** | Dashboard com números grandes, cores claras (verde = bom, vermelho = atenção) |
| **Multi-loja** | Toda operação é contextualizada por loja |
| **Custo invisível** | Funcionárias NÃO veem preço de custo. Apenas Fernanda (admin) |
| **Regras de negócio definidas** | Pix 5%, aniversário 10%, 5x s/ juros, 6x acima de R$3k, promoções por peça |

### Perfis de Acesso

| Perfil | Usuário | Permissões |
|--------|---------|-----------|
| **Admin** | Fernanda | Tudo — financeiro, custos, configurações, todas as lojas |
| **Operadora** | Funcionárias | Registrar venda, consultar estoque (sem custo), cadastrar cliente, ver metas do dia |

---

## 7. Pontos em Aberto

> Itens que precisam ser validados com a cliente (Fernanda) ou confirmados pelo Boris antes da implementação.

| # | Ponto | Impacto | Status |
|---|-------|---------|--------|
| 1 | ~~Código do produto~~ | ~~Define como replicar no sistema~~ | ✅ Resolvido — F + iniciais + mês + custo |
| 2 | ~~Desconto no Pix~~ | ~~Configuração do sistema~~ | ✅ Resolvido — 5% |
| 3 | ~~Parcelas~~ | ~~Configuração do sistema~~ | ✅ Resolvido — 5x qualquer, 6x acima 3k |
| 4 | ~~NFs de compra~~ | ~~Upload de foto ou parsing~~ | ✅ Resolvido — Eletrônicas |
| 5 | ~~NF de venda~~ | ~~Integração fiscal~~ | ✅ Resolvido — Sim, emite (manual por ora) |
| 6 | ~~Desconto máximo funcionária~~ | ~~Regra de negócio~~ | ✅ Resolvido — Apenas os pré-configurados (5% Pix, 10% aniversário) |
| 7 | ~~Categorias~~ | ~~Seed do banco~~ | ✅ Resolvido — Gerenciável via sistema, iniciar com: colar, anel, brinco, pulseira, bolsa |
| 8 | ~~Materiais~~ | ~~Atributos do produto~~ | ✅ Resolvido — Gerenciável via sistema, iniciar com: prata, banhado |
| 9 | ~~Ticket médio~~ | ~~Validação do modelo~~ | ✅ Resolvido — Calculado automaticamente pelo sistema |
| 10 | ~~Notebook na loja~~ | ~~Dispositivo de operação~~ | ✅ Resolvido — Sim, confirmado |
| 11 | ~~Hosting~~ | ~~Infra de deploy~~ | ✅ Resolvido — Vercel (sistema) + Portainer (workers) |

### Pontos resolvidos nesta rodada

| # | Ponto | Impacto | Status |
|---|-------|---------|--------|
| 12 | ~~Consignação~~ | ~~Fluxo de devolução~~ | ✅ Resolvido — Versátil por fornecedor: prazo, preço, % mínimo |
| 13 | ~~NF de venda~~ | ~~Integração fiscal~~ | ✅ Resolvido — Hiper por ora, integrar no Escopo 2 junto com etiquetas |
| 14 | ~~Trocas/devoluções~~ | ~~Regra de negócio~~ | ✅ Resolvido — 30 dias para troca |

> [!TIP]
> **Todos os pontos em aberto foram resolvidos.** O documento está pronto para servir de base à documentação técnica.

---

## 8. Entrega Esperada do Escopo 1

### Para a Fernanda (cliente)
> "Eu abro o sistema no meu notebook e vejo: quanto vendi hoje, quanto tenho em estoque, quanto posso gastar na próxima compra, e quais clientes não vêm há tempo. Minhas funcionárias registram as vendas ali mesmo, e eu não preciso mais ligar para saber o que aconteceu."

### Critérios de Sucesso
- [ ] Toda venda é registrada digitalmente (substitui a boleta para novas vendas)
- [ ] Toda compra de estoque é registrada com custo
- [ ] Dashboard mostra faturamento, custo e margem por período
- [ ] Dashboard mostra estoque por loja com alerta de peças paradas
- [ ] Clientes são cadastrados automaticamente na venda
- [ ] Lista de clientes inativos disponível
- [ ] Fernanda vê dados de ambas as lojas remotamente
- [ ] Fechamento de caixa digital funcional
- [ ] Funcionárias conseguem operar sem treinamento extenso
- [ ] Sistema acessível via navegador no notebook

---

## 9. Glossário

| Termo | Significado |
|-------|------------|
| **Boleta** | Registro físico de venda em papel, usado atualmente |
| **Garimpagem** | Processo de busca e seleção de peças nos fornecedores de SP |
| **Código do produto** | Código na etiqueta: F + iniciais do fornecedor + mês da compra + custo disfarçado (ex: `FMJ1113590`) |
| **Consignação** | Peças emprestadas pelo fornecedor — paga o que vende, devolve o resto |
| **Hiper** | Sistema existente usado apenas para impressão de etiquetas |
| **Cielo** | Maquininha de pagamento (crédito, débito, Pix, dinheiro) |
| **Peça parada** | Produto em estoque sem venda há muito tempo |
| **Coleção** | Conjunto de peças novas trazidas de uma viagem de compra |

---

## 10. Próximos Passos

1. ~~**Validar este documento**~~ ✅ Validado
2. ~~**Responder pontos em aberto**~~ ✅ Todos resolvidos (seção 7)
3. ~~**Criar documentação técnica**~~ ✅ Schema criado (`docs/schema_database.md` — 19 tabelas)
4. **Criar roadmap de desenvolvimento** — definir fases, sprints e prioridades
5. **Iniciar Fase 1** do desenvolvimento com Banos

---

> **Nota:** Este documento é a base de contextualização. A documentação técnica de schema do banco de dados já foi criada em `docs/schema_database.md` (19 tabelas, schema `fv`).
