# Auditoria de Dados + Plano de Estabilização

> **Data da auditoria:** 10/08/2026
> **Executada por:** Felipe Pretoni (assumindo a manutenção do projeto a pedido do Boris)
> **Método:** somente leitura (`GET` no PostgREST do schema `fv`, service_role). Nenhum dado alterado.
> **Status deste documento:** ideias registradas, **nada aprovado, nada implementado**.

---

## 1. Por que este documento existe

O Boris passou a responsabilidade do projeto adiante, com o escopo de **controlar se o estoque está sendo abastecido e abatido corretamente** e cuidar de todos os setores. A primeira pergunta a responder era: *os dados estão corretos hoje?*

Este documento registra o que a auditoria encontrou, a **classificação de causa** de cada achado (software vs. uso), e o plano proposto para estabilizar. Serve como base de decisão antes de qualquer implementação.

---

## 2. Panorama do banco (10/08/2026)

| Métrica | Valor |
|---|---|
| Lojas | Brasília, Campinas |
| Usuários | 7 (2 admin, 5 operator — 3 inativos) |
| Produtos | 933 |
| Estoque | 2.142 un. registradas → **1.144 peças reais** (ver §4.5) |
| Valor de estoque | R$ 87.915,57 a custo · R$ 253.102,98 a venda |
| Vendas | 26 · R$ 14.663,90 · janela 01/07 → 23/07/2026 |
| Compras | 10 · R$ 92.796,30 · janela 22/06 → 05/08/2026 |
| Transações | 217 (190 de compra, 27 de venda) |
| Clientes | 760 |

**Infra:** app em `fevinicius.procexai.tech` (serviço swarm `fevinicius_web`, VPS 145.223.94.118, swarm de nó único). Banco em **Supabase Cloud**, projeto `zinrqzsxvpqfoogohrwg` — fora da infra Procex.

---

## 3. O que está comprovadamente correto

Registrado explicitamente porque responde direto ao escopo recebido:

- **Baixa de estoque por venda: 100% correta.** Dos 928 produtos rastreáveis (com item de compra), `comprado − vendido = quantity_in_stock` em **todos os 928**. Zero divergência, zero estoque negativo.
- **Integridade das 26 vendas: impecável.** `subtotal` = soma dos itens · `total` = subtotal − descontos · `sale_payments` = total · `total_cost` = custo dos itens · `subtotal` de cada item = qtd × preço · nenhum item cruzando loja.
- **Toda venda ativa gerou receita** em `transactions`.
- **Nenhum `barcode_number` duplicado** — o leitor de código de barras nunca trará a peça errada.
- Nenhuma peça com preço de venda abaixo do custo.

---

## 4. Achados

### 4.1 🔴 CRÍTICO — O PDV parou de ser usado (18 dias)

- Última venda registrada: **23/07/2026**. Auditoria em 10/08.
- As 26 vendas foram **todas digitadas entre 22/07 22:01 e 23/07 00:19** (2 horas), com `sale_date` retroativo de 01/07 a 23/07. Foi **carga histórica**, não operação diária.
- As **compras continuam sendo lançadas** normalmente (última: 05/08, R$ 9.911,50).

**Causa: adoção — motivo desconhecido.** Não há como controlar baixa de venda se a venda não é registrada. Precede qualquer correção técnica.

### 4.2 🔴 CRÍTICO — R$ 25.316,33 de compra sem valor no financeiro

Três compras com `purchase_payments` de `amount = 0`, `installment_number = null`, `status = completed`:

| Compra | Total real | Lançado | Parcelas zeradas |
|---|---|---|---|
| 01/07 | R$ 9.476,12 | R$ 1.338,91 | 10 de 13 |
| 20/07 | R$ 7.270,40 | R$ 0,00 | 13 de 13 |
| 05/08 | R$ 9.911,50 | R$ 0,00 | 12 de 12 |

O ledger espelha as parcelas → despesa lançada **R$ 67.479,97** contra **R$ 92.796,30** real.

