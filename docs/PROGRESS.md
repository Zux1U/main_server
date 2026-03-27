# Progress

## Current direction

On `2026-03-24`, the project direction was narrowed to an arena-first, strict-autonomy model where each bot runs as its own worker process and the controller becomes a thin supervisor.

## Arena track status

- Stage A0. Architecture decision and contract freeze: `completed`
- Stage A1. Process-per-bot runtime baseline: `completed`
- Stage A2. Single autonomous combat bot-worker MVP: `completed`
- Stage A3. Thin arena-controller / supervisor: `completed`
- Stage A4. Arena round orchestration: `in progress`
- Stage A5. Telemetry and scoreboard pipeline: `in progress`
- Stage A6. `10x` FFA scale validation: `in progress`
- Stage A7. Observer / viewer service: `not started`
- Stage A8. Combat AI expansion: `in progress`
- Stage A9. Team modes and factions: `not started`
- Stage A10. Balancing and optimization: `not started`

## Current implementation baseline

- [x] `child_process.fork()` launcher exists in `src/botManager.js`
- [x] one worker entrypoint per bot exists in `src/botWorker.js`
- [x] worker respawn after exit exists
- [x] worker-to-parent log and state IPC exists
- [x] per-worker runtime bootstrap exists
- [x] local web panel exists for observability
- [x] arena round controller exists in `src/arenaController.js`
- [x] worker-local arena combat controller exists in `src/arenaCombatController.js`
- [x] round-level IPC contract exists for `prepare_round`, `start_round`, `stop_round`, `reset_position`
- [x] server-side arena reset, teleport, and loadout flow exists through RCON
- [ ] detached worker mode exists
- [ ] external monitor process exists
- [ ] combat plugin stack exists
- [ ] round-level IPC contract has fully replaced legacy debug/micro-commands

## Next target

Stabilize the arena runtime under live server load: validate the new web-first worker launch flow, confirm dynamic spawn-grid generation by active bot count, and then move into round summaries plus heavier scale tests.

Latest stabilization update (`2026-03-27`):
- prepare pipeline now runs worker and server prepare phases in parallel to reduce `prepare_round` latency under high bot counts.
- IPC command dispatch to workers no longer waits for per-message channel flush callbacks, which removes slow staggered prepare fan-out.
- login recovery is batched by queue/flush instead of per-bot immediate RCON calls to avoid startup RCON storm.
- stop-phase defaults now include per-bot/per-human spawnpoint+teleport back to holding, including previously eliminated users.
- repository made publish-ready for GitHub: onboarding docs (`README`, `LOCAL_SETUP`), env template, and `.gitignore`.
- added in-repo `paper-local` template (server.properties/eula/start script) so third parties can run both Paper and controller from one clone.
- implemented Paper bootstrap automation (`paper-local/setup-paper.ps1`) with auto-download, template materialization, and explicit failure diagnostics.
- aligned docs to RU+EN quick-start with two-terminal flow and troubleshooting.

## Stage A0 checklist

- [x] strict-autonomy architecture agreed
- [x] `1 process = 1 bot-worker` chosen as the baseline
- [x] controller responsibilities reduced to launcher/supervisor at the design level
- [x] worker-local AI ownership defined
- [x] arena-first MVP order documented

## Stage A1 checklist

- [x] one worker process per bot scaffolded
- [x] worker initialization over IPC implemented
- [x] worker restart on crash implemented
- [x] per-worker state patching scaffolded
- [x] current system can observe worker health in one place
- [x] per-worker reconnect flow implemented
- [ ] workers can continue independently after launcher death
- [ ] external restart monitor added
- [ ] kill-one-worker isolation test recorded in docs
- [ ] legacy survival/build control surface removed from supervisor

## Stage A2 checklist

- [ ] `mineflayer-pvp` or equivalent combat stack integrated
- [x] worker-local target selector added
- [x] worker-local combat loop added
- [x] worker-local healing and retreat logic added
- [x] worker-local stuck recovery added
- [x] single-bot arena validation completed

## Stage A3 checklist

- [x] dedicated arena controller module added
- [x] round lifecycle commands added
- [x] heartbeat collection added
- [x] restart policy limited to the failed worker
- [x] controller no longer owns combat intent

## Stage A4 checklist

- [x] arena config and participant list added
- [x] compact spawn-point management added
- [x] server-side teleport on prepare added
- [x] loadout preparation flow added
- [x] start/end of round orchestration added
- [x] round launch from web panel with configurable bot count added
- [x] optional player staging through web -> RCON flow added
- [x] web-first worker launch (`startOnBoot=false`) added
- [x] runtime worker scaling endpoint added
- [x] dynamic spawn-grid sizing by active bot count added
- [ ] live Paper validation recorded for compact arena rebuild

## Stage A5 checklist

- [x] kills tracked
- [ ] dealt damage tracked
- [x] received damage tracked
- [ ] lifetime tracked
- [x] target switches tracked
- [x] heal sessions tracked
- [ ] stuck events tracked
- [x] winner detection added
- [x] eliminated-player tracking added

## Stage A6 checklist

- [x] 10 worker processes launched together
- [x] one-arena FFA validation completed
- [x] 50 worker stress profile scaffolded
- [ ] path recalculation rate measured
- [ ] CPU usage measured
- [ ] server TPS measured
- [ ] logs-per-second measured

## Stage A7 checklist

- [ ] observer process scaffolded
- [ ] viewer integration added
- [ ] live match stats page added
- [ ] final round summary added

## Legacy colony snapshot

The repository still contains partially implemented colony-oriented systems from the previous direction:

- foundation and multi-process launch: `implemented`
- navigation and survival loop: `implemented, but legacy`
- FSM and task system: `implemented, but legacy`
- builder / collector roles: `implemented, but legacy`
- combat and arena control: `implemented for arena MVP`
- viewer service: `not implemented yet`
