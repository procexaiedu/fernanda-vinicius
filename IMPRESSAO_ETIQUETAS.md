# Impressão de Etiquetas — Sistema FERNANDA VINICIUS

Documento completo da feature de impressão de etiquetas para implementação no sistema novo, baseado em engenharia reversa do Hiper Loja existente. Tudo aqui foi **testado e validado em impressora física Argox** com saída idêntica à do Hiper.

## TL;DR para implementar rápido

1. Linguagem do printer: **PPLA nativo da Argox** (não EPL2, apesar do driver Windows se chamar "PPLB").
2. O sistema antigo (Hiper) **não traduz nada**: envia bytes PPLA brutos direto pra impressora.
3. Modo de impressão obrigatório: **RAW via Win32 spooler** (`OpenPrinter`/`StartDocPrinter` com `pDataType="RAW"`/`WritePrinter`). Diálogo gráfico do Windows não funciona.
4. Encoding: **Windows-1252** (pt-BR com acentos).
5. Existem dois layouts ativos: **A (90×13mm, 1 etiq/linha)** para anéis/pulseiras/colares, e **B (30×18mm, 3 etiq/linha)** para brincos/bolsas.
6. Para múltiplas linhas, repetir o "format" inteiro N vezes (cada format imprime 1 linha do papel).
7. Cuidado com 1 byte específico do prefixo do barcode — detalhado abaixo na seção [Armadilhas](#armadilhas-importantes).

## Contexto

A loja imprime etiquetas hoje pelo **Hiper Loja 7.2.2.189** desktop, usando uma impressora **Argox OS-214 plus** (ou A-200) em USB. O fluxo atual:

1. Importa produtos via CSV no Hiper Web.
2. Sincroniza no Hiper Desktop.
3. Vai em "Emissão de etiquetas de produtos" → seleciona produtos + quantidades → escolhe um dos dois layouts → imprime.

Os dois layouts atuais não são padrão do Hiper — foram criados sob medida (provavelmente por importação) e ficam armazenados no banco SQL Server local. Nomes oficiais:

- **`90x13 Etiqueta FERNANDA VINICIUS`** (IdLayoutEtiqueta=10001)
- **`ETIQUETA 30X18X3 FERNANDA VINICIUS`** (IdLayoutEtiqueta=10002)

A meta é replicar exatamente esse comportamento no sistema novo, sem depender do Hiper.

## Como descobrimos o formato

O suporte do Hiper disse "os templates estão no banco" — confirma que estão na instância SQL Server local `LAPTOP-N6IUFG6I\HIPER`, banco `Labeltec`, tabela `dbo.CodigoFonteLayoutEtiqueta` (campo `CodigoFonte`, com `IdLinguagemImpressao=2`).

Mas o que está no banco é um **formato compacto sem documentação pública** (ex: `1911A0800350110<NOME[1]>`). Decodificar isso à mão dava muita margem de erro.

A solução foi capturar o stream real que o Hiper envia à impressora:

1. Criei uma impressora-clone no Windows usando o mesmo driver da Argox, mas com **porta = arquivo** em vez de USB.
2. Pedi pra impressora ser selecionada no diálogo de impressão do Hiper.
3. Li os bytes do arquivo.

**Descoberta crucial**: o Hiper **não traduz** o formato compacto pra outra coisa. Ele substitui as variáveis (`<NOME[1]>` → texto real) e manda os bytes diretamente pra impressora. Ou seja, o que está no banco já é PPLA — só estranho-no-formato.

A impressora Argox aceita PPLA nativamente (mesmo o driver Windows se chamando "PPLB", o que é o nome comercial pra emulação EPL2 da Argox — mas o driver é só um pass-through em modo RAW).

## Estrutura do stream PPLA

Cada "format" (= 1 unidade de impressão = 1 linha física de etiquetas no rolo) tem essa estrutura. Bytes literais são importantes:

```
n<LF>
<STX>M0500<LF>
<STX>O0220<LF>
<STX>V0<LF>
<STX>f220<LF>
<SOH>D<LF>
<STX>L<LF>
D11<LF>
A2<LF>
... (linhas de campo: texto/barcode)
<LF>
Q0001<LF>
E<LF>
```

Onde:
- `<STX>` = byte 0x02
- `<SOH>` = byte 0x01
- `<LF>` = byte 0x0A (line feed, **não CRLF**)

Significado de cada linha:

| Linha | Função |
|-------|--------|
| `n` | Cancela modo gráfico, volta pra modo texto |
| `<STX>M0500` | Comprimento máx da etiqueta = 500 |
| `<STX>O0220` | Configuração de opções/sensores |
| `<STX>V0` | Velocidade de impressão (0 = mais lenta/precisa) |
| `<STX>f220` | Backfeed após impressão |
| `<SOH>D` | Reset do printer (immediate) |
| `<STX>L` | Entra em modo de definição de label |
| `D11` | Densidade de impressão (dentro do modo L) |
| `A2` | Modo A2 — impressão assíncrona |
| `(campos)` | Definições de texto e barcode, uma por linha |
| `<LF>` | Linha em branco — encerra a seção de campos |
| `Q0001` | Quantidade de cópias deste format = 1 |
| `E` | End format + ejetar/imprimir |

**Para imprimir N linhas de etiquetas, repita o format inteiro N vezes.** Não use `Q000N` — isso imprime a mesma linha N vezes (cópias idênticas), não N linhas diferentes.

## Formato de campo: TEXTO

```
1911A YYYY HH XXXX <texto>
```

Onde (ler como string contígua, sem espaços):
- `1` = rotação (1 = 0°)
- `9` = font ID
- `1` = multiplicador horizontal
- `1` = multiplicador vertical
- `A` = tipo (A = texto normal)
- `YYYY` = parte 1 da posição (4 dígitos)
- `HH` = parte 2 da posição (2 dígitos — varia conforme a linha do texto na etiqueta)
- `XXXX` = posição X dentro da linha (4 dígitos — varia por coluna no layout B)
- `<texto>` = conteúdo a imprimir, **sem aspas, sem terminador especial**, até o `<LF>`

> Não tentamos decodificar 100% as unidades de `YYYY` e `HH` — não foi necessário. **Use as combinações exatas capturadas** (listadas adiante por layout) e troque só o `<texto>` e, no layout B, o `XXXX` da coluna.

## Formato de campo: BARCODE

```
1E420 YYYY HHH XXXX T <dados>
```

- `1E420` = prefixo fixo de barcode (5 chars)
- `YYYY` = posição Y (4 dígitos)
- `HHH` = altura/largura do barcode (3 dígitos)
- `XXXX` = posição X (4 dígitos)
- `T` = tipo do barcode (1 char): **`B`** para o layout A (código interno do produto), **`C`** para o layout B (EAN real)
- `<dados>` = valor que vira o barcode (e o HRI legível embaixo)

> A diferença `B` vs `C` é tipo de simbologia do barcode na Argox. Não inverter — A usa B, B usa C.

## Layout A — 90×13mm, 1 etiqueta por linha (anéis, pulseiras, colares)

### Campos (após o `A2`)

```
1E4202700100013B{codigo}
1911A0800350110{nome}
1911A0800230110{referencia}
1911A1000070110R$ {preco}
```

### Variáveis

| Placeholder | Fonte (campo do produto) | Observação |
|---|---|---|
| `{codigo}` | Identificador interno do produto (ex: `15519`) | Vira o barcode tipo B |
| `{nome}` | Nome do produto (ex: `P COLAR MOISSANITE`) | |
| `{referencia}` | Referência interna (ex: `FSO05429`) | |
| `{preco}` | Preço de venda formatado pt-BR (ex: `1.072,00`) | **Sem o "R$"**, ele já está no template |

### Exemplo completo (1 etiqueta, copy-paste dentro do format)

```
1E4202700100013B15519
1911A0800350110P COLAR MOISSANITE
1911A0800230110FSO05429
1911A1000070110R$ 1.072,00
```

## Layout B — 30×18mm, 3 etiquetas por linha (brincos, bolsas)

Cada **linha física do rolo tem 3 etiquetas lado a lado**. Um único format imprime as 3. Para 9 produtos, repete o format 3 vezes (com 3 produtos diferentes em cada).

### Campos (após o `A2`)

Para cada coluna `c ∈ {0, 1, 2}`:

```
1911A060058{xText[c]}{nome_c}
1911A060043{xText[c]}{referencia_c}
1911A080027{xText[c]}R$ {preco_c}
1E420090004{xBarcode[c]}C{codigo_barras_c}
```

Onde:
- `xText[c]` = `["0015", "0142", "0270"][c]`
- `xBarcode[c]` = `["0033", "0160", "0288"][c]`

### Variáveis

| Placeholder | Fonte |
|---|---|
| `{nome_c}` | Nome do produto |
| `{referencia_c}` | Referência interna |
| `{preco_c}` | Preço pt-BR (sem "R$") |
| `{codigo_barras_c}` | **Código de barras real (EAN)** — não o código interno |

### Lidando com < 3 produtos por linha

Se sobrar 1 ou 2 produtos na última linha (ex: 8 produtos = 2 linhas cheias + 1 linha com 1 só), o Hiper preenche as colunas vazias deixando-as em branco. Reproduza isso: nas colunas sem produto, **omita as 4 linhas daquela coluna**.

### Exemplo completo (1 format, 3 brincos lado a lado)

```
1911A0600580015BRINCO CITRINO
1911A0600430015FZA05599
1911A0800270015R$ 188,00
1E4200900040033C15521
1911A0600580142BRINCO STAR
1911A0600430142FZA05595
1911A0800270142R$ 168,00
1E4200900040160C15520
1911A0600580270BRINCO TORRE
1911A0600430270FSP0560
1911A0800270270R$ 422,00
1E4200900040288C15522
```

## Mapeamento de campos do banco do sistema novo

No Hiper, esses campos vêm de tabelas próprias. No sistema novo, mapeie de onde estiverem:

| Etiqueta | Origem semântica |
|---|---|
| Código (barcode layout A) | Identificador interno único do produto (PK) |
| Código de barras (barcode layout B) | EAN-13/UPC do produto (campo separado, geralmente cadastrado manualmente) |
| Nome | Nome curto do produto (lembre que cabe ~14-20 chars sem cortar feio) |
| Referência | Código de referência interna (SKU/cadastro) |
| Preço | Preço de venda atual; formate como pt-BR (`1.234,56`) **sem** o "R$" |

## Como imprimir no Windows: modo RAW

O driver Windows da Argox aceita bytes brutos via spooler quando você diz pra ele que o tipo de dado é "RAW". Isso pula renderização GDI.

### PowerShell com PInvoke (referência testada e funcional)

Está em `C:\Users\fevin\Documents\Hiper\etiquetas-extraidas\imprimir_5_aneis.ps1` (layout A) e `imprimir_9_brincos.ps1` (layout B). O essencial:

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
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

$bytes = [Text.Encoding]::GetEncoding(1252).GetBytes($jobText)
$hPrinter = [IntPtr]::Zero
[RawPrint]::OpenPrinter("Argox OS-214 plus PPLB", [ref]$hPrinter, [IntPtr]::Zero)
$di = New-Object RawPrint+DOCINFO
$di.pDataType = "RAW"
$di.pDocName  = "Etiquetas"
[RawPrint]::StartDocPrinter($hPrinter, 1, $di)
[RawPrint]::StartPagePrinter($hPrinter)
$written = 0
[RawPrint]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)
[RawPrint]::EndPagePrinter($hPrinter)
[RawPrint]::EndDocPrinter($hPrinter)
[RawPrint]::ClosePrinter($hPrinter)
```

### Node.js

Use a biblioteca [`@thiagoelg/node-printer`](https://www.npmjs.com/package/@thiagoelg/node-printer) (fork mantido do `node-printer`):

```javascript
import printer from "@thiagoelg/node-printer";

