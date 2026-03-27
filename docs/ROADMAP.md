# Roadmap

This file tracks the primary implementation order after the arena-autonomy decision recorded on `2026-03-24`.

## Architecture rules

- `1 process = 1 bot-worker`
- each worker owns its own Mineflayer client, AI, reconnect flow, and local state
- the central controller only launches, supervises, and observes
- arena round control is allowed, combat micro-control is not
- prefer server-side arena reset, teleport, and loadout logic where practical

## Ordered stages

1. Architectural pivot and contract freeze
2. Single autonomous bot-worker combat MVP
3. Thin arena-controller / supervisor
4. Arena round orchestration
5. Telemetry and scoreboard pipeline
6. `10x` free-for-all scale validation
7. Observer / viewer service
8. Combat AI expansion
9. Team modes and factions
10. Balancing and optimization

## Development rules

- Build in layers and keep each stage working before moving forward.
- Keep the controller contract narrow: `prepare`, `start`, `stop`, `reset`, `shutdown`.
- Validate failure isolation explicitly by killing one worker and checking that the others continue.
- Update `docs/PROGRESS.md` after every meaningful milestone.
- Avoid adding advanced roles or factions before the `10x` arena MVP is stable.

## Legacy note

The earlier survival-colony phase docs in `docs/phases` are preserved as historical implementation notes. They are no longer the primary roadmap for this repository.