**Impacto:** o financeiro mostra −R$ 52.816,11 quando o real é **−R$ 78.132,44**. A dona vê um resultado **R$ 25,3 mil melhor que a realidade**. As parcelas zeradas estão `completed` — o sistema considera essas compras pagas.

> O prejuízo em si é esperado nesta fase (compra de estoque em junho/agosto, venda diluída nos meses). O problema não é o sinal, é o erro de R$ 25 mil.

**Causa: software.** Nenhuma funcionária digita 13 linhas com valor zero e status pago. O código gerou e o sistema aceitou salvar. Investigar `src/app/(sistema)/compras/actions.ts` e `NovaCompraForm.tsx`.

### 4.3 🟠 ALTO — `last_sale_date` nunca é gravado

77 produtos distintos vendidos, **zero com `last_sale_date`**. Quebra a view `v_stale_products` e o alerta "produtos sem venda há X dias" (`settings.stale_product_days = 30`) previsto na Fase 7 — o catálogo inteiro aparece como parado, tornando o alerta inútil.

**Causa: software.** Não passa por ação de usuário.

### 4.4 🟠 ALTO — Arredondamento na divisão de parcelas

- Compras com resto sobrando: **+R$ 2,00** (23/06), **+R$ 0,80** (27/07), **−R$ 0,02** (22/06).
- Vendas: receita lançada R$ 14.663,86 vs. faturamento R$ 14.663,90 — parcelas gravando R$ 197,99 em vez de R$ 198,00, R$ 2.714,98 em vez de R$ 2.715,00.

O resto da divisão não é jogado na última parcela. Pequeno hoje, mas acumula e impede a conferência de caixa de fechar exata.

**Causa: software.**

### 4.5 🟡 MÉDIO — Produto "CONSERTO" gambiarrado infla o estoque

`FCL01001 CONSERTO`: `is_service = false`, `quantity_in_stock = 998`, custo R$ 0,01. Gambiarra anterior ao campo `is_service`.

**Impacto:** estoque aparece como 2.142 un. quando o real é **1.144 peças**.

Além disso, **dois** registros "Conserto" duplicados com `is_service = true` — o seed de `20260723_add_is_service_and_seed_conserto.sql` rodou duas vezes.

**Causa: software criou a necessidade** (faltava `is_service`); hoje já existe, sobrou o dado. Seed duplicado = migration não idempotente.

### 4.6 🟡 MÉDIO — Brasília não existe no sistema

1 produto, 0 em estoque, 0 vendas. As 933 peças e as 26 vendas são **todas de Campinas**. A dor original registrada em `contextualizacao_fernandavinicius.md` — "sem visibilidade em tempo real, especialmente Brasília" — permanece intacta.

**Causa: processo / rollout incompleto.**

### 4.7 ⚪ INFO — Módulos entregues e nunca usados

`stock_transfers` 0 · `exchanges` 0 · `cash_closings` 0 · `consignments` 0 · `seller_goals` 0.

O mais grave é `cash_closings`: o fechamento de caixa é o controle diário que provaria que a venda do dia bate com o dinheiro. Construído no commit mais recente (`bc102c0`, "caixa por turno") e nunca usado.

**Causa: adoção.**

### 4.8 Outros achados menores

- 2 produtos vendidos sem vínculo de compra (`FEF0644 ANEL LETRA`, `FRA06108 COLAR LETRA`) — origem não rastreável.
- 931 de 931 produtos **sem foto**: o serviço `fevinicius_web` sobe **sem as variáveis `MINIO_*`**, e o código salva o produto sem foto quando ausentes. Nenhuma foto está sendo gravada em produção e ninguém recebe erro.
- 59 produtos zerados e 3 usuários inativos — normal, sem ação.

### 4.9 Falso positivo descartado

O script acusou **172 códigos duplicados**. **Não é problema:** `code` = F + iniciais do fornecedor + mês + custo, e `schema_database.md:543` registra explicitamente *"code não é UNIQUE — peças idênticas em lojas diferentes compartilham o mesmo código"*. Colisão é por design — é justamente por isso que existe o `barcode_number` sequencial e único.

---

## 5. Classificação de causa — a conclusão que importa

