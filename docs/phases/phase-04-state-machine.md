# Phase 04: State Machine

## Goal

Replace loosely-coupled behaviors with a central decision layer.

## Implemented scope

- lightweight FSM in `src/behaviorStateMachine.js`
- AI states persisted into the bot state store
- manual navigation temporarily overrides autonomous behavior
- low-health transitions push the bot into retreat behavior
- survival loop is treated as a centralized active state instead of an isolated timer only

## Current states

- `booting`
- `idle`
- `manual_navigation`
- `survive`
- `flee`
- `return_home`
- `stopped`

## Validation target

Confirm on the local survival server:

- bot enters `survive` when autonomous survival is active
- bot switches to `manual_navigation` after chat movement commands
- bot returns to autonomous state after manual grace period
- bot enters retreat flow when health is low
