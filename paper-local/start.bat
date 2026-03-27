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
set "FORCE_SWITCH="
if /I "%PAPER_FORCE_DOWNLOAD%"=="1" set "FORCE_SWITCH=-ForceDownload"
if /I "%PAPER_FORCE_DOWNLOAD%"=="true" set "FORCE_SWITCH=-ForceDownload"
if /I "%PAPER_FORCE_DOWNLOAD%"=="yes" set "FORCE_SWITCH=-ForceDownload"
powershell -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP_SCRIPT%" -PaperVersion "%PAPER_VERSION%" -PaperBuild "%PAPER_BUILD%" %FORCE_SWITCH%
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

set "JAVA_MAJOR_NUM="
for /f %%v in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$j = $env:PAPER_JAVA_EXE; if ([string]::IsNullOrWhiteSpace($j)) { $j = 'java' }; try { $line = (& $j -version 2^>^&1 ^| Select-Object -First 1); if ($line -match '\"([0-9]+)') { $matches[1] } elseif ($line -match 'version\s+([0-9]+)') { $matches[1] } } catch { }"') do (
  set "JAVA_MAJOR_NUM=%%v"
)

if not defined JAVA_MAJOR_NUM (
  echo [paper-start] Warning: could not parse Java major version automatically.
  echo [paper-start] Continuing startup. If Paper fails, install Java 21+ and set PAPER_JAVA_EXE.
)

if defined JAVA_MAJOR_NUM (
  set /a JAVA_MAJOR_NUM=%JAVA_MAJOR_NUM% >nul 2>nul
  if errorlevel 1 (
    echo [paper-start] Warning: parsed Java major is not numeric: "%JAVA_MAJOR_NUM%".
    set "JAVA_MAJOR_NUM="
  )
)

if defined JAVA_MAJOR_NUM (
  if %JAVA_MAJOR_NUM% LSS 21 (
    echo [paper-start] Java %JAVA_MAJOR_NUM% detected, but Paper 1.21.11 requires Java 21+.
    echo [paper-start] Install Java 21 and set PAPER_JAVA_EXE, for example:
    echo [paper-start] set PAPER_JAVA_EXE=C:\Path\To\java.exe
    pause
    exit /b 1
  )
)

cd /d "%RUNTIME_DIR%"
if defined JAVA_MAJOR_NUM (
  echo [paper-start] Launching Paper (version %PAPER_VERSION%, java=%JAVA_MAJOR_NUM%, min=%PAPER_MIN_RAM%, max=%PAPER_MAX_RAM%)
) else (
  echo [paper-start] Launching Paper (version %PAPER_VERSION%, java=unknown, min=%PAPER_MIN_RAM%, max=%PAPER_MAX_RAM%)
)
"%JAVA_EXE%" ^
  -Xms%PAPER_MIN_RAM% ^
  -Xmx%PAPER_MAX_RAM% ^
  -XX:+UseG1GC ^
  -XX:+ParallelRefProcEnabled ^
  -XX:MaxGCPauseMillis=200 ^
  -jar paper.jar --nogui

endlocal