const jobBytes = Buffer.from(jobText, "win1252"); // precisa do pacote iconv-lite ou converter manualmente
printer.printDirect({
  data: jobBytes,
  printer: "Argox OS-214 plus PPLB",
  type: "RAW",
  success: (jobId) => console.log("ok", jobId),
  error:   (err)   => console.error(err),
});
```

> Atenção: o `Buffer.from(..., "win1252")` não é nativo no Node. Use `iconv-lite`:
> ```js
> import iconv from "iconv-lite";
> const jobBytes = iconv.encode(jobText, "win1252");
> ```

### .NET (C#)

```csharp
using System.Runtime.InteropServices;
using System.Text;

public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr h, byte[] data, int len, out int w);

    public static void Send(string printerName, string job) {
        var bytes = Encoding.GetEncoding(1252).GetBytes(job);
        if (!OpenPrinter(printerName, out var h, IntPtr.Zero))
            throw new Exception("OpenPrinter");
        try {
            var di = new DOCINFO { pDocName = "Etiquetas", pDataType = "RAW" };
            StartDocPrinter(h, 1, di);
            StartPagePrinter(h);
            WritePrinter(h, bytes, bytes.Length, out _);
            EndPagePrinter(h);
            EndDocPrinter(h);
        } finally {
            ClosePrinter(h);
        }
    }
}
```

### Python

```python
import win32print

