# Cadastro independente de vendedoras

Configurações > Vendedoras permite cadastrar nome, loja e situação sem criar
conta no Auth. Menu e rota são administrativos. Actions conferem perfil ativo,
papel e loja da sessão antes de usar service_role. Admin de loja não alcança
outra loja. Operadora consulta somente pessoas ativas da própria loja no PDV.

`sales.seller_id` mantém o vínculo antigo com users. `seller_person_id` referencia
o novo cadastro. Não há conversão automática de contas nem atribuição de vendas
antigas. A chave de apresentação `pessoa:UUID` separa pessoas e contas legadas
nos filtros, ranking, metas e comissões. `user_id` continua representando autoria.
Editar conserva a atribuição original, inclusive legado/inativa. A loja de um
cadastro não pode mudar; inativar não exclui referências.

Metas da loja mantêm a mesma base de cálculo. Metas individuais antigas continuam
vinculadas à conta legada; a coluna aditiva também permite metas por pessoa.
Comissões novas usam transactions.seller_person_id, sem colocar UUID de pessoa
em users. Comissões pagas não são recalculadas/removidas. Índice único protege
nova comissão por pessoa/loja/data de fechamento contra duplicação.

## Verificação reproduzível

`node scripts/vendedoras.test.cjs` executa fonte real com adaptadores controlados
de Auth/DB: bloqueios, escopo, edição, ranking e geração de comissões.

A suíte SQL usa PostgreSQL real em container **descartável**, com base mínima
representativa, não um clone do schema completo de produção:

1. Subir postgres:15-alpine dedicado, por exemplo `fv-sellers-w6-db`.
2. Em banco vazio, executar `supabase/tests/sellers_local/bootstrap.sql`.
3. Executar `supabase/migrations/20261001_venda_transacional.sql` (RPCs reais).
4. Executar `supabase/migrations/20261026_cadastro_vendedoras.sql`.
5. Executar `supabase/tests/20261026_cadastro_vendedoras.test.sql` com
   `psql -v ON_ERROR_STOP=1`. A suíte grava apenas pessoas e vendas fictícias.
6. Em outro banco vazio, repetir 2 a 4 e executar `.down.sql`; conferir que
   legacy e comissão paga permanecem. Com referências novas, down deve recusar.

`node scripts/preview-vendedoras.cjs` prepara a prévia em
`%TEMP%/fv-sellers-w6`, sem .env, Auth ou conexão ao Supabase. Subir essa pasta
por iniciar_servidor, `npm run dev -- --port 5317`. `/pdv` e
`/configuracoes/vendedoras` usam componentes reais, com persistência fictícia no
localStorage da prévia. Isso prova interface, não autorização/persistência real.

## Aplicação posterior, pelo responsável pelo deploy

Não aplicar diretamente em produção nesta etapa. Conferir receita de deploy,
salvar snapshot/backup, ensaiar sobre cópia do schema completo e confirmar FKs,
policies, assinatura das RPCs e cache PostgREST. Aplicar a migration nova antes
do app. A primeira fase aceita chamadas legadas para manter compatibilidade.
O patch SQL aborta se os trechos esperados das RPCs divergirem, preservando
a transação inteira.

Sequência compatível:

1. Aplicar somente a migration aditiva. Chamadas antigas com seller_id válido
   continuam funcionando; chamadas novas com seller_person_id validam pessoa,
   loja e atividade. Não há fallback para login na nova action.
2. Recarregar o schema do PostgREST e disponibilizar o cadastro para admins.
   A administração informa as pessoas reais por loja. Não semear nomes.
3. Publicar o app e conferir admin/operadora. O cadastro nasce vazio e a nova
   versão bloqueia novas vendas até existir uma pessoa ativa da loja. Para
   evitar esse intervalo, disponibilizar primeiro o cadastro administrativo
   numa implantação intermediária mantendo o PDV antigo, cadastrar as pessoas
   e só depois ativar o PDV novo; essa implantação intermediária não está
   automatizada neste diff e precisa ser coordenada pelo responsável.
4. Quando todas as instâncias antigas tiverem saído e os cadastros estiverem
   prontos, pode-se aplicar o enforcement estrito opcional em
   `supabase/propostas/cadastro_vendedoras_enforcement_APOS_CADASTRO.sql`.
   Ele recusa novas atribuições legadas também no banco, preservando edições
   do histórico. Não aplicar essa fase junto da primeira migration.

Rollback: voltar app e executar `.down.sql` somente se não houver referências
novas. Havendo vendas, metas ou comissões por pessoa, a reversão recusa perda de
identidade e exige plano específico. Não converter pessoas em contas.