| Achado | Software | Uso/Adoção |
|---|:--:|:--:|
| R$ 25.316,33 de parcelas zeradas | ✅ | |
| `last_sale_date` nunca gravado | ✅ | |
| Arredondamento de parcelas | ✅ | |
| Fotos não gravadas (sem MinIO) | ✅ | |
| CONSERTO com 998 un. + seed duplicado | ✅ | |
| PDV parado há 18 dias | | ✅ |
| Brasília sem dados | | ✅ |
| `cash_closings` nunca usado | | ✅ |

**Nenhum dos achados que envolvem dinheiro é erro de uso.** Treinar a equipe sem corrigir o código mantém o furo de R$ 25 mil acontecendo — agora com a equipe confiante de que está fazendo certo, o que é pior.

**E sobre os 18 dias:** a causa é desconhecida. Se for "não sabem usar", orientação resolve. Se for "é lento com cliente na frente", "não dá tempo" ou "voltamos pro caderno", orientação não resolve nada. **Conversar com a Rosi antes de escrever qualquer material** — ela registrou a maior parte das vendas.

---

## 6. Plano de estabilização proposto

Ordem por eficácia, não por esforço.

### 6.1 Travas no software (tornar o erro impossível)

Mais forte que instrução, porque não depende de ninguém lembrar.

- Bloquear salvamento de compra cujas parcelas não somem o `total_cost`
- Rejeitar parcela com `amount = 0`
- Jogar o resto da divisão sempre na última parcela (compras e vendas)
- Gravar `last_sale_date` ao concluir a venda
- Tornar o seed de serviços idempotente
- Provisionar `MINIO_*` no serviço de produção (bucket `fv-products`, usuário próprio do FV — **não reusar credencial de outro cliente**)

### 6.2 Monitor diário automático de integridade

É literalmente o escopo recebido: em vez de auditar na mão, um cron roda as checagens desta auditoria e avisa quando divergir. Checagens propostas:

- venda sem baixa de estoque / estoque negativo
- venda sem `transactions`, ou com receita ≠ total
- compra com parcelas ≠ total, ou parcela zerada
- dia útil sem nenhuma venda registrada ← **teria pegado os 18 dias no 2º dia**
- caixa do turno não fechado
- pendência financeira vencida

Notificação por WhatsApp (Evolution já existe na infra). Só somente-leitura; nunca corrige sozinho.

### 6.3 Guia de operação curto, por papel

Não um manual de 40 páginas. **Uma página por rotina**, com os fluxos reais já documentados em `contextualizacao_fernandavinicius.md`:

- abrir o dia
- registrar venda (incl. bipar a etiqueta)
- fechar o caixa do turno
- conferir a mala que chegou de SP

### 6.4 Inventário físico com leitor de código de barras

Único jeito de provar que o estoque digital bate com a gaveta. Depende do leitor (§8).

### 6.5 Ledger de movimentação de estoque

**Lacuna estrutural.** O financeiro tem ledger de verdade (`transactions`); o estoque **não** — é um inteiro mutável `products.quantity_in_stock`, sem tabela de movimentação.

Consequência: `comprado − vendido = estoque` bate 100% **porque produto e item de compra nascem no mesmo ato**. Um ajuste manual, uma peça furtada ou uma baixa fora do PDV **não deixa rastro nenhum**.

> **Limite desta auditoria:** posso afirmar que o número interno é aritmeticamente coerente. **Não posso afirmar que o estoque físico bate.**

---

## 7. Riscos de guarda de dados (não verificados)

Pendências levantadas mas **ainda não checadas** — pesam mais que treinamento para "dados estáveis e bem guardados":

