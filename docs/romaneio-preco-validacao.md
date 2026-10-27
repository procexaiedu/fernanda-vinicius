# Correção de preço no romaneio

Escopo: admin da loja de destino (ou admin global), lote do fornecedor `enviada`, compra vinculada e item ainda não conferido. Consulta de fotos/itens preserva o escopo da lista. Demais estados/tipos mostram motivo de bloqueio. Custo, quantidade, código, etiqueta, financeiro e vendas não são editados.

O preço de venda é editável; a promoção ativa e positiva continua determinando a etiqueta. A tela mostra o preço efetivo antes de salvar e impede reimpressão enquanto houver alteração não salva. A reimpressão consulta o cadastro persistido e prefere o formato do item da compra, como a reimpressão de Compras.

## Banco e concorrência

Migration `20261027_romaneio_corrigir_preco.sql`: função invoker executável somente por `service_role`, com admin ativo e loja verificados no banco; trava transferência, item e produto. A ordem transferência/produto coincide com `receber_transferencia`. Versão inclui datas e preços/promoção; sessão desatualizada é recusada. Produto com saldo, venda, outra remessa/item ou outra compra exige revisão específica. Não propaga preço para outros documentos.

Produto, snapshot de venda do item, total de venda e auditoria são gravados na mesma transação. O down remove somente a função, preservando preços corrigidos e auditoria. O up pode ser reaplicado sem apagar a auditoria. A tabela de auditoria tem RLS habilitada e nenhum acesso concedido a `anon`/`authenticated`.

## Teste reproduzível isolado

Não usar estes comandos em produção. `romaneio.fixture.sql` cria um schema **representativo**, não uma cópia completa do schema real. Containers exclusivos `fv-romaneio-w14-db` e `fv-romaneio-w14-rest`, portas locais 55415/55414, credencial fictícia `fixture-local-only`.

```powershell
docker run -d --name fv-romaneio-w14-db -e POSTGRES_PASSWORD=fixture-local-only -p 127.0.0.1:55415:5432 postgres:15-alpine
# Aguardar pg_isready antes de carregar:
Get-Content -Raw -Encoding utf8 supabase/tests/romaneio.fixture.sql | docker exec -i fv-romaneio-w14-db psql -U postgres -v ON_ERROR_STOP=1
node scripts/romaneio-db.test.mjs
```

O runner testa 2377 → 237, operadora/admin inativo/loja errada, tipos/estados, saldo/venda/vínculo compartilhado, promoção ativa/inativa/zero, versão antiga, vizinho no mesmo romaneio e rollback após erro induzido na última escrita. Duas sessões reais de `psql` disputam as travas: duas correções; recebimento primeiro; correção primeiro. Usa a função real de recebimento da migration existente, no ramo lote de fornecedor. Verifica unidade/movimento únicos e replay de recebimento bloqueado. Testa down/up com auditoria preservada. Ao terminar, restaura o caso fictício 12724/R$2377.

Para a prévia, iniciar PostgREST com `PGRST_DB_URI=postgres://postgres:fixture-local-only@host.docker.internal:55415/postgres`, `PGRST_DB_SCHEMAS=fv` e `PGRST_DB_ANON_ROLE=service_role`, vinculado somente a 127.0.0.1:55414. Esse acesso deliberadamente aberto pertence **apenas ao container de teste**.

`node scripts/romaneio-preview.mjs` copia os componentes/página/ações reais para `%TEMP%/fv-romaneio-w14`. Somente identidade, layouts externos e cliente de transporte são substituídos, apontando exclusivamente ao PostgREST local. `/fixture` escolhe o perfil fictício; `/fixture/check` chama as ações reais para verificar negações no servidor. Essas rotas não existem no sistema entregue.

Iniciar via `iniciar_servidor`: `node --max-old-space-size=768 node_modules/next/dist/bin/next dev C:/Users/felip/AppData/Local/Temp/fv-romaneio-w14 --webpack -p 5315`. Página: http://localhost:5315/estoque/transferencias.

## Checks

