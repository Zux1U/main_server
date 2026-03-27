# Local Setup

## Prerequisites

- Node.js `18+` (recommended `20 LTS`)
- Java `21` (for Paper `1.21.11`)
- Local Minecraft server (Paper) with RCON enabled

## 1) Prepare Paper Server

Recommended: use the built-in template from this repository:

```powershell
cd paper-local
.\start.bat
```

Put Paper `1.21.11` jar into:

- `paper-local/runtime/paper.jar`

Template writes `server.properties` with required values:

- `server-port=25566`
- `online-mode=false` (for offline bot usernames)
- `enable-rcon=true`
- `rcon.port=25575`
- `rcon.password=arena-local-pass`

It also writes `eula.txt` (`eula=true`).

Start Paper and keep it running.

## 2) Install This Project

```powershell
cd mc-bot-colony
npm install
```

## 3) Run Bot Controller

```powershell
npm start
```

Default web panel:

- `http://127.0.0.1:3210`

## 4) Match Flow

1. Open web panel.
2. Set desired bot count.
3. Click `Start Workers`.
4. Click `Prepare`.
5. Click `Start` or `Launch PvP (auto)`.

## 5) Useful Env Overrides

PowerShell example:

```powershell
$env:MCB_BOT_COUNT="30"
$env:MCB_BOT_SAFE_SCALE_LIMIT="80"
$env:MCB_RCON_PASSWORD="arena-local-pass"
npm start
```

## 6) Stability Notes

- If you request too many bots for your machine, Node workers can crash with `Zone Allocation failed`.
- The controller now applies a safety cap (`bots.safeScaleLimit` and dynamic host cap).
- Increase load gradually: `40 -> 60 -> 80 -> 100`.
