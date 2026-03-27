@echo off
setlocal
set "BASE_DIR=%~dp0"
set "RUNTIME_DIR=%BASE_DIR%runtime"
set "PAPER_JAR=%RUNTIME_DIR%\paper.jar"
set "BOOTSTRAP_SCRIPT=%BASE_DIR%setup-paper.ps1"

if not defined PAPER_MIN_RAM set "PAPER_MIN_RAM=2G"
if not defined PAPER_MAX_RAM set "PAPER_MAX_RAM=4G"
if not defined PAPER_VERSION set "PAPER_VERSION=1.21.11"

if defined PAPER_JAVA_EXE (
  set "JAVA_EXE=%PAPER_JAVA_EXE%"
) else (
  set "JAVA_EXE=java"
)

if not exist "%BOOTSTRAP_SCRIPT%" (
  echo [paper-start] Bootstrap script not found: "%BOOTSTRAP_SCRIPT%"
  echo [paper-start] Expected file paper-local\setup-paper.ps1
  pause
  exit /b 1
)

echo [paper-start] Ensuring Paper runtime...
powershell -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP_SCRIPT%" -PaperVersion "%PAPER_VERSION%" -PaperBuild "%PAPER_BUILD%"
if errorlevel 1 (
  echo [paper-start] Bootstrap failed. Fix the message above and retry.
  pause
  exit /b 1
)

if not exist "%PAPER_JAR%" (
  echo [paper-start] paper.jar still missing after bootstrap: "%PAPER_JAR%"
  pause
  exit /b 1
)

if defined PAPER_JAVA_EXE (
  if not exist "%PAPER_JAVA_EXE%" (
    echo [paper-start] PAPER_JAVA_EXE points to missing file: "%PAPER_JAVA_EXE%"
    echo [paper-start] Set PAPER_JAVA_EXE to a valid java.exe path or unset it.
    pause
    exit /b 1
  )
) else (
  where java >nul 2>nul
  if errorlevel 1 (
    echo [paper-start] Java not found in PATH.
    echo [paper-start] Install Java 21 or set PAPER_JAVA_EXE to java.exe full path.
    pause
    exit /b 1
  )
)

cd /d "%RUNTIME_DIR%"
echo [paper-start] Launching Paper (version %PAPER_VERSION%, min=%PAPER_MIN_RAM%, max=%PAPER_MAX_RAM%)
"%JAVA_EXE%" ^
  -Xms%PAPER_MIN_RAM% ^
  -Xmx%PAPER_MAX_RAM% ^
  -XX:+UseG1GC ^
  -XX:+ParallelRefProcEnabled ^
  -XX:MaxGCPauseMillis=200 ^
  -jar paper.jar --nogui

endlocal