- **Backup do banco não verificado.** Supabase Cloud, projeto `zinrqzsxvpqfoogohrwg`. Dependendo do plano pode haver só snapshot diário, sem point-in-time recovery. Se alguém apagar uma compra hoje, **não se sabe se dá para recuperar**. Requer acesso ao dashboard ou confirmação do Boris.
- **Não existe ambiente de staging.** O `.env.local` aponta para produção; qualquer teste local mexe no dado real da loja. As migrations estão versionadas em `supabase/migrations/`, então clonar o schema é viável.
- **Swarm de nó único, réplica única.** VPS cai = as duas lojas param juntas, sem failover.
- **Build no boot do container.** O deploy faz `git clone` + `npm install` + `npm run build` a cada start, dentro de limite de 3 GB de RAM. Restart custa minutos com a loja aberta e depende do GitHub e do npm estarem no ar. `RestartPolicy: any` sem limite → falha de build vira loop silencioso.
- **PAT do GitHub em texto claro** no `command` do serviço, compartilhado com `wgr6-web` e o stack `procex`. Rotacionar quebra os três.

---

## 8. Hardware — leitor de código de barras

O Boris vai comprar o leitor. **Modelo definido: Elgin EL250** (1D/2D, USB, com suporte) — **2 unidades**, uma por loja. Faixa de R$ 450–520/un.; existe [kit de 2 un. com frete grátis no ML](https://www.mercadolivre.com.br/kit-leitor-elgin-el250-usb-com-suporte-2d-02-und/p/MLB51198063).

### 8.1 Os três requisitos que decidem a escolha

Não é marca nem preço — é o que o sistema já espera em produção:

| Requisito | Origem no código |
|---|---|
| **USB HID (teclado), sufixo Enter** | `NovaVendaForm.tsx:541-596` — captura `keydown` global, fecha no Enter, rejeita acima de 80ms/caractere |
| **Code 128** | `ppla.ts:80,100` — tipo B no layout A, tipo C no layout B |
| **Imager 2D** (não linear/laser) | Etiqueta B = 30×18mm enrolada na joia, quase sempre curva |

O `barcode_number` é numérico puro (`products_barcode_seq`, `schema_database.md:159`), o que elimina problema de layout ABNT2 — boa decisão de schema, manter.

### 8.2 Por que o EL250

Imager 2D omnidirecional · **suporte hands-free incluso de fábrica** (habilita modo apresentação — essencial para conferir mala de SP peça por peça sem gatilho) · USB HID por padrão · garantia de **5 anos** · resiste a queda de 2 m · lê Code128, QR, Data Matrix, PDF417, boleto, DANFE e chave de NFe.

### 8.3 Modelos avaliados e descartados

| Modelo | Preço | Por que não |
|---|---|---|
| **Zebra DS2208** (USB, c/ suporte) | R$ 526–780 | Tecnicamente ótimo e era a 1ª indicação; perdeu no critério **custo-benefício**. Alternativa premium válida se o Boris preferir Zebra. |
| Zebra DS2278 (Bluetooth) | ~R$ 1.478 | 2,3× o preço; ganho só aparece em contagem longe do balcão. Reavaliar depois do 1º inventário. |
| **Elgin Flash II** `46FLASH2CBU0` | R$ 120–200 | **1D linear imager** — precisa alinhar a linha com o código; falha na etiqueta B curva. Não lê QR. Anúncio sem suporte. **Rejeitado.** |
| Elgin EL8600 | R$ 1.199,90 | Formato fixo de balcão, caro |
| Honeywell Voyager 1450g | sob consulta | **Descontinuado** (evoluiu para 1470g) |
| Zebra LS2208 | mais barato | 1D laser — mesmo problema do Flash II |
| Qualquer RS232 / SDK / coletor batch | — | Exigiria reescrever a captura |

### 8.4 Cuidados na compra em marketplace

Descrições de ML/Amazon são inconfiáveis (vi "bateria 100 horas" num DS2208 que é com fio, e "127V" num leitor alimentado por USB). Conferir sempre: **(1)** que é **USB**, não RS232 — a página de catálogo do DS2208 no ML descreve a família toda como "USB/RS-232/RS-485/KW"; **(2)** que o **suporte** aparece nas fotos; **(3)** preço dentro da faixa — o mesmo DS2208 aparece de R$ 526 a R$ 2.499; **(4)** **nota fiscal**, sem a qual não se aciona a garantia de 5 anos.

### 8.5 Integração: zero código para vender

O leitor em HID **é um teclado**. A captura já existe e as três telas de venda (`/pdv`, `/vendas/nova`, `/vendas/[id]/editar`) renderizam o mesmo `NovaVendaForm`. Comportamento atual: escuta o teclado na página inteira (não precisa focar campo) · distingue leitor de humano pela cadência · busca `barcode_number` **entre os produtos da loja selecionada**, com fallback em `code` · aplica preço promocional se ativo · preenche a linha vazia ou adiciona nova · dá feedback verde/vermelho por 2,5 s.

**Se não funcionar de primeira, são duas causas:**
1. **Sufixo Enter ausente** — a captura só fecha no Enter. Corrige bipando um código de configuração do manual da Elgin (vem na caixa).
2. **Inter-character delay configurado alto** — acima de 80ms/caractere a leitura é descartada silenciosamente. O padrão é sem delay.

⚠️ O EL250 também suporta **Virtual COM**. Nesse modo a captura **para de funcionar**. Manter em HID.

**Teste de aceite no 1º dia:** imprimir a etiqueta de uma peça → abrir `/pdv` → bipar **sem clicar em campo nenhum** → a peça entra com o preço certo e aparece *"NOME adicionado"* em verde. Se aparecer *"Código não encontrado"*, o leitor está OK e o problema é outro (ex.: produto de outra loja — a busca filtra pela loja selecionada).

### 8.6 Dois defeitos a corrigir na captura atual

Nenhum impede o uso; fazer junto quando o leitor chegar, para validar tudo de uma vez:

1. **Os dígitos vazam para o campo em foco** — a captura não chama `preventDefault`. Bipar com o cursor no campo de cliente adiciona a peça **e** deixa o código digitado lá. O Enter também pode disparar submit.
2. **Bipar a mesma peça 2× cria duas linhas** de quantidade 1 em vez de somar para 2.

### 8.7 O que o leitor ainda não faz (precisa de código)

Nenhuma dessas telas tem captura hoje. A lógica já existe e testada — extrair num hook `useBarcodeScanner` torna cada tela pequena. A exceção é o inventário, que precisa de tela nova, relatório de divergência e onde guardar as contagens (encosta na lacuna do §6.5).

| Onde | O que passaria a fazer |
|---|---|
| Conferência de compra (`NovaCompraForm`) | Bipar cada peça que chega de SP contra os `purchase_items` — pega a divergência antes de guardar |
| Inventário / contagem | Bipar a gaveta e comparar com `quantity_in_stock` — única prova de que o físico bate |
| Busca em Produtos/Estoque | Bipar a peça e abrir a ficha (preço na hora, para o cliente) |
| Transferência entre lojas | Bipar na saída e na chegada |
| Troca / devolução | Bipar a peça que volta ao estoque |

---

## 9. Correções de documentação pendentes

- `contextualizacao_fernandavinicius.md:320` registra `fv.procexai.tech` como domínio "Confirmado" — **não responde**. O que está no ar é `fevinicius.procexai.tech`.
- `agent/README.md:62` lista `fernandavinicius.vercel.app` na whitelist de CORS — retorna 404, resíduo de deploy antigo na Vercel.
- `schema_database.md:430` diz UNIQUE(store_id, closing_date), "um fechamento por loja por dia" — a migration `20260723_cash_closings_por_turno.sql` mudou para turno (`period_start`).

---

## 10. Perguntas abertas

1. **Por que pararam de registrar venda em 23/07?** (bloqueia o item 6.3 — sem a resposta, o guia pode ser inútil)
2. Existe backup / PITR no Supabase? Qual o plano contratado?
3. As 3 compras com parcelas zeradas: os pagamentos foram feitos de fato? Precisa reconstituir os valores com a Fernanda.
4. Brasília vai entrar no sistema? Quando?
5. Quem valida a correção de dados históricos — Boris ou a Fernanda?

---

## 11. Reprodutibilidade

O script de auditoria é somente-leitura e reexecutável. Puxa as 19 tabelas via PostgREST (`Accept-Profile: fv`) e reconcilia localmente em Node. Se o item 6.2 for aprovado, ele é a base do monitor diário.

**Nada neste documento foi implementado.** Aguardando priorização.
