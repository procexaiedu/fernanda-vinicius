# Histórico de Rosi/Fernanda, Campinas

Pedido do dono em 26/10/2026, task 515e83ed. Scripts preparados, **não aplicados
em produção**. Não executar por aplicação, API ou conta de operadora.

## Escopo e guardas

Loja `7d992017-5eda-4f26-8855-2663bbef843b`:

| Conta antiga | Pessoa nova | Vendas | Total |
| --- | --- | ---: | ---: |
| `456a2633-a6bd-4c85-aadd-ee379696bc18` | `3d27830e-5cc3-45b5-b877-40397d222257` | 105 | 52.526,62 |
| `f5a59aab-8409-4a52-a6f4-e5dff887f7b5` | `43b48878-a1e4-46a7-9011-350afe0ee6ad` | 26 | 14.044,00 |

Todas completed. A terceira venda ProceX, 164, fica intacta. Base Campinas:
132 vendas, 66.734,62. Qualquer divergência nesses agregados aborta, sem
expandir o escopo. Metas individuais ou comissões surgidas também abortam.

UP mantém todos os triggers. Grava JSON integral anterior e posterior em
`fv_historico.campinas_20261026000001`, protegido por RLS e revogação de
schema/tabela para PUBLIC, anon e authenticated. service_role recebe só
USAGE no schema e SELECT/INSERT na tabela. Não incluir esse schema nos
schemas expostos pelo PostgREST; o script não modifica a configuração da API.
Mesmo uma exposição acidental não concede acesso aos papéis do cliente.
O snapshot retido contém dados privados: não exportar ao Git/logs públicos.

Altera somente seller_id/seller_person_id. Compara todas as demais colunas
com o snapshot; qualquer efeito de trigger inesperado aborta. Não altera
autoria, datas (inclusive antigas à meia-noite UTC), valores, status, itens,
estoque, pagamentos, transações ou metas. Não regenera comissão.

## Sequência do responsável, somente após revisão

1. Confirmar banco/ambiente e ownership: executor deve poder criar schema e
   ser dono de fv.sales (ou superusuário) para o DOWN. A receita informa que
   postgres não é superusuário; não presumir privilégios pelo nome da conta.
2. Fazer backup completo protegido de fv, conforme receita do projeto.
   O snapshot adicional só nasce junto da aplicação transacional.
3. Revalidar agregados e ausência de comissões/metas. Ensaio abaixo é sintético,
   não clone integral de produção. Mudanças desde diagnóstico exigem revisão.
4. Aplicar pelo dono em janela breve, sem app escrevendo. Comandos executados
   dentro do ambiente/banco já conferido, sem credenciais no arquivo:

```sh
psql -X -1 -v ON_ERROR_STOP=1 -f 20261026000001_historico_vendedoras_campinas.sql
```

5. Conferir NOTICE de 131/66.570,62, 105/26 por pessoa, legado vazio nessas
   linhas, autoria e campos iguais ao snapshot. Não disparar fechamento.
   Seguir receita para cache do PostgREST se necessário; NOTIFY já incluído.
6. Reversão, somente após revisão, com executor privilegiado:

```sh
psql -X -1 -v ON_ERROR_STOP=1 -f 20261026000001_historico_vendedoras_campinas.down.sql
```

DOWN recusa venda editada depois, snapshot incompleto ou estado misto.
Suspende **somente sales_check_seller**, sob lock e na transação, porque o
trigger atual proíbe pessoa voltar a conta. Reabilita antes de concluir;
erro reverte dados e estado do trigger. FKs, CHECKs e outros triggers ficam
ativos. Não usar execução parcial/autocommit. Snapshot permanece para auditoria.
Se houver edição posterior, parar e preparar reversão específica, sem forçar.

## Ensaio local reproduzível

Container exclusivamente descartável, sem portas ou credenciais de produção:

```sh
docker run --name fv-w10-historico-test --label maestro.task=w10-mvpu56cb -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:15-alpine
python scripts/historico-campinas.test.py
```

A suíte apaga apenas os schemas do container de nome fixo acima. Usa bootstrap
representativo e migrations reais de RPC/cadastro. Fixtures fictícias mantêm
os IDs de mapeamento, mas não copiam vendas ou dados pessoais reais.
Compara estado integral de sales, sale_items, sale_payments, products,
transactions e seller_goals após reversão, inclusive venda 164 e loja vizinha.
Testa reaplicação, down repetido, up/down/up, guardas, permissões, edição
posterior e falha intermediária no down com trigger habilitado após rollback.