- `tsc --noEmit`: passou com heap 1024.
- `npm run build`: passou, Next 16.2.4/Turbopack, heap 1024 e `CIRCLE_NODE_TOTAL=1`, sem alterar config/package/lock. Compilação 39,4s e TypeScript 57s, 37 páginas geradas.
- Build final após a correção do wrapper: exit 0, compilação 24,2s, TypeScript 63s e 37 páginas, com os mesmos limites de memória/worker.
- ESLint dirigido aos oito arquivos TSX/TS/MJS alterados: exit 0, zero erros e um warning de `img` nativa para a foto dinâmica. Sem mudança na configuração de imagens ou lint.
- `git diff --check` passou. `package.json`, `package-lock.json`, `next.config.ts` e `tsconfig.json` sem diff contra o início do trabalho.
- O teste preexistente `src/lib/etiquetas/ppla.test.ts` importa `vitest`, ausente do package.json. Para validar, `vitest@3.2.4` foi instalado em pasta temporária e disponibilizado somente em node_modules. A dependência continua ausente do manifesto original.
- A instalação de Next não contém `node_modules/next/dist/docs`. Foi consultada a [documentação oficial de mutações](https://nextjs.org/docs/app/getting-started/mutating-data), incluindo autorização dentro de cada Server Action.

## Limites

Sem acesso ou alteração de dados reais; estado do romaneio real 12724 não foi determinado. O harness não valida login real, políticas/triggers do schema completo nem layouts externos/cookies da produção. Impressão física exige conferência na impressora da loja; teste de integração usa mock somente do agente, preservando geração real do PPLA. Não houve push, deploy ou publicação de novidade.

## Evidências visuais e integração

MCP browser/Playwright navegou a página real do harness em `http://localhost:5315/estoque/transferencias`, com cookies/localStorage limpos em 1440 e 390. O modal não apresentou overflow horizontal (1440: clientWidth/scrollWidth 758/758; 390: 388/388). Não existe banner de cookies no harness; o layout de produção não foi testado.

- Salvamento real no banco local: 2377 → 237; reabertura mantém 237; reimpressão usa B da compra (produto tem A), uma etiqueta. Dois jobs PPLA capturados no mock do agente, em desktop e celular: `R$ 237,00`, barcode `12724`, comando `Q0001`, sem `2.377,00`.
- Operadora consulta itens sem código/custo; interface sem editor. Ações reais negam salvar e reimprimir. Admin de outra loja recebe bloqueio na leitura e gravação, inclusive por chamada direta.
- UI de romaneio recebido bloqueia correção e ação direta também é negada. Os demais estados/tipos são cobertos pela suíte SQL.
- Promoção ativa 199: salvar base 250 mantém promoção ativa/199, snapshot e etiqueta 199. Consulta e reimpressão foram verificadas no servidor após salvar.
- Imagem local autorizada do próprio repo (`public/brand/logo-fv.png`) associada somente à segunda peça fictícia: `naturalWidth=128`. É logotipo usado como imagem de teste, não foto real do colar. Dois itens no celular, rolagem até o último botão, fechamento do modal de itens e do romaneio passaram.
- Testes de UI/impressão/promo/foto com listeners próprios por cenário: zero erros no console e zero respostas 4xx/5xx. Agente de impressão é mock. Foram observados warnings de desenvolvimento do Next.
- O fluxo online revelou HTML inválido preexistente no seletor de impressora (div dentro de p). Corrigido somente o wrapper e preservado o estilo no componente compartilhado `EtiquetasPrinter`.
- Smoke final da prévia restaurada: admin sem cookies/localStorage, lote enviada/preço 237. Botão vizinho `Imprimir romaneio` chamou `window.print` exatamente uma vez (substituído por contador, sem abrir impressão física).

Capturas, todas na máquina local:

```text
C:\Users\felip\AppData\Local\Temp\fv-romaneio-antes-1440.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-depois-1440.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-depois-390.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-depois-impressao-1440.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-depois-impressao-390.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-operadora-390.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-promocao-390.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-foto-multiplos-390.png
C:\Users\felip\AppData\Local\Temp\fv-romaneio-recebida-bloqueada-390.png
```

Antes/depois também capturados com `capturar_tela`, mesmo recorte. O MCP devcontext desapareceu do catálogo na etapa final, impedindo `create_release_tour` e `stop_time`. Payload completo em `docs/romaneio-tour.rascunho.json`, pronto para o Orquestrador criar como rascunho; nenhum link de tour foi simulado.
