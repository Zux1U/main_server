# Arena Architecture

Recorded on `2026-03-24`.

## Core decision

The project should not run all bots inside one large Node.js process. The target architecture is:

- `1 process = 1 bot-worker`
- `1 mineflayer.createBot()` instance per worker
- local AI, local combat loop, local reconnect, and local state per worker
- a thin central controller that launches workers, tracks health, and collects telemetry

This is the baseline for real autonomy rather than a shared-process simulation of autonomy.

## Why process-per-bot

- one crashed or stuck bot should not freeze the rest of the match
- each worker gets its own event loop, error boundary, and recovery flow
- Mineflayer behavior is dominated by network and event I/O, so isolation is more useful here than shared-memory worker coordination
- restarting one failed worker is simpler than trying to recover a broken shared runtime

## Target topology

```text
Minecraft server
    ^
    |
bot-worker xN
    ^
    |
arena-controller / supervisor
    ^
    |
stats + viewer
```

## Responsibility split

### arena-controller / supervisor

- load arena and match configuration
- launch and restart bot workers
- announce round lifecycle events
- collect heartbeats, kills, deaths, damage, and round summaries
- reset arena state directly or through server-side commands
- never choose targets or drive movement frame-by-frame

### bot-worker

- connect to Minecraft independently
- create and own its own Mineflayer bot instance
- load movement and combat plugins
- keep local combat state and decision logic
- choose targets from locally visible entities only
- eat, retreat, recover, and reconnect without central guidance
- emit events upward for observability

## Independence rules

The controller must not issue combat micro-commands such as:

- `go_to`
- `attack_bot_7`
- `eat_now`
- `retreat_now`

The controller may only issue round-level commands such as:

- `prepare_round`
- `start_round`
- `stop_round`
- `reset_position`
- `shutdown`

Architecturally, avoid:

- a shared in-memory `bots[]` object with access to other bots' internals
- a shared combat FSM for all bots
- a shared target manager
- a single event loop containing all combat behavior

## Worker-local bot state

Each bot-worker should own its own state machine, with states such as:

- `BOOTING`
- `CONNECTING`
- `LOBBY`
- `PREPARING`
- `SEARCHING_TARGET`
- `ENGAGING`
- `RETREATING`
- `HEALING`
- `DEAD`
- `RESPAWNING`
- `ERROR_RECOVERY`

## IPC contract

### Commands from controller to worker

- `prepare_round`
- `start_round`
- `stop_round`
- `reset_position`
- `shutdown`

### Events from worker to controller

- `ready`
- `spawned`
- `equipped`
- `engaged_target`
- `took_damage`
- `killed_enemy`
- `died`
- `disconnected`
- `reconnected`
- `error`
- `heartbeat`

## Deployment modes

### Development mode

- use `child_process.fork()`
- keep IPC enabled for debugging and round control
- prefer fast local restart loops

### Higher-independence mode

- run bot-workers as long-lived processes
- use detached workers and an external monitor when needed
- allow workers to keep running even if the launcher process dies

## MVP scope

The first arena MVP should stay intentionally narrow:

- 10 worker processes
- 10 bots
- 1 arena
- identical armor and weapon loadout
- nearest-target strategy
- simple low-HP healing
- thin supervisor
- minimal IPC

Add advanced roles, potions, team tactics, and ranking only after this works reliably.

## Current gap from the codebase

What already exists:

- `src/botManager.js` already launches one worker process per bot with `fork()`
- `src/botWorker.js` already provides a separate worker entrypoint
- worker respawn and worker-to-parent logging/state IPC already exist
- the local web panel is useful as an observability tool

What is still mismatched with the target architecture:

- the current supervisor still exposes survival/build micro-commands
- worker logic is still centered around colony survival and build tasks, not arena combat
- combat plugins and arena-specific state machine logic are not integrated yet
- detached workers and an external monitor are not implemented yet
- the IPC contract is broader than the desired round-level controller contract
