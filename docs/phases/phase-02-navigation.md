# Phase 02: Navigation

## Goal

Teach bots to move in the world in a controlled and reusable way.

## Planned scope

- connect `mineflayer-pathfinder`
- move to coordinate targets
- follow a visible player
- return to a configured home point
- stop movement cleanly
- detect timeout or no-path situations

## Implemented

- `src/navigationController.js` added
- pathfinder plugin initialization on spawn
- configurable movement settings in `config.default.json`
- chat command interface for manual navigation checks
- state persistence for current navigation task and home point

## Validation target

With the local Paper server running, confirm:

- bot can move to a coordinate with `go_to`
- bot can follow a player with `follow me`
- bot can return home
- failures are recorded when a target is unreachable
