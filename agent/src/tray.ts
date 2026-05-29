/**
 * Ícone na bandeja do Windows (system tray) via biblioteca `trayicon`.
 *
 * trayicon usa um helper .NET (rsrcs/trayicon.exe) que renderiza .ico de verdade
 * no Windows (o systray2 crashava com qualquer .ico). .NET Framework 4.x já vem
 * embutido em todo Windows 10, então não há dependência extra a instalar.
 *
 * Sob pkg: `useTempDir` copia o trayicon.exe do snapshot pra uma pasta temporária
 * real e roda de lá. O binário é embutido via "assets" no package.json.
 *
 * O ícone (ICON_B64) vem de ./icon, gerado a partir de icone.ico — NÃO embutir
 * base64 à mão aqui (uma cópia truncada gera ICO malformado e crasha o helper).
 *
 * Tray é OPCIONAL: se algo falhar, o agente continua rodando como processo de
 * fundo, só sem o ícone.
 */

import { spawn } from 'node:child_process'
import { config } from './config'
import { listPrinters } from './printer'
import { ICON_B64 } from './icon'

interface TrayCallbacks {
  onRestart: () => void
  onExit: () => void
}

interface TrayApi {
  setMenu: (...items: unknown[]) => void
  setIcon: (buf: Buffer) => void
  setTitle: (t: string) => void
  item: (label: string, opts?: Record<string, unknown>) => unknown
  separator: () => unknown
  kill: () => void
}

let trayInstance: { kill: () => void } | null = null

export async function setupTray(cb: TrayCallbacks): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Tray = require('trayicon') as {
      create: (opts: Record<string, unknown>) => Promise<TrayApi>
    }

    const tray = await Tray.create({
      icon: Buffer.from(ICON_B64, 'base64'),
      title: 'FV Etiquetas',
      // Necessário sob pkg: copia o trayicon.exe do snapshot pra uma pasta real.
      useTempDir: 'clean',
    })

    function renderMenu(printerLabel: string) {
      tray.setMenu(
        tray.item(`Rodando na porta ${config.port}`, { disabled: true }),
        tray.item(printerLabel, { disabled: true }),
        tray.separator(),
        tray.item('Abrir configuracoes', {
          action: () => openInBrowser(`${config.systemUrl}/configuracoes/impressao`),
        }),
        tray.item('Reiniciar agente', { action: () => cb.onRestart() }),
        tray.separator(),
        tray.item('Sair', {
          action: () => {
            try { tray.kill() } catch { /* ignore */ }
            cb.onExit()
          },
        }),
      )
    }

    renderMenu('Verificando impressoras...')
    trayInstance = tray

    // Atualiza a contagem de impressoras em background.
    listPrinters()
      .then(ps => renderMenu(ps.length ? `Impressoras detectadas: ${ps.length}` : 'Nenhuma impressora detectada'))
      .catch(() => renderMenu('Nenhuma impressora detectada'))
  } catch (err) {
    console.warn('[tray] nao foi possivel iniciar o icone da bandeja:', (err as Error).message)
  }
}

export function destroyTray(): void {
  try {
    trayInstance?.kill()
  } catch {
    /* ignore */
  }
}

function openInBrowser(url: string): void {
  // Windows: 'start' via cmd. O primeiro arg "" é o título da janela (start exige).
  spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref()
}
