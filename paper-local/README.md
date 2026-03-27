# paper-local

## RU

Локальный шаблон Paper для `mc-bot-colony`.

### Команды
```powershell
npm run setup:paper
npm run start:paper
```

Или напрямую:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File paper-local\setup-paper.ps1
cmd /c paper-local\start.bat
```

### Что делает setup
- создаёт `paper-local/runtime/`
- создаёт `runtime/server.properties` из `server.properties.example`
- создаёт `runtime/eula.txt` из `eula.txt.example`
- скачивает или обновляет `paper.jar` в `runtime/paper.jar`, если файла нет или версия не совпадает

### Переменные
- `PAPER_VERSION` (default: `1.21.11`)
- `PAPER_BUILD` (optional)
- `PAPER_FORCE_DOWNLOAD` (`1/true/yes` принудительно обновляет jar)
- `PAPER_MIN_RAM`, `PAPER_MAX_RAM`
- `PAPER_JAVA_EXE`

Для Paper `1.21.11` нужна Java `21+`.

## EN

Local Paper template for `mc-bot-colony`.

### Windows cmd.exe prerequisite (Java 21)
Install Java 21:
```cmd
winget install --id EclipseAdoptium.Temurin.21.JDK -e
```

Reopen `cmd.exe`, then:
```cmd
for /d %D in ("C:\Program Files\Eclipse Adoptium\jdk-21*") do set "JDKDIR=%D"
set "PAPER_JAVA_EXE=%JDKDIR%\bin\java.exe"
```

### Commands
```powershell
npm run setup:paper
npm run start:paper
```

Or directly:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File paper-local\setup-paper.ps1
cmd /c paper-local\start.bat
```

### What setup does
- creates `paper-local/runtime/`
- creates `runtime/server.properties` from `server.properties.example`
- creates `runtime/eula.txt` from `eula.txt.example`
- downloads or refreshes `paper.jar` to `runtime/paper.jar` if missing or mismatched

### Environment variables
- `PAPER_VERSION` (default: `1.21.11`)
- `PAPER_BUILD` (optional)
- `PAPER_FORCE_DOWNLOAD` (`1/true/yes` forces jar refresh)
- `PAPER_MIN_RAM`, `PAPER_MAX_RAM`
- `PAPER_JAVA_EXE`

Paper `1.21.11` requires Java `21+`.