def send_raw(printer_name: str, job_text: str) -> None:
    data = job_text.encode("cp1252")
    h = win32print.OpenPrinter(printer_name)
    try:
        job = win32print.StartDocPrinter(h, 1, ("Etiquetas", None, "RAW"))
        try:
            win32print.StartPagePrinter(h)
            win32print.WritePrinter(h, data)
            win32print.EndPagePrinter(h)
        finally:
            win32print.EndDocPrinter(h)
    finally:
        win32print.ClosePrinter(h)
```

## Pseudocódigo de geração do job

```
STX = "\x02"; SOH = "\x01"; LF = "\n"

func buildFormat(campos: lista de strings) -> string:
    header  = "n" + LF
    header += STX + "M0500" + LF
    header += STX + "O0220" + LF
    header += STX + "V0"    + LF
    header += STX + "f220"  + LF
    header += SOH + "D"     + LF
    header += STX + "L"     + LF
    header += "D11" + LF + "A2" + LF
    body    = join(campos, LF) + LF
    footer  = LF + "Q0001" + LF + "E" + LF
    return header + body + footer

# Layout A — 1 produto por format
func layoutA(produto) -> string:
    return buildFormat([
        "1E4202700100013B" + produto.codigo,
        "1911A0800350110"  + produto.nome,
        "1911A0800230110"  + produto.referencia,
        "1911A1000070110R$ " + format_preco(produto.preco),
    ])

