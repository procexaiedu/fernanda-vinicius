# fv-print-agent

Agente local de impressão para o sistema **Fernanda Vinícius**. Recebe o stream PPLA via HTTP em `localhost:17777` e despacha à impressora térmica Argox (ou qualquer outra) em modo RAW através do spooler do Windows.

Necessário porque browsers não conseguem chamar `winspool.drv` direto — ver `IMPRESSAO_ETIQUETAS.md` na raiz do repo.

## Endpoints

| Verbo | Rota | Resposta |
|---|---|---|
| GET | `/health` | `{ ok, version, agent, platform }` |
| GET | `/printers` | `{ ok, printers: [{ name, isDefault, status }] }` |
| POST | `/print` | body `{ printer, jobBase64, docName? }` → `{ ok, jobId, bytes }` |

CORS habilitado para `localhost:3000` + domínio de produção (`FV_AGENT_ORIGINS` sobrescreve).
Token opcional via `Authorization: Bearer <token>` (configurado em `FV_AGENT_TOKEN`).

## Desenvolvimento

```bash
cd agent
npm install
npm run dev
```

## Build single-file `.exe`

```bash
npm run build:exe
```

Gera `dist/fv-print-agent.exe` (~52 MB, Node 18 embutido + helper do tray no snapshot).

Pipeline: `tsc` compila `src/` → `dist/`, depois `pkg` empacota `dist/index.js` com o binário do tray (`node_modules/systray2/traybin/`) embutido como asset. Em runtime o systray2 extrai o helper pra `%TEMP%\fv-print-agent-tray` e roda de lá.

## Distribuição / Instalação na loja

Entregar 1 pasta com 3 arquivos:
- `fv-print-agent.exe`
- `instalar.bat`
- `desinstalar.bat`

O operador roda **`instalar.bat`** (duplo-clique). Ele:
1. Copia o `.exe` para `%LOCALAPPDATA%\fv-print-agent`
2. Cria um lançador oculto (`iniciar-oculto.vbs`) e um atalho na pasta Inicializar do Windows (sobe sozinho no boot, sem janela de console)
3. Inicia o agente na hora

O ícone **"FV Etiquetas"** aparece na bandeja (perto do relógio). Botão direito:
- Status / impressoras detectadas (informativo)
- Abrir configurações (abre `fevinicius.procexai.tech/configuracoes/impressao`)
- Reiniciar agente
- Sair (encerra de vez; volta no próximo boot)

Para remover: **`desinstalar.bat`**.

## Variáveis de ambiente

| Var | Default | Descrição |
|---|---|---|
| `FV_AGENT_PORT` | `17777` | Porta HTTP |
| `FV_AGENT_HOST` | `127.0.0.1` | Bind address (mude para `0.0.0.0` se quiser exposição na LAN) |
| `FV_AGENT_ORIGINS` | `http://localhost:3000,https://fernandavinicius.vercel.app` | Whitelist CORS separada por vírgula |
| `FV_AGENT_TOKEN` | (vazio) | Se setado, exige `Authorization: Bearer <token>` |
| `FV_AGENT_LOG_LEVEL` | `info` | Pino log level |

## Instalação na máquina da loja

1. Baixar o `fv-print-agent.exe` da releases do GitHub
2. Criar atalho em `shell:startup` para autostart
3. Primeira execução: liberar no Windows Defender se solicitar
4. Verificar no sistema web em `/configuracoes/impressao` → "Agente conectado ✓"

## Stack

- Node 18+ (embutido no `.exe` via `pkg`)
- Fastify 5 (HTTP)
- **Zero dependência nativa** — chama PowerShell + PInvoke (`winspool.drv` em modo RAW). Mesmo código validado no Apêndice C do `IMPRESSAO_ETIQUETAS.md`
- Build: `@vercel/ncc` (bundle) + `pkg` (single-file exe)

## Requisitos da máquina

- Windows 10+ com PowerShell 5.1 ou 7
- Driver Argox (ou qualquer outro) instalado normalmente — o agente conversa via spooler do Windows, não com a USB diretamente
