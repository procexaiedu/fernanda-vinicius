/**
 * Camada de impressão sem dependência nativa.
 *
 * Em vez de usar @thiagoelg/node-printer (binding C++ que quebra no Node 22),
 * delegamos para PowerShell + PInvoke direto no winspool.drv — exatamente o
 * código validado no Apêndice C do IMPRESSAO_ETIQUETAS.md, que sai idêntico
 * ao Hiper na Argox física.
 *
 * Trade-off: cada chamada faz fork de um powershell.exe (~200-400ms overhead).
 * Aceitável porque etiquetas são impressas em lotes pequenos e o tempo total
 * domina é o transporte USB pra impressora, não o fork do PS.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

export interface PrinterInfo {
  name: string
  isDefault: boolean
  status: string[]
}

/* ------------------------------------------------------------------ */
/* Listar impressoras instaladas                                        */
/* ------------------------------------------------------------------ */

interface RawPrinterEntry {
  Name: string
  PrinterStatus?: number
  IsDefault?: boolean
}

const PS_LIST_PRINTERS = `
$ErrorActionPreference = 'Stop'
$default = (Get-CimInstance -ClassName Win32_Printer -Filter "Default = True").Name
$printers = Get-CimInstance -ClassName Win32_Printer | Select-Object @{
  Name='Name';   Expression={$_.Name}
}, @{
  Name='PrinterStatus'; Expression={$_.PrinterStatus}
}, @{
  Name='IsDefault'; Expression={$_.Name -eq $default}
}
$printers | ConvertTo-Json -Compress -Depth 3
`

export async function listPrinters(): Promise<PrinterInfo[]> {
  const stdout = await runPowerShell(PS_LIST_PRINTERS)
  if (!stdout.trim()) return []
  let parsed: RawPrinterEntry[] | RawPrinterEntry
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new Error(`Falha ao parsear lista de impressoras: ${(err as Error).message}`)
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed]
  return arr.map(p => ({
    name: p.Name,
    isDefault: p.IsDefault === true,
    status: p.PrinterStatus !== undefined ? [statusLabel(p.PrinterStatus)] : [],
  }))
}

function statusLabel(code: number): string {
  // Win32_Printer.PrinterStatus codes
  switch (code) {
    case 1: return 'Other'
    case 2: return 'Unknown'
    case 3: return 'Idle'
    case 4: return 'Printing'
    case 5: return 'Warmup'
    case 6: return 'Stopped Printing'
    case 7: return 'Offline'
    default: return `Status ${code}`
  }
}

/* ------------------------------------------------------------------ */
/* Enviar bytes RAW para a impressora                                   */
/* ------------------------------------------------------------------ */

/**
 * Script PowerShell que faz PInvoke direto em winspool.drv. Lê os bytes
 * de um arquivo temporário e envia em modo RAW. Idêntico ao Apêndice C
 * do IMPRESSAO_ETIQUETAS.md.
 */
function buildPrintScript(printerName: string, bytesFilePath: string, docName: string): string {
  const psPrinter = psQuoteSingle(printerName)
  const psFile = psQuoteSingle(bytesFilePath)
  const psDoc = psQuoteSingle(docName)
  return `
$ErrorActionPreference = 'Stop'
$bytes = [System.IO.File]::ReadAllBytes(${psFile})

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FvRawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
    [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h, byte[] data, int len, out int w);
}
"@

$hPrinter = [IntPtr]::Zero
if (-not [FvRawPrint]::OpenPrinter(${psPrinter}, [ref]$hPrinter, [IntPtr]::Zero)) {
    throw "OpenPrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
    $di = New-Object FvRawPrint+DOCINFO
    $di.pDocName    = ${psDoc}
    $di.pOutputFile = $null
    $di.pDataType   = "RAW"
    if (-not [FvRawPrint]::StartDocPrinter($hPrinter, 1, $di)) {
        throw "StartDocPrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    try {
        [void][FvRawPrint]::StartPagePrinter($hPrinter)
        $written = 0
        if (-not [FvRawPrint]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)) {
            throw "WritePrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }
        [void][FvRawPrint]::EndPagePrinter($hPrinter)
        Write-Output "OK $written"
    } finally {
        [void][FvRawPrint]::EndDocPrinter($hPrinter)
    }
} finally {
    [void][FvRawPrint]::ClosePrinter($hPrinter)
}
`
}

/**
 * Envia bytes brutos. Retorna número de bytes escritos (jobId real só viria
 * via spooler — usamos o byte count como proxy).
 */
export async function printRaw(printerName: string, data: Buffer, docName = 'Etiquetas'): Promise<number> {
  const tmpFile = join(tmpdir(), `fv-print-${randomBytes(8).toString('hex')}.bin`)
  await fs.writeFile(tmpFile, data)
  try {
    const stdout = await runPowerShell(buildPrintScript(printerName, tmpFile, docName))
    const match = stdout.match(/OK\s+(\d+)/)
    if (!match) {
      throw new Error(`PowerShell não retornou OK. stdout: ${stdout.slice(0, 200)}`)
    }
    return parseInt(match[1], 10)
  } finally {
    fs.unlink(tmpFile).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function psQuoteSingle(s: string): string {
  // PowerShell single-quoted: escape internal ' as ''
  return `'${s.replace(/'/g, "''")}'`
}

interface PsResult {
  stdout: string
  stderr: string
  code: number
}

async function runPowerShell(script: string): Promise<string> {
  const res = await runProcess('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
  ])
  if (res.code !== 0) {
    throw new Error(`PowerShell exit ${res.code}: ${res.stderr || res.stdout}`)
  }
  return res.stdout
}

function runProcess(cmd: string, args: string[]): Promise<PsResult> {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', chunk => { stdout += chunk.toString() })
    proc.stderr.on('data', chunk => { stderr += chunk.toString() })
    proc.on('close', code => resolve({ stdout, stderr, code: code ?? -1 }))
    proc.on('error', err => resolve({ stdout, stderr: stderr + err.message, code: -1 }))
  })
}
