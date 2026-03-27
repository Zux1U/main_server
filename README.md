# mc-bot-colony

Local Mineflayer arena runtime: `1 process = 1 bot`, with web round controls and server-side prepare/reset via RCON.

## RU

### Что в репозитории
- `src/` — контроллер + worker-боты
- `paper-local/` — локальный Paper шаблон (bootstrap + start)
- `docs/` — архитектура, прогресс, локальный setup

### Требования
- Node.js `18+` (рекомендуется `20 LTS`)
- Java `21` (если не задан `PAPER_JAVA_EXE`, должна быть в `PATH`)

### Быстрый запуск (2 терминала)
Терминал A (Paper):
```powershell
npm run setup:paper
npm run start:paper
```

Терминал B (контроллер):
```powershell
npm install
npm start
```

Открыть панель: `http://127.0.0.1:3210`  
Дальше: `Start Workers` -> `Prepare` -> `Start` (или `Launch PvP (auto)`).

### Paper bootstrap (авто)
`setup:paper` и `start:paper` автоматически:
- создают `paper-local/runtime/server.properties` из шаблона
- создают `paper-local/runtime/eula.txt` из шаблона
- скачивают или обновляют `paper.jar` в `paper-local/runtime/paper.jar`, если его нет или версия/билд не совпадает

Поддерживаемые env:
- `PAPER_VERSION` (default: `1.21.11`)
- `PAPER_BUILD` (optional; если пусто, берется latest)
- `PAPER_FORCE_DOWNLOAD` (`1/true/yes` принудительно перекачивает jar)
- `PAPER_MIN_RAM`, `PAPER_MAX_RAM`
- `PAPER_JAVA_EXE`

### Частые проблемы
- `RCON auth failed`: проверь `rcon.password` в `paper-local/runtime/server.properties` и `config.default.json`.
- `Port already in use`: проверь порты `25566` (MC) и `3210` (web).
- `Zone Allocation failed` / OOM: снизь количество ботов, увеличивай нагрузку ступенчато (`40 -> 60 -> 80 -> 100`).
- `Java not found`: установи Java 21 или укажи `PAPER_JAVA_EXE`.
- `Java too old`: для Paper `1.21.11` нужна Java `21+`.
- `paper.jar already exists` но не та версия/билд: поставь `PAPER_FORCE_DOWNLOAD=1` и запусти `npm run setup:paper`.
- `online-mode`/auth mismatch: для локальных ботов нужен `online-mode=false`.

## EN

### Repository contents
- `src/` — controller + bot workers
- `paper-local/` — local Paper template (bootstrap + start)
- `docs/` — architecture, progress, local setup

### Prerequisites
- Node.js `18+` (recommended `20 LTS`)
- Java `21` (or set `PAPER_JAVA_EXE`)

### Quick start (2 terminals)
Terminal A (Paper):
```powershell
npm run setup:paper
npm run start:paper
```

Terminal B (controller):
```powershell
npm install
npm start
```

Open web panel: `http://127.0.0.1:3210`  
Then run: `Start Workers` -> `Prepare` -> `Start` (or `Launch PvP (auto)`).

### Paper bootstrap behavior
`setup:paper` and `start:paper` automatically:
- create `paper-local/runtime/server.properties` from template
- create `paper-local/runtime/eula.txt` from template
- download/refresh `paper.jar` at `paper-local/runtime/paper.jar` when missing or version/build mismatch is detected

Supported env interface:
- `PAPER_VERSION` (default: `1.21.11`)
- `PAPER_BUILD` (optional; latest if omitted)
- `PAPER_FORCE_DOWNLOAD` (`1/true/yes` forces jar refresh)
- `PAPER_MIN_RAM`, `PAPER_MAX_RAM`
- `PAPER_JAVA_EXE`

### Troubleshooting
- `RCON auth failed`: ensure password matches in runtime `server.properties` and `config.default.json`.
- `Port already in use`: check `25566` (MC) and `3210` (web).
- `Zone Allocation failed` / OOM: reduce bot count, ramp gradually (`40 -> 60 -> 80 -> 100`).
- `Java not found`: install Java 21 or set `PAPER_JAVA_EXE`.
- `Java too old`: Paper `1.21.11` requires Java `21+`.
- `paper.jar already exists` but wrong version/build: set `PAPER_FORCE_DOWNLOAD=1` and run `npm run setup:paper`.
- Auth mismatch: keep `online-mode=false` for local offline bot accounts.

## Commands
```powershell
npm run setup:paper
npm run start:paper
npm start
npm run check
```

## Docs
- [Local setup](docs/LOCAL_SETUP.md)
- [Paper local](paper-local/README.md)
- [Arena architecture](docs/ARENA_ARCHITECTURE.md)
- [Progress](docs/PROGRESS.md)
