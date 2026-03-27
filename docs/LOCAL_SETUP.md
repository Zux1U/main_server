# Local Setup / Локальный запуск

## RU

### 1) Установи зависимости
```powershell
npm install
```

### 2) Подними Paper (терминал A)
```powershell
npm run setup:paper
npm run start:paper
```

Что делает bootstrap:
- скачивает или обновляет Paper `1.21.11` (или версию из `PAPER_VERSION`) в `paper-local/runtime/paper.jar`
- создаёт `runtime/server.properties` и `runtime/eula.txt` из шаблонов

### 3) Подними контроллер (терминал B)
```powershell
npm start
```

### 4) Запусти матч в web UI
- URL: `http://127.0.0.1:3210`
- Кнопки: `Start Workers` -> `Prepare` -> `Start`

### Полезные переменные
```powershell
$env:PAPER_VERSION="1.21.11"
$env:PAPER_BUILD=""
$env:PAPER_FORCE_DOWNLOAD="1" # опционально: принудительно обновить jar
$env:PAPER_MIN_RAM="4G"
$env:PAPER_MAX_RAM="6G"
# $env:PAPER_JAVA_EXE="C:\Path\To\java.exe"
```

Для Paper `1.21.11` нужна Java `21+`.

```powershell
$env:MCB_BOT_COUNT="80"
$env:MCB_BOT_SAFE_SCALE_LIMIT="120"
npm start
```

## EN

### 1) Install dependencies
```powershell
npm install
```

### 2) Start Paper (terminal A)
```powershell
npm run setup:paper
npm run start:paper
```

Bootstrap behavior:
- downloads or refreshes Paper `1.21.11` (or `PAPER_VERSION`) into `paper-local/runtime/paper.jar`
- creates `runtime/server.properties` and `runtime/eula.txt` from templates

### 3) Start controller (terminal B)
```powershell
npm start
```

### 4) Start match in web UI
- URL: `http://127.0.0.1:3210`
- Buttons: `Start Workers` -> `Prepare` -> `Start`

### Useful environment variables
```powershell
$env:PAPER_VERSION="1.21.11"
$env:PAPER_BUILD=""
$env:PAPER_FORCE_DOWNLOAD="1" # optional: force jar refresh
$env:PAPER_MIN_RAM="4G"
$env:PAPER_MAX_RAM="6G"
# $env:PAPER_JAVA_EXE="C:\Path\To\java.exe"
```

Paper `1.21.11` requires Java `21+`.

```powershell
$env:MCB_BOT_COUNT="80"
$env:MCB_BOT_SAFE_SCALE_LIMIT="120"
npm start
```
