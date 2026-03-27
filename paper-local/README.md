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
- скачивает `paper.jar` в `runtime/paper.jar`, если файла нет

### Переменные
- `PAPER_VERSION` (default: `1.21.11`)
- `PAPER_BUILD` (optional)
- `PAPER_MIN_RAM`, `PAPER_MAX_RAM`
- `PAPER_JAVA_EXE`

## EN

Local Paper template for `mc-bot-colony`.

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
- downloads `paper.jar` to `runtime/paper.jar` if missing

### Environment variables
- `PAPER_VERSION` (default: `1.21.11`)
- `PAPER_BUILD` (optional)
- `PAPER_MIN_RAM`, `PAPER_MAX_RAM`
- `PAPER_JAVA_EXE`
