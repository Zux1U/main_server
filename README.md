# mc-bot-colony

Локальная arena-система на Mineflayer: `1 процесс = 1 бот`, веб-панель управления раундами, server-side prepare/reset через RCON.

## Что внутри

- отдельный worker-процесс на каждого бота
- arena-controller как тонкий supervisor (prepare/start/stop/reset)
- веб-панель для запуска нужного количества ботов и контроля матча
- динамическая сетка спавнов под число участников
- защита от перегруза по ботам (`safeScaleLimit`)

Документация:

- [LOCAL_SETUP.md](docs/LOCAL_SETUP.md)
- [ARENA_ARCHITECTURE.md](docs/ARENA_ARCHITECTURE.md)
- [PROGRESS.md](docs/PROGRESS.md)
- [paper-local/README.md](paper-local/README.md)

## Быстрый старт (локально)

1. Поднять Paper сервер (Minecraft `1.21.11`) через шаблон из этого репо:

```powershell
cd paper-local
.\start.bat
```

`paper.jar` должен лежать в `paper-local/runtime/paper.jar`.

2. Установить зависимости:

```powershell
npm install
```

3. Запустить контроллер:

```powershell
npm start
```

4. Открыть веб-панель: `http://127.0.0.1:3210`

5. Поток матча:
   - `Start Workers`
   - `Prepare`
   - `Start` (или `Launch PvP (auto)`)

## Конфиг и переменные

- Базовый конфиг: [config.default.json](config.default.json)
- Пример env: [.env.example](.env.example)
- Основные overrides:
  - `MCB_BOT_COUNT`
  - `MCB_BOT_MAX_COUNT`
  - `MCB_BOT_SAFE_SCALE_LIMIT`
  - `MCB_ARENA_LOGIN_RECOVERY_ENABLED`
  - `MCB_RCON_PASSWORD`

Пример:

```powershell
$env:MCB_BOT_COUNT="80"
$env:MCB_BOT_SAFE_SCALE_LIMIT="120"
npm start
```

## Команды

```powershell
npm start
npm run check
```

## Публикация на GitHub

Если репозиторий ещё не инициализирован:

```powershell
git init
git add .
git commit -m "Initial public release: local arena runtime"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

Если remote уже есть:

```powershell
git add .
git commit -m "Docs + local setup + publish-ready cleanup"
git push
```

## Что публиковать

В этом репозитории уже есть всё для локального запуска:

- бот-система (`src/`)
- веб-панель
- шаблон Paper local (`paper-local/`)

Не нужно коммитить реальные рантайм-данные сервера (миры, jar, логи): это уже исключено в `.gitignore`.

## Важно про нагрузку

Если поставить слишком много ботов, процессы Node могут падать по памяти (`Zone Allocation failed`).  
Рекомендуется увеличивать нагрузку ступенчато: `40 -> 60 -> 80 -> 100`.