# Layout B — até 3 produtos por format
xText    = ["0015", "0142", "0270"]
xBarcode = ["0033", "0160", "0288"]

func layoutB(tresProdutos) -> string:
    campos = []
    for c in 0..min(2, len(tresProdutos)-1):
        p = tresProdutos[c]
        campos.append("1911A060058" + xText[c] + p.nome)
        campos.append("1911A060043" + xText[c] + p.referencia)
        campos.append("1911A080027" + xText[c] + "R$ " + format_preco(p.preco))
        campos.append("1E420090004" + xBarcode[c] + "C" + p.codigoBarras)
    return buildFormat(campos)

# Imprimir N produtos:
func imprimirA(produtos):
    job = ""
    for p in produtos:
        job += layoutA(p)
    sendRaw("Argox OS-214 plus PPLB", job, encoding="cp1252")

func imprimirB(produtos):
    job = ""
    for chunk in chunks_of_3(produtos):
        job += layoutB(chunk)
    sendRaw("Argox OS-214 plus PPLB", job, encoding="cp1252")
```

## Armadilhas importantes

### 1. Conte os bytes do prefixo do barcode com cuidado

A linha de barcode tem **16 chars fixos antes dos dados**, no formato:
`1E42` (4) + Y (4) + altura (3) + X (4) + Tipo (1) = 16.

- Layout A: `1E42` + `0270` + `010` + `0013` + `B` → `1E4202700100013B`
- Layout B (col c): `1E42` + `0090` + `004` + `xBarcode[c]` + `C` → `1E420090004XXXXC`

Confundimos isso num teste: pus um `0` extra no prefixo do Layout B (`1E4200900040` + X em vez de `1E420090004` + X), o que deslocou TODA a string em 1 byte. O resultado: a impressora interpretou a linha como texto puro e o barcode saiu como gibberish do tipo "30 18C 05E B5...". Se isso acontecer, conte byte por byte e compare com `captura_B_30x18x3.prn` ou `captura_A_90x13.prn`.

### 2. Line endings: LF **literal**, não CRLF

Mesmo no Windows, o stream usa só `\n`. Se sua linguagem coloca CRLF por padrão (Node, .NET com `WriteLine`), force LF.

### 3. Encoding Windows-1252

Não é UTF-8. Acentos vão como single byte na CP1252. UTF-8 multi-byte pode confundir o printer ou imprimir lixo.

### 4. O sistema antigo manda STX antes do `n` em jobs subsequentes; o primeiro não tem

A primeira captura (Layout A, sessão limpa) começou com `n\n`. A segunda (Layout B, depois da A) começou com `\x02n\n`. Tanto faz pra impressora — ela aceita os dois. Pode mandar sempre sem STX (mais simples).

### 5. Não use o diálogo de impressão do Windows

O `System.Drawing.Printing` (.NET) ou equivalentes que renderizam via GDI **estragam o stream**. Tem que ser raw, via `winspool.drv` direto.

### 6. A impressora não conta etiquetas, conta formats

`Q0002` imprime o mesmo format duas vezes. Para imprimir 2 etiquetas A diferentes, mande 2 formats completos.

## Validação: como saber que está correto sem desperdiçar etiqueta

Crie uma impressora-arquivo: copie o driver da Argox para uma nova impressora com porta apontando pra um path no disco. Imprima através dela e compare os bytes com a captura do Hiper.

```powershell
$path = "C:\temp\captura.prn"
Add-PrinterPort -Name $path
Add-Printer -Name "Argox CAPTURA" -DriverName "Argox OS-214 plus PPLB" -PortName $path
```

Para imprimir pelo Hiper na CAPTURA, basta selecioná-la no diálogo de impressão durante o "Emitir etiquetas".

Depois `Get-Content $path -AsByteStream` (PS7) ou `[IO.File]::ReadAllBytes($path)` (qualquer PS) pra comparar bytes.

## Notas finais

- Hardware atual: **Argox OS-214 plus** (também tem uma A-200 instalada, ambas no mesmo USB004). O driver Windows usado nos testes foi "Argox OS-214 plus PPLB".
- Configuração de papel/sensores está embutida nos comandos `M0500/O0220/V0/f220/D11/A2` — não mexer a menos que mudem o rolo de etiqueta para outras dimensões.
- Se um dia importarem um novo modelo de etiqueta no Hiper, dá pra extrair o template novo do banco com a mesma técnica: tabela `Labeltec.dbo.CodigoFonteLayoutEtiqueta`, filtrar pelo `IdLayoutEtiqueta` correspondente em `Labeltec.dbo.LayoutEtiqueta`, e mais seguro: imprimir pela impressora-arquivo e ler os bytes resultantes.

---

# Apêndice A — Hex dump do stream capturado do Hiper (Layout A)

Esta é a captura **completa e exata** que o Hiper enviou pra Argox ao imprimir 1 produto com o layout `90x13 Etiqueta FERNANDA VINICIUS`. Produto de exemplo: `P COLAR MOISSANITE`, ref `FSO05429`, preço `R$ 1.072,00`, código `15519`. Tamanho: **155 bytes**.

## Hex bruto

```
6E 0A 02 4D 30 35 30 30 0A 02 4F 30 32 32 30 0A
02 56 30 0A 02 66 32 32 30 0A 01 44 0A 02 4C 0A
44 31 31 0A 41 32 0A 31 45 34 32 30 32 37 30 30
31 30 30 30 31 33 42 31 35 35 31 39 0A 31 39 31
31 41 30 38 30 30 33 35 30 31 31 30 50 20 43 4F
4C 41 52 20 4D 4F 49 53 53 41 4E 49 54 45 0A 31
39 31 31 41 30 38 30 30 32 33 30 31 31 30 46 53
4F 30 35 34 32 39 0A 31 39 31 31 41 31 30 30 30
30 37 30 31 31 30 52 24 20 31 2E 30 37 32 2C 30
30 0A 0A 51 30 30 30 31 0A 45 0A
```

## Decodificado linha a linha

Onde `<STX>` = 0x02, `<SOH>` = 0x01, fim de linha = 0x0A (LF):

```
n
<STX>M0500
<STX>O0220
<STX>V0
<STX>f220
<SOH>D
<STX>L
D11
A2
1E4202700100013B15519
1911A0800350110P COLAR MOISSANITE
1911A0800230110FSO05429
1911A1000070110R$ 1.072,00
                          ← linha em branco
