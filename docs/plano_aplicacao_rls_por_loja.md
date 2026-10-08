# Plano de aplicação: RLS por loja + recorrentes por loja (08/10/2026)

Nada disto foi aplicado em produção. Quem aplica é o Felipe, com a loja fechada.

## O que entra

| Arquivo | O que faz | Depende do app? |
|---|---|---|
| `supabase/migrations/20261008_rls_por_loja.sql` | Políticas do schema `fv` cortadas por loja. Helpers `fv.loja_do_usuario()`, `fv.e_admin_global()`, `fv.pode_ver_loja(uuid)` e os de loja derivada. | Não. O app lê e grava com service_role. |
| `supabase/migrations/20261008_recorrentes_por_loja.sql` | `fv.gerar_recorrentes_da_loja(loja, incluir_rede)`. | **Sim**: o app novo chama essa função. Aplicar ANTES do push. |
| `src/app/(sistema)/financeiro/actions.ts` | "Gerar agora" das recorrentes gera só a loja da sessão (+ rede para o admin global). | |
| `src/app/(sistema)/vendas/page.tsx`, `VendasClient.tsx` | Lista de Vendas avisa quando o período passa das N vendas carregadas e oferece "Carregar mais" (200 → 400 → … → 6.400). | |

## Quem vê o quê depois da migration (pela API, com a sessão do usuário)

| Perfil | Vê |
|---|---|
| Admin global (Fernanda, Felipe) | as duas lojas e o que é da rede (`store_id` NULL). A loja escolhida no login continua sendo filtrada pela tela. |
| Admin de loja (Eleandra) | só a loja dela, inclusive em tabelas sem `store_id` (itens de venda, de troca, de compra, de romaneio, bipes, movimentos, metas). Compra mista aparece (só a fatia não: a linha da compra inteira), mas só o global altera. Lê as duas lojas em `stores` e o cadastro das admins globais (nome do remetente do romaneio). |
| Operadora | o mesmo de antes, menos clientes da outra loja (antes lia CPF e endereço das duas). |
| Usuária inativa | nada (antes, uma inativa caía na política de operadora de clientes e lia as duas lojas). |

Fornecedores seguem da rede (qualquer admin). `consertos`, `consignment_acertos` e `materials` seguem sem política (fechadas para o navegador).

## Ordem

1. **Antes de tudo, salvar o estado real das políticas** (o rollback foi gerado do banco de teste, que espelha produção pós-20261007; se produção divergir, vale o snapshot):
   ```sql
   select tablename, policyname, cmd, roles, qual, with_check
     from pg_policies where schemaname = 'fv' order by 1, 2;
   ```
   Guardar a saída. Conferir que são 50 políticas e que batem com as `CREATE POLICY` de `supabase/rollback/20261008_rls_por_loja_rollback.sql`. Se não baterem, PARE e ajuste o rollback antes.
2. Loja fechada (fora do horário). Ninguém com tela aberta.
3. Aplicar `20261008_rls_por_loja.sql` (Studio ou psql, porta 5433). Ela tem `begin/commit` e uma trava no fim: se alguma política de admin ficar sem corte de loja, ou se a regra de custo fora da API (20261006) quebrar, dá erro e nada é gravado. Termina com `notify pgrst, 'reload schema'`.
4. Aplicar `20261008_recorrentes_por_loja.sql`.
5. Se o PostgREST não pegar a função nova (erro `PGRST202` no botão "Gerar agora"), mandar **SIGUSR1** no container do PostgREST (memória `fevinicius_postgrest_reload`). Mudança só de política não precisa: RLS é avaliado a cada consulta.
6. Push na `main` (o webhook publica sozinho, 3 a 5 min fora do ar). Ver `recipes/deploy-fernanda-vinicius` no vault.

## Como conferir

1. Admin global: abrir /vendas, /estoque, /produtos, /financeiro, /compras, ficha de uma peça com romaneio. Tudo igual a antes.
2. Eleandra (admin de Brasília): as mesmas telas. Estoque/Produtos (que leem `products` com a sessão dela) só com peças de Brasília; ficha da peça com o histórico de romaneio e o remetente.
3. Pela API: no banco, simulando o JWT da Eleandra (dentro de BEGIN ... ROLLBACK):
   ```sql
   begin;
   select set_config('request.jwt.claims', json_build_object('sub', '<uuid da Eleandra>', 'role', 'authenticated')::text, true);
   set local role authenticated;
   select store_id, count(*) from fv.sales group by 1;   -- só Brasília
   select origin_store_id, count(*) from fv.customers group by 1;
   rollback;
   ```
4. PDV: uma venda de teste de R$ 0,01 e excluir (ou observar a primeira venda do dia seguinte). Transferência, conferência e compra rodam pelo servidor (service_role) e não são afetadas, mas vale abrir cada tela uma vez.
5. Financeiro como Eleandra: "Gerar agora" nas recorrentes cria só contas de Brasília.
6. Vendas como admin global: período "Todo o período" mostra o aviso "Mostrando as 200 vendas mais recentes" com "Carregar mais".

## Voltar atrás

- RLS: aplicar `supabase/rollback/20261008_rls_por_loja_rollback.sql` (devolve as 50 políticas de 07/10 e remove os helpers; confere a contagem no fim). Não depende do app.
- Recorrentes: primeiro voltar o app ao commit anterior, depois `supabase/rollback/20261008_recorrentes_por_loja_rollback.sql`. Ao contrário, o botão "Gerar agora" quebra.

## Riscos

- **Tela que lê com a sessão e espera ver a outra loja.** Mapeadas em 08/10: Estoque e Produtos (`products`), ficha da peça (`transfer_items` + embeds de `transfers`, `stores`, `users`), detalhe de funcionária (`sales`, `exchanges`, `cash_closings`, `transfers` dela), detalhe de loja em Configurações (só o global abre), perfil (`users` + `stores`). Todas continuam funcionando; para a admin de loja, o remetente de romaneio enviado por operadora da OUTRA loja aparece como "—".
- **Desempenho**: as políticas usam `(select fv.is_admin())` (avaliado 1 vez por consulta) e funções de loja por linha nas tabelas derivadas. Estoque/Produtos (~1.500 peças) é a leitura mais pesada pelo navegador; `pode_ver_loja` é por linha mas barato (2 leituras por PK em users, em cache). Conferir o tempo de /estoque como Eleandra.
- O teste rodou no schema de `fvtest-db` (dump de 07/10). Se produção tiver política que o teste não tem, o passo 1 pega.

## Testes (local)

`supabase/tests/rls_local/README.md` explica como montar o Postgres local (container `fv-rls-teste`) e rodar tudo:

- `20261008_rls_por_loja.test.sql`: 3 perfis + admin de loja espelho + inativa; SELECT/INSERT/UPDATE/DELETE na outra loja falham, na própria passam, compra mista, romaneio, conferência, RPCs só para service_role.
- `20261008_recorrentes_por_loja.test.sql`.
- Suítes anteriores com a migration aplicada: venda, compra, duas pontas, custo fora da API e duas remessas passam. `20261001_transferencia_conferencia_test.sql` falha ANTES de chegar no RLS: chama `fv.enviar_transferencia` com a assinatura antiga de 7 argumentos (hoje são 9). É defeito do teste, de antes desta mudança.
