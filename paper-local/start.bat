@echo off
setlocal
set "BASE_DIR=%~dp0"
set "RUNTIME_DIR=%BASE_DIR%runtime"
set "PAPER_JAR=%RUNTIME_DIR%\paper.jar"

if not defined PAPER_MIN_RAM set "PAPER_MIN_RAM=2G"
if not defined PAPER_MAX_RAM set "PAPER_MAX_RAM=4G"

if defined PAPER_JAVA_EXE (
  set "JAVA_EXE=%PAPER_JAVA_EXE%"
) else (
  set "JAVA_EXE=java"
)

if not exist "%PAPER_JAR%" (
  echo paper.jar not found: "%PAPER_JAR%"
  echo Place Paper 1.21.11 jar into paper-local\runtime\paper.jar
  pause
  exit /b 1
)

if not exist "%RUNTIME_DIR%\server.properties" (
  copy /Y "%BASE_DIR%server.properties.example" "%RUNTIME_DIR%\server.properties" >nul
)
if not exist "%RUNTIME_DIR%\eula.txt" (
  copy /Y "%BASE_DIR%eula.txt.example" "%RUNTIME_DIR%\eula.txt" >nul
)

cd /d "%RUNTIME_DIR%"
"%JAVA_EXE%" ^
  -Xms%PAPER_MIN_RAM% ^
  -Xmx%PAPER_MAX_RAM% ^
  -XX:+UseG1GC ^
  -XX:+ParallelRefProcEnabled ^
  -XX:MaxGCPauseMillis=200 ^
  -jar paper.jar --nogui

endlocal