Q0001
E
```

## Como recriar exatamente este arquivo

Para qualquer linguagem com acesso a escrita de bytes binários:

```python
hex_bytes = "6E0A024D30353030..."  # cole aqui o hex bruto sem espaços
data = bytes.fromhex(hex_bytes)
open("captura_A_90x13.prn", "wb").write(data)
```

---

# Apêndice B — Hex dump do stream capturado do Hiper (Layout B)

Captura completa de 1 linha de impressão do layout `ETIQUETA 30X18X3 FERNANDA VINICIUS` com 3 produtos: `BRINCO CITRINO` (ref FZA05599, R$ 188,00, cb 15521), `BRINCO STAR` (FZA05595, R$ 168,00, 15520), `BRINCO TORRE` (FSP0560, R$ 422,00, 15522). Tamanho: **345 bytes**.

## Hex bruto

```
02 6E 0A 02 4D 30 35 30 30 0A 02 4F 30 32 32 30
0A 02 56 30 0A 02 66 32 32 30 0A 01 44 0A 02 4C
0A 44 31 31 0A 41 32 0A 31 39 31 31 41 30 36 30
30 35 38 30 30 31 35 42 52 49 4E 43 4F 20 43 49
54 52 49 4E 4F 0A 31 39 31 31 41 30 36 30 30 34
33 30 30 31 35 46 5A 41 30 35 35 39 39 0A 31 39
31 31 41 30 38 30 30 32 37 30 30 31 35 52 24 20
31 38 38 2C 30 30 0A 31 45 34 32 30 30 39 30 30
30 34 30 30 33 33 43 31 35 35 32 31 0A 31 39 31
31 41 30 36 30 30 35 38 30 31 34 32 42 52 49 4E
43 4F 20 53 54 41 52 0A 31 39 31 31 41 30 36 30
30 34 33 30 31 34 32 46 5A 41 30 35 35 39 35 0A
31 39 31 31 41 30 38 30 30 32 37 30 31 34 32 52
24 20 31 36 38 2C 30 30 0A 31 45 34 32 30 30 39
30 30 30 34 30 31 36 30 43 31 35 35 32 30 0A 31
39 31 31 41 30 36 30 30 35 38 30 32 37 30 42 52
49 4E 43 4F 20 54 4F 52 52 45 0A 31 39 31 31 41
30 36 30 30 34 33 30 32 37 30 46 53 50 30 35 36
30 0A 31 39 31 31 41 30 38 30 30 32 37 30 32 37
30 52 24 20 34 32 32 2C 30 30 0A 31 45 34 32 30
30 39 30 30 30 34 30 32 38 38 43 31 35 35 32 32
0A 51 30 30 30 31 0A 45 0A
```

## Decodificado linha a linha

```
<STX>n
<STX>M0500
<STX>O0220
<STX>V0
<STX>f220
<SOH>D
<STX>L
D11
A2
1911A0600580015BRINCO CITRINO
1911A0600430015FZA05599
1911A0800270015R$ 188,00
1E4200900040033C15521
1911A0600580142BRINCO STAR
1911A0600430142FZA05595
1911A0800270142R$ 168,00
1E4200900040160C15520
1911A0600580270BRINCO TORRE
1911A0600430270FSP0560
1911A0800270270R$ 422,00
1E4200900040288C15522
Q0001
E
```

> Diferença observada com Layout A: aqui o stream **começa com `<STX>n`** em vez de `n`. Na prática a impressora aceita os dois; a versão sem STX (que foi a que mandamos no teste) funcionou idêntica. Não precisa replicar o STX inicial.

> Outra diferença: o Layout B **não tem linha em branco antes do `Q0001`** (o A tinha). Os scripts de referência preservam essa linha em branco em ambos os layouts e funcionou — a impressora tolera.

---

# Apêndice C — Script PowerShell completo: Layout A (`imprimir_5_aneis.ps1`)

Script funcional e testado que imprime 5 anéis usando o layout A. **Saiu idêntico ao Hiper na impressora física.**

```powershell
$ErrorActionPreference = "Stop"

