# paper-local template

Минимальный шаблон локального Paper-сервера для `mc-bot-colony`.

## Что нужно сделать

1. Положи Paper `1.21.11` jar в:

`paper-local/runtime/paper.jar`

2. Запусти:

```powershell
cd paper-local
.\start.bat
```

`start.bat` автоматически создаст в `runtime/`:

- `server.properties` (из `server.properties.example`)
- `eula.txt` (из `eula.txt.example`)

## Важные параметры

Шаблон уже синхронизирован с дефолтами `mc-bot-colony`:

- `server-port=25566`
- `online-mode=false`
- `enable-rcon=true`
- `rcon.port=25575`
- `rcon.password=arena-local-pass`

## Память

Можно переопределить RAM перед запуском:

```powershell
$env:PAPER_MIN_RAM="4G"
$env:PAPER_MAX_RAM="6G"
.\start.bat
```

Также можно задать кастомный Java бинарник:

```powershell
$env:PAPER_JAVA_EXE="C:\Path\To\java.exe"
.\start.bat
```
