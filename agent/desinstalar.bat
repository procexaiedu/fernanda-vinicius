@echo off
setlocal

REM ============================================================
REM  Desinstalador do fv-print-agent
REM  - Encerra o agente, remove atalho de boot e arquivos
REM ============================================================

set "DESTDIR=%LOCALAPPDATA%\fv-print-agent"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\FV Etiquetas.lnk"

echo.
echo  Encerrando o agente...
taskkill /IM fv-print-agent.exe /F >nul 2>&1
taskkill /IM tray_windows_release.exe /F >nul 2>&1

echo  Removendo atalho de inicializacao...
if exist "%LNK%" del /F /Q "%LNK%"

echo  Removendo arquivos...
if exist "%DESTDIR%" rmdir /S /Q "%DESTDIR%"

echo.
echo  Desinstalado.
echo.
pause