$PrinterName = "Argox OS-214 plus PPLB"
$DumpPath    = "C:\Users\fevin\Documents\Hiper\etiquetas-extraidas\teste_5_aneis.prn"

$produtos = @(
    @{ nome="ANEL SOLITARIO"; ref="FSO00001"; preco="199,00"; cb="17001" }
    @{ nome="ANEL ALIANCA";   ref="FSO00002"; preco="299,90"; cb="17002" }
    @{ nome="ANEL INFINITO";  ref="FSO00003"; preco="129,90"; cb="17003" }
    @{ nome="ANEL FALANGE";   ref="FSO00004"; preco="89,90";  cb="17004" }
    @{ nome="ANEL ZIRCONIA";  ref="FSO00005"; preco="249,00"; cb="17005" }
)

$STX = [char]2
$SOH = [char]1
$LF  = "`n"

function Build-Format([hashtable]$p) {
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("n").Append($LF)
    [void]$sb.Append($STX).Append("M0500").Append($LF)
    [void]$sb.Append($STX).Append("O0220").Append($LF)
    [void]$sb.Append($STX).Append("V0").Append($LF)
    [void]$sb.Append($STX).Append("f220").Append($LF)
    [void]$sb.Append($SOH).Append("D").Append($LF)
    [void]$sb.Append($STX).Append("L").Append($LF)
    [void]$sb.Append("D11").Append($LF)
    [void]$sb.Append("A2").Append($LF)
    [void]$sb.Append("1E42027001000").Append("13B").Append($p.cb).Append($LF)
    [void]$sb.Append("1911A0800350110").Append($p.nome).Append($LF)
    [void]$sb.Append("1911A0800230110").Append($p.ref).Append($LF)
    [void]$sb.Append("1911A1000070110R$ ").Append($p.preco).Append($LF)
    [void]$sb.Append($LF)
    [void]$sb.Append("Q0001").Append($LF)
    [void]$sb.Append("E").Append($LF)
    return $sb.ToString()
}

