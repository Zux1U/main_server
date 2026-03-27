# Phase 01: Foundation

## Goal

Create a stable technical base for the autonomous bot project.

## Completed in this phase

- Separate repository structure created under `mc-bot-colony`
- Config-driven startup added through `config.default.json`
- Multi-bot launcher implemented in `src/botManager.js`
- Single bot lifecycle isolated in `src/botRuntime.js`
- Event logging added to console and rotating file output
- JSON persistence added for bot presence and last known position
- Automatic reconnect added with delay and max-attempt controls

## Deferred to later phases

- Pathfinding
- Survival logic
- Role system
- Building logic
- Faction behavior

## Validation target

When the local Paper server is running, the project should:

- start multiple bots
- log connection lifecycle events
- persist bot state to `data/state.json`
- reconnect bots after disconnect when reconnect is enabled

## Validation status

Validated against the local Paper server on `127.0.0.1:25566`.

- startup completed successfully
- bot login confirmed
- bot spawn confirmed
- state file updated during runtime
