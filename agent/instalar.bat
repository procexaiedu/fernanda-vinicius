@echo off
setlocal

REM ============================================================
REM  Instalador do fv-print-agent (agente de impressao FV)
REM  - Copia o .exe para %LOCALAPPDATA%\fv-print-agent
REM  - Cria atalho de inicializacao (roda oculto no boot)
REM  - Inicia o agente agora
REM ============================================================

set "DESTDIR=%LOCALAPPDATA%\fv-print-agent"
set "EXE=fv-print-agent.exe"
set "VBS=iniciar-oculto.vbs"

echo.
echo  Instalando o agente de impressao FV...
echo.

if not exist "%~dp0%EXE%" (
  echo  [ERRO] Nao encontrei "%EXE%" nesta pasta.
  echo  Coloque o instalar.bat na mesma pasta do %EXE%.
  pause
  exit /b 1
)

REM --- Encerra instancia anterior (evita lock no copy ao reinstalar) ---
taskkill /IM %EXE% /F >nul 2>&1
taskkill /IM tray_windows_release.exe /F >nul 2>&1

if not exist "%DESTDIR%" mkdir "%DESTDIR%"

echo  Copiando arquivos para:
echo    %DESTDIR%
copy /Y "%~dp0%EXE%" "%DESTDIR%\%EXE%" >nul

REM --- Cria o lancador oculto (VBS roda o exe sem janela de console) ---
> "%DESTDIR%\%VBS%" echo Set s = CreateObject("WScript.Shell")
>> "%DESTDIR%\%VBS%" echo s.Run """%DESTDIR%\%EXE%""", 0, False

REM --- Cria atalho na pasta de Inicializacao do Windows ---
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\FV Etiquetas.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut('%LNK%'); $lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '\"%DESTDIR%\%VBS%\"'; $lnk.WorkingDirectory = '%DESTDIR%'; $lnk.Description = 'Agente de impressao de etiquetas FV'; $lnk.Save()"

echo  Atalho de inicializacao criado.
echo.

REM --- Inicia agora (oculto) ---
start "" wscript.exe "%DESTDIR%\%VBS%"

echo  ============================================================
echo   Instalado com sucesso!
echo   O agente ja esta rodando (icone na bandeja, perto do relogio).
echo   Ele vai subir sozinho toda vez que o Windows ligar.
echo  ============================================================
echo.
pause