$jobText = ""
foreach ($p in $produtos) { $jobText += Build-Format $p }

$bytes = [Text.Encoding]::GetEncoding(1252).GetBytes($jobText)
[IO.File]::WriteAllBytes($DumpPath, $bytes)
Write-Host "Job gravado em $DumpPath ($($bytes.Length) bytes)"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrintA {
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
if (-not [RawPrintA]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)) {
    throw "OpenPrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
    $di = New-Object RawPrintA+DOCINFO
    $di.pDocName    = "Teste 5 aneis"
    $di.pOutputFile = $null
    $di.pDataType   = "RAW"
    if (-not [RawPrintA]::StartDocPrinter($hPrinter, 1, $di)) {
        throw "StartDocPrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    try {
        [void][RawPrintA]::StartPagePrinter($hPrinter)
        $written = 0
        if (-not [RawPrintA]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)) {
            throw "WritePrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }
        [void][RawPrintA]::EndPagePrinter($hPrinter)
        Write-Host "Enviados $written bytes para '$PrinterName'."
    } finally {
        [void][RawPrintA]::EndDocPrinter($hPrinter)
    }
} finally {
    [void][RawPrintA]::ClosePrinter($hPrinter)
}
```

---

# Apêndice D — Script PowerShell completo: Layout B (`imprimir_9_brincos.ps1`)

Script funcional e testado que imprime 9 brincos (3 linhas × 3 colunas) usando o layout B. **Saiu idêntico ao Hiper na impressora física.**

```powershell
$ErrorActionPreference = "Stop"

$PrinterName = "Argox OS-214 plus PPLB"
$DumpPath    = "C:\Users\fevin\Documents\Hiper\etiquetas-extraidas\teste_9_brincos.prn"

$produtos = @(
    @{ nome="BRINCO PEROLA";    ref="FZA00001"; preco="89,90";  cb="15601" }
    @{ nome="BRINCO ARGOLA";    ref="FZA00002"; preco="49,90";  cb="15602" }
    @{ nome="BRINCO STRASS";    ref="FZA00003"; preco="79,90";  cb="15603" }
    @{ nome="BRINCO CRUZ";      ref="FZA00004"; preco="59,90";  cb="15604" }
    @{ nome="BRINCO LUA";       ref="FZA00005"; preco="39,90";  cb="15605" }
    @{ nome="BRINCO CORACAO";   ref="FZA00006"; preco="69,90";  cb="15606" }
    @{ nome="BRINCO ESTRELA";   ref="FZA00007"; preco="99,90";  cb="15607" }
    @{ nome="BRINCO PINGENTE";  ref="FZA00008"; preco="119,00"; cb="15608" }
    @{ nome="BRINCO PRESILHA";  ref="FZA00009"; preco="29,90";  cb="15609" }
)

$xText    = @("0015","0142","0270")
$xBarcode = @("0033","0160","0288")

$STX = [char]2
$SOH = [char]1
$LF  = "`n"

function Build-Format([object[]]$tres) {
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("n").Append($LF)
    [void]$sb.Append($STX).Append("M0500").Append($LF)
    [void]$sb.Append($STX).Append("O0220").Append($LF)
    [void]$sb.Append($STX).Append("V0").Append($LF)
    [void]$sb.Append($STX).Append("f220").Append($LF)
    [void]$sb.Append($SOH).Append("D").Append($LF)
    [void]$sb.Append($STX).Append("L").Append($LF)
    [void]$sb.Append("D11").Append($LF)
    [void]$sb.Append("A2").Append($LF)
    for ($c=0; $c -lt 3; $c++) {
        $p = $tres[$c]
        [void]$sb.Append("1911A060058").Append($xText[$c]).Append($p.nome).Append($LF)
        [void]$sb.Append("1911A060043").Append($xText[$c]).Append($p.ref).Append($LF)
        [void]$sb.Append("1911A080027").Append($xText[$c]).Append("R$ ").Append($p.preco).Append($LF)
        [void]$sb.Append("1E420090004").Append($xBarcode[$c]).Append("C").Append($p.cb).Append($LF)
    }
    [void]$sb.Append($LF)
    [void]$sb.Append("Q0001").Append($LF)
    [void]$sb.Append("E").Append($LF)
    return $sb.ToString()
}

$jobText = ""
for ($row=0; $row -lt 3; $row++) {
    $jobText += Build-Format @($produtos[$row*3], $produtos[$row*3+1], $produtos[$row*3+2])
}

$bytes = [Text.Encoding]::GetEncoding(1252).GetBytes($jobText)
[IO.File]::WriteAllBytes($DumpPath, $bytes)
Write-Host "Job gravado em $DumpPath ($($bytes.Length) bytes)"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h, byte[] data, int len, out int w);
}
"@

$hPrinter = [IntPtr]::Zero
if (-not [RawPrint]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)) {
    throw "OpenPrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
    $di = New-Object RawPrint+DOCINFO
    $di.pDocName    = "Teste 9 brincos"
    $di.pOutputFile = $null
    $di.pDataType   = "RAW"
    if (-not [RawPrint]::StartDocPrinter($hPrinter, 1, $di)) {
        throw "StartDocPrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    try {
        [void][RawPrint]::StartPagePrinter($hPrinter)
        $written = 0
        if (-not [RawPrint]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)) {
            throw "WritePrinter falhou: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }
        [void][RawPrint]::EndPagePrinter($hPrinter)
        Write-Host "Enviados $written bytes para '$PrinterName'."
    } finally {
        [void][RawPrint]::EndDocPrinter($hPrinter)
    }
} finally {
    [void][RawPrint]::ClosePrinter($hPrinter)
}
```
